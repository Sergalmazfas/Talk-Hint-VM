import XCTest
@testable import TalkHint

final class SecretaryPersonalityTests: XCTestCase {
    func testPersistedSetupDecodesPinnedKatyaAndExplicitCards() throws {
        let json = #"""
        {"protocolVersion":1,"numberId":"personal-line","scope":"personal","fromNumber":"+19990000001",
         "cardIds":["owner-card"],"cards":[{"id":"owner-card","title":"About owner","description":"Approved facts"}],
         "assignment":{"personalityId":"katya-id","version":1,"mode":"personal","snapshot":
           {"id":"katya-id","version":1,"name":"Катя","description":"Warm","rules":"Situational humor",
            "examples":["Example"],"modeGuidance":{"personal":"Warm","work":"Professional"},"status":"available"}},
         "provider":"retell","engine":"gpt-6.1-sol","reasoning":"medium"}
        """#
        let setup = try JSONDecoder().decode(SecretaryOutgoingSetup.self, from: Data(json.utf8))
        XCTAssertEqual(setup.assignment?.snapshot.name, "Катя")
        XCTAssertEqual(setup.assignment?.version, 1)
        XCTAssertEqual(setup.cardIds, ["owner-card"])
        XCTAssertEqual(setup.numberId, "personal-line")
        XCTAssertEqual(setup.provider, "retell")
    }
    func testLegacyDraftDoesNotAcquireANumberOrNewRequestID() throws {
        let id = UUID()
        let data = try JSONSerialization.data(withJSONObject: [
            "instruction": "Ask about the meeting", "confirmationToken": "confirmed",
            "clientRequestId": id.uuidString, "voiceProvider": "retell",
            "requestAttempted": true,
        ])
        let old = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self, from: data)
        XCTAssertNil(old.secretaryNumberId)
        XCTAssertNil(old.secretaryBackendOrigin)
        XCTAssertEqual(old.clientRequestId, id)
        XCTAssertTrue(old.requestAttempted)
    }
    func testNumberAndBackendSurviveAmbiguousRequestRecovery() throws {
        var draft = SessionStore.SecretaryCallDraft(instruction: "Ask a question", confirmationToken: "token",
            clientRequestId: UUID(), voiceProvider: .retell, phoneNumber: "+19990000002", requestAttempted: true)
        draft.secretaryNumberId = "work-line"
        draft.secretaryBackendOrigin = "https://dev.example.invalid"
        let restored = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.secretaryNumberId, "work-line")
        XCTAssertEqual(restored.secretaryBackendOrigin, draft.secretaryBackendOrigin)
        XCTAssertEqual(restored.clientRequestId, draft.clientRequestId)
        XCTAssertTrue(restored.requestAttempted)
    }
    func testCatalogUsesServerIdentityAndPagination() throws {
        let data = Data(#"{"items":[{"id":"stable-id","slug":"katya","name":"Катя","description":"Warm","status":"available","currentVersion":2}],"nextCursor":"next"}"#.utf8)
        let page = try JSONDecoder().decode(SecretaryPersonalityPage.self, from: data)
        XCTAssertEqual(page.items.first?.id, "stable-id")
        XCTAssertEqual(page.items.first?.currentVersion, 2)
        XCTAssertEqual(page.nextCursor, "next")
    }

    func testMissingAuthenticationNeverReachesPersonalityTransport() async throws {
        let client = APIClient(transport: { _ in
            XCTFail("Unauthenticated request reached transport")
            throw URLError(.unsupportedURL)
        }, tokenProvider: { nil })
        do {
            _ = try await client.secretaryPersonalityContext()
            XCTFail("Missing token must fail")
        } catch APIError.notAuthenticated { }
    }

    func testOutgoingReadRejectsWrongProtocolProviderOrNumber() async throws {
        let invalidResponses: [[String: Any]] = [
            ["protocolVersion": 2, "provider": "retell", "numberId": "personal-line"],
            ["protocolVersion": 1, "provider": "openai", "numberId": "personal-line"],
            ["protocolVersion": 1, "provider": "retell", "numberId": "foreign-line"],
        ]
        for invalid in invalidResponses {
            var payload: [String: Any] = [
                "scope": "personal", "fromNumber": "+12025550101", "cardIds": [],
                "cards": [], "assignment": NSNull(), "engine": "fixture", "reasoning": "medium",
            ]
            payload.merge(invalid) { _, new in new }
            let data = try JSONSerialization.data(withJSONObject: payload)
            let client = APIClient(transport: { request in
                (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "fixture" })
            do {
                _ = try await client.secretaryOutgoingSetup(numberId: "personal-line")
                XCTFail("Invalid outgoing binding must fail closed")
            } catch APIError.decoding { }
        }
    }

    #if TALKHINT_NATIVE_VALIDATION
    private func client(_ fixture: SecretaryPersonalityFixture) -> APIClient {
        APIClient(transport: { try await fixture.send($0) }, tokenProvider: { "personality-fixture" })
    }

    func testPersonalityAPIUsesExactPathsQueriesBearerAndExplicitSaveBody() async throws {
        let fixture = SecretaryPersonalityFixture()
        let api = client(fixture)
        let search = "Катя & ? #"
        let context = try await api.secretaryPersonalityContext()
        XCTAssertEqual(context.numbers.map(\.id), ["personal-line", "work-line"])
        let page = try await api.secretaryPersonalityPage(search: search)
        XCTAssertEqual(page.items.first?.id, "katya-fixture")
        let next = try await api.secretaryPersonalityPage(search: search, cursor: page.nextCursor)
        XCTAssertTrue(next.items.isEmpty)
        XCTAssertNil(next.nextCursor)
        let detail = try await api.secretaryPersonalityDetails(id: "katya-fixture")
        XCTAssertEqual(detail.versions.first?.version, 2)
        let initial = try await api.secretaryOutgoingSetup(numberId: "work-line")
        XCTAssertNil(initial.assignment) // no automatic Katya
        XCTAssertTrue(initial.cardIds.isEmpty)
        let saved = try await api.saveSecretaryOutgoingSetup(numberId: "work-line",
            personalityId: detail.personality.id, version: 2, cardIds: ["work-card"])
        XCTAssertEqual(saved.assignment?.snapshot.rules, detail.versions.first?.rules)
        XCTAssertEqual(saved.cardIds, ["work-card"])
        let requests = await fixture.recorded()
        XCTAssertEqual(requests.map { $0.url!.path }, [
            "/api/secretary-personalities/context", "/api/secretary-personalities",
            "/api/secretary-personalities", "/api/secretary-personalities/katya-fixture",
            "/api/secretary-personalities/numbers/work-line/outgoing",
            "/api/secretary-personalities/numbers/work-line/outgoing",
        ])
        for request in requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer personality-fixture")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        }
        let query = try XCTUnwrap(URLComponents(url: requests[2].url!, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(query.first { $0.name == "q" }?.value, search)
        XCTAssertEqual(query.first { $0.name == "limit" }?.value, "25")
        XCTAssertEqual(query.first { $0.name == "cursor" }?.value, "fixture-page-2")
        let request = try XCTUnwrap(requests.last)
        XCTAssertEqual(request.httpMethod, "PUT")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["personalityId", "version", "cardIds"])
        XCTAssertEqual(body["personalityId"] as? String, "katya-fixture")
        XCTAssertEqual(body["version"] as? Int, 2)
        XCTAssertEqual(body["cardIds"] as? [String], ["work-card"])
        let removed = try await api.saveSecretaryOutgoingSetup(numberId: "work-line",
            personalityId: nil, version: nil, cardIds: [])
        XCTAssertNil(removed.assignment)
        XCTAssertTrue(removed.cardIds.isEmpty)
    }

    func testSaveHTTPFailuresAndCrossProfileCardsAreExplicit() async throws {
        let fixture = SecretaryPersonalityFixture()
        let api = client(fixture)
        for status in [401, 403, 404, 500] {
            await fixture.failNextSave(status)
            do {
                _ = try await api.saveSecretaryOutgoingSetup(numberId: "work-line",
                    personalityId: "katya-fixture", version: 2, cardIds: ["work-card"])
                XCTFail("HTTP failure must not succeed")
            } catch APIError.http(let actual, _) { XCTAssertEqual(actual, status) }
        }
        do {
            _ = try await api.saveSecretaryOutgoingSetup(numberId: "work-line",
                personalityId: "katya-fixture", version: 2, cardIds: ["personal-card"])
            XCTFail("Personal disclosure cannot be saved on Work")
        } catch APIError.http(let status, _) { XCTAssertEqual(status, 403) }
        let stored = try await api.secretaryOutgoingSetup(numberId: "work-line")
        XCTAssertNil(stored.assignment)
        XCTAssertTrue(stored.cardIds.isEmpty)
    }

    func testLostResponseRetryUsesSameRequestLineOriginAndProvider() async throws {
        let fixture = SecretaryPersonalityFixture(recoveryEnabled: true)
        let api = client(fixture)
        var pending = SessionStore.SecretaryCallDraft(instruction: "Fixture only", confirmationToken: "expired.fixture",
            clientRequestId: UUID(), voiceProvider: .retell, phoneNumber: "+12025550103", requestAttempted: true)
        pending.secretaryNumberId = "work-line"
        pending.secretaryBackendOrigin = AppConfig.baseURL.absoluteString
        func send(_ draft: SessionStore.SecretaryCallDraft) async throws -> APIClient.SecretaryTask {
            try await api.createSecretaryTask(phoneNumber: XCTUnwrap(draft.phoneNumber), instruction: draft.instruction,
                confirmationToken: draft.confirmationToken, voiceProvider: draft.voiceProvider, live: true,
                clientRequestId: draft.clientRequestId, secretaryNumberId: draft.secretaryNumberId,
                secretaryBackendOrigin: draft.secretaryBackendOrigin)
        }
        do {
            _ = try await send(pending)
            XCTFail("Fixture must lose its first response")
        } catch let error as URLError { XCTAssertEqual(error.code, .timedOut) }
        let restored = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self, from: JSONEncoder().encode(pending))
        XCTAssertFalse(restored.needsPreparation)
        let task = try await send(restored)
        XCTAssertEqual(task.id, "terminal-fixture-task")
        XCTAssertEqual(task.clientRequestId, pending.clientRequestId.uuidString)
        let creates = await fixture.creationCount()
        XCTAssertEqual(creates, 1)
        let requests = await fixture.recorded()
        XCTAssertEqual(requests.count, 2)
        let bodies = try requests.map { try JSONSerialization.jsonObject(with: XCTUnwrap($0.httpBody)) as! NSDictionary }
        XCTAssertEqual(bodies[0], bodies[1])
        XCTAssertEqual(bodies[0]["secretaryNumberId"] as? String, "work-line")
        XCTAssertEqual(bodies[0]["voiceProvider"] as? String, "retell")
    }
    #endif
}
