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
}
