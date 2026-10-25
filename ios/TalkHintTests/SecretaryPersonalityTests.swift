import XCTest
@testable import TalkHint

final class SecretaryPersonalityTests: XCTestCase {
    func testSecretaryIDsKeepHyphensAndUUIDsWithoutDoubleEncoding() throws {
        for id in ["katya-fixture", "work-line", "personal-line",
                   "e27af015-6c51-4927-b28e-34b7168a8542", "catalog_v2.~"] {
            let safe = try APIClient.secretaryPathID(id)
            XCTAssertEqual(safe, id)
            for path in ["/api/secretary-personalities/\(safe)",
                         "/api/secretary-personalities/numbers/\(safe)/outgoing"] {
                let url = try APIClient.requestURL(path)
                let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
                XCTAssertEqual(parts.percentEncodedPath, path)
                XCTAssertEqual(url.path, path)
                XCTAssertNil(parts.query)
                XCTAssertNil(parts.fragment)
            }
        }
    }

    func testSecretaryIDsCannotInjectRoutesOrAlreadyEncodedEscapes() {
        for id in ["", ".", "..", "../work-line", "work/line", "work\\line",
                   "%2F", "work%2Dline", "%252F", "line?admin=true", "line#fragment",
                   "line\n", " work-line", "https://example.invalid", "Катя"] {
            XCTAssertThrowsError(try APIClient.secretaryPathID(id), "Unsafe opaque ID: \(id)")
        }
    }

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

    func testSettingsFixtureProvidesBothValidCallProfiles() async throws {
        let fixture = SecretaryPersonalityFixture()
        let profiles = try await client(fixture).callProfiles()
        XCTAssertEqual(Set(profiles.profiles.map(\.id)), Set([.personal, .work]))
        XCTAssertEqual(profiles.profile(.personal)?.numbers.first?.id, "personal-line")
        XCTAssertEqual(profiles.profile(.personal)?.numbers.first?.phoneNumber, "+12025550101")
        XCTAssertEqual(profiles.profile(.work)?.numbers.first?.id, "work-line")
        XCTAssertEqual(profiles.profile(.work)?.numbers.first?.phoneNumber, "+12025550102")
        XCTAssertFalse(profiles.incomingAiEnabled)
        XCTAssertFalse(profiles.calendarConnected)
        let requests = await fixture.recorded()
        XCTAssertEqual(requests.map { $0.url?.path }, ["/api/call-profiles"])
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

    func testSavedKatyaV2IsReadBackByNewClientWithoutChangingOtherLine() async throws {
        let fixture = SecretaryPersonalityFixture()
        let api = client(fixture)
        let detail = try await api.secretaryPersonalityDetails(id: "katya-fixture")
        let version = try XCTUnwrap(detail.versions.first { $0.version == 2 })
        _ = try await api.saveSecretaryOutgoingSetup(numberId: "work-line",
            personalityId: detail.personality.id, version: version.version, cardIds: ["work-card"])

        // A new API client must read the server fixture, not a local selection.
        let reopened = client(fixture)
        let stored = try await reopened.secretaryOutgoingSetup(numberId: "work-line")
        XCTAssertEqual(stored.assignment?.personalityId, detail.personality.id)
        XCTAssertEqual(stored.assignment?.version, 2)
        XCTAssertEqual(stored.assignment?.snapshot.name, "Катя")
        XCTAssertEqual(stored.assignment?.snapshot.rules, version.rules)
        XCTAssertEqual(stored.assignment?.snapshot.examples, version.examples)
        XCTAssertEqual(stored.cardIds, ["work-card"])
        let personal = try await reopened.secretaryOutgoingSetup(numberId: "personal-line")
        XCTAssertNil(personal.assignment)
        XCTAssertTrue(personal.cardIds.isEmpty)
        let requests = await fixture.recorded()
        XCTAssertEqual(requests.filter { $0.httpMethod == "PUT" }.count, 1)
        XCTAssertFalse(requests.contains { $0.url?.path.hasPrefix("/api/secretary/tasks") == true })
    }

    func testUnsafeIDsFailBeforePersonalityTransport() async throws {
        let fixture = SecretaryPersonalityFixture()
        let api = client(fixture)
        for id in ["../work-line", "work/line", "work%2Dline", "line?x=1", "line#x"] {
            do {
                _ = try await api.secretaryPersonalityDetails(id: id)
                XCTFail("Unsafe personality ID must fail")
            } catch APIError.decoding {}
            do {
                _ = try await api.secretaryOutgoingSetup(numberId: id)
                XCTFail("Unsafe number ID must fail")
            } catch APIError.decoding {}
            do {
                _ = try await api.saveSecretaryOutgoingSetup(numberId: id,
                    personalityId: "katya-fixture", version: 2, cardIds: [])
                XCTFail("Unsafe save path must fail")
            } catch APIError.decoding {}
        }
        let requests = await fixture.recorded()
        XCTAssertTrue(requests.isEmpty)
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
