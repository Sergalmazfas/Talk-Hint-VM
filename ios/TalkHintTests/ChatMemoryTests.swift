import XCTest
import Foundation
@testable import TalkHint

enum ChatMemoryFixture {
    static let hash = String(repeating: "a", count: 64)
    static let conversation = "memory-fixture-conversation"
    static let messageID = "memory-fixture-message"

    static func json(status: String = "proposed", expiresAt: String = "2099-01-01T00:00:00Z",
                     certainty: String = "assumed") -> [String: Any] {
        ["id": messageID, "conversationId": conversation, "sequence": 1, "role": "assistant",
         "text": "Предлагаю изменить память", "status": "complete", "attachmentIds": [],
         "createdAt": "2026-11-17T20:00:00Z",
         "memoryAction": [
            "id": "memory-proposal", "memoryHash": hash, "status": status,
            "createdAt": "2026-11-17T20:00:00.000Z", "expiresAt": expiresAt,
            "notice": "Server notice",
            "patches": [[
                "kind": "card", "id": "memory-card",
                "before": ["content": ["title": "Трак", "body": "unit 00321", "profileScope": "work"],
                           "state": ["status": "active", "source": NSNull(), "certainty": NSNull()]],
                "after": ["content": ["title": "Трак", "body": "unit 00322", "profileScope": "work"],
                          "state": ["status": "active", "certainty": certainty,
                                    "missingFields": ["mc", "usdot"],
                                    "source": ["kind": "user", "quote": "unit 00322", "date": "2026-11-17T19:00:00Z"]]]
            ]]
         ]]
    }
    static func message(status: String = "proposed", expiresAt: String = "2099-01-01T00:00:00Z") throws -> ChatMessage {
        try JSONDecoder().decode(ChatMessage.self, from: JSONSerialization.data(withJSONObject: json(status: status, expiresAt: expiresAt)))
    }
    static func reply(_ request: URLRequest, status: Int = 200, body: [String: Any]) throws -> (Data, URLResponse) {
        (try JSONSerialization.data(withJSONObject: body),
         HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

final class ChatMemoryTests: XCTestCase {
    func testOldMessagesStillDecodeWithoutMemoryAndMemoryIsNotACallPlan() throws {
        var json = ChatMemoryFixture.json()
        json.removeValue(forKey: "memoryAction")
        let old = try JSONDecoder().decode(ChatMessage.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(old.memoryAction)
        let new = try ChatMemoryFixture.message()
        XCTAssertNil(new.action)
        XCTAssertEqual(new.memoryAction?.patches[0].after.content?["body"]?.string, "unit 00322")
        let roundTrip = try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(new))
        XCTAssertEqual(roundTrip, new)
    }

    func testExpiryUsesServerDeadlineIncludingExactBoundaryAndSavedReplay() throws {
        let deadline = try XCTUnwrap(ChatMemoryAction.date("2099-01-01T00:00:00Z"))
        let proposed = try XCTUnwrap(ChatMemoryFixture.message().memoryAction)
        XCTAssertTrue(proposed.canDecide(at: deadline.addingTimeInterval(-0.001)))
        XCTAssertEqual(proposed.effectiveStatus(at: deadline), "expired")
        XCTAssertFalse(proposed.canDecide(at: deadline))
        let saved = try XCTUnwrap(ChatMemoryFixture.message(status: "saved").memoryAction)
        XCTAssertEqual(saved.effectiveStatus(at: deadline.addingTimeInterval(1)), "saved")
    }

    func testTerminalAndUnknownCardsNeverEnableSave() throws {
        for status in ["saved", "cancelled", "stale", "expired", "future_unknown"] {
            XCTAssertFalse(try XCTUnwrap(ChatMemoryFixture.message(status: status).memoryAction).canDecide())
        }
        let invalid = try XCTUnwrap(ChatMemoryFixture.message(expiresAt: "not-a-date").memoryAction)
        XCTAssertEqual(invalid.effectiveStatus(), "unavailable")
        XCTAssertNotNil(ChatMemoryAction.date("2026-11-17T20:00:00.123Z"))
        XCTAssertEqual(ChatMemoryAction.rejectionStatus(for: "MEMORY_STALE"), "stale")
        XCTAssertEqual(ChatMemoryAction.rejectionStatus(for: "MEMORY_EXPIRED"), "expired")
        XCTAssertNil(ChatMemoryAction.rejectionStatus(for: "PLAN_STALE"))
        var bad = ChatMemoryFixture.json()
        var action = try XCTUnwrap(bad["memoryAction"] as? [String: Any])
        action["memoryHash"] = "not-a-memory-hash"
        bad["memoryAction"] = action
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: JSONSerialization.data(withJSONObject: bad))
        XCTAssertFalse(try XCTUnwrap(decoded.memoryAction).canDecide())
    }

    func testSnapshotPreservesStructuredDescriptionAndUnknownFieldsWithoutTruncating() throws {
        let raw = #"{"about":"Driver","unknown":{"keep":true},"unit":"00321"}"#
        let snapshot = ChatMemoryAction.Snapshot(content: .object(["raw": .string(raw)]), state: .null)
        XCTAssertTrue(snapshot.displayText.contains("00321"))
        XCTAssertTrue(snapshot.displayText.contains("unknown: keep: true"))
        let empty = ChatMemoryAction.Snapshot(content: nil, state: .null)
        XCTAssertEqual(empty.displayText, "—")
        let long = String(repeating: "я", count: 4000)
        XCTAssertEqual(ChatMemoryAction.Snapshot(content: .object(["raw": .string(long)]), state: .null).displayText, long)
    }

    func testSaveAndCancelUseOnlyMemoryHashAndNeverCallApprovalOrDialRoutes() async throws {
        for decision in ChatMemoryDecision.allCases {
            var requests: [URLRequest] = []
            let client = APIClient(transport: { request in
                requests.append(request)
                return try ChatMemoryFixture.reply(request, body: [
                    "message": ChatMemoryFixture.json(status: decision == .save ? "saved" : "cancelled"), "dialed": false])
            }, tokenProvider: { "synthetic-session" })
            let result = try await client.decideChatMemory(conversationId: ChatMemoryFixture.conversation,
                messageId: ChatMemoryFixture.messageID, memoryHash: ChatMemoryFixture.hash, decision: decision)
            XCTAssertFalse(result.dialed)
            let req = try XCTUnwrap(requests.first)
            XCTAssertEqual(requests.count, 1)
            XCTAssertEqual(req.httpMethod, "POST")
            XCTAssertEqual(req.url?.path, "/api/chat-v1/conversations/\(ChatMemoryFixture.conversation)/messages/\(ChatMemoryFixture.messageID)/memory/\(decision.rawValue)")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-session")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(req.httpBody)) as? [String: String])
            XCTAssertEqual(body, ["memoryHash": ChatMemoryFixture.hash])
            XCTAssertNil(result.message.action)
        }
    }
}
