import XCTest
@testable import TalkHint

final class ChatOutboxTests: XCTestCase {
    func testSessionScopeNeverAuthorizesAnotherOrMissingOwner() {
        let alice = ChatSessionScope(ownerId: "alice")
        XCTAssertTrue(alice.permits(currentUserId: "alice"))
        XCTAssertFalse(alice.permits(currentUserId: "bob"))
        XCTAssertFalse(alice.permits(currentUserId: nil))
        XCTAssertFalse(ChatSessionScope(ownerId: nil).permits(currentUserId: "alice"))
    }

    func testOutboxIsOwnerAndOriginScopedAndKeepsIdempotencyKey() {
        let suite = "ChatOutboxTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let alice = ChatOutbox(owner: "alice", origin: "https://one.test", defaults: defaults)
        let send = alice.enqueue(conversationId: "c1", text: "hello", attachmentIds: [], language: "en")
        XCTAssertEqual(alice.pendingSends.first?.id, send.id)
        let createRequest = alice.beginConversationRequest()
        XCTAssertEqual(alice.beginConversationRequest(), createRequest)
        alice.finishConversationRequest()
        XCTAssertNotEqual(alice.beginConversationRequest(), createRequest)
        XCTAssertTrue(ChatOutbox(owner: "bob", origin: "https://one.test", defaults: defaults).pendingSends.isEmpty)
        XCTAssertTrue(ChatOutbox(owner: "alice", origin: "https://two.test", defaults: defaults).pendingSends.isEmpty)
        var pending = alice.pendingSends
        pending[0].state = .uncertain
        alice.pendingSends = pending
        XCTAssertEqual(alice.pendingSends[0].id, send.id)
        alice.clear()
        XCTAssertTrue(alice.pendingSends.isEmpty)
        defaults.removePersistentDomain(forName: suite)
    }

    func testMergeUpdatesExistingAndOrdersBySequence() {
        func message(_ id: String, _ sequence: Int, _ status: String) -> ChatMessage {
            ChatMessage(id: id, conversationId: "c", sequence: sequence, role: "assistant", text: id,
                        status: status, clientRequestId: nil, attachmentIds: [], createdAt: "", errorCode: nil)
        }
        let merged = ChatOutbox.merge([message("a", 1, "generating")],
                                      [message("b", 2, "complete"), message("a", 1, "complete")])
        XCTAssertEqual(merged.map(\.id), ["a", "b"])
        XCTAssertEqual(merged.first?.status, "complete")
    }

    func testMergeReconcilesCanonicalLowercaseClientRequestId() {
        let requestId = UUID()
        func message(id: String, requestId: String?, sequence: Int) -> ChatMessage {
            ChatMessage(id: id, conversationId: "c", sequence: sequence, role: "user", text: "hello",
                        status: "queued", clientRequestId: requestId, attachmentIds: [], createdAt: "", errorCode: nil)
        }
        let local = message(id: requestId.uuidString, requestId: requestId.uuidString, sequence: 1)
        let server = message(id: "server-message", requestId: requestId.uuidString.lowercased(), sequence: 1)
        let result = ChatOutbox.merge([local], [server])
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.first?.id, "server-message")
    }
}
