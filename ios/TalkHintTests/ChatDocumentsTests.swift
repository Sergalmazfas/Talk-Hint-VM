import XCTest
import UIKit
@testable import TalkHint

final class ChatDocumentsTests: XCTestCase {
    func testDocumentListKeepsUnknownTypesAndHiddenOrDeletedStatuses() throws {
        let json = """
        {"documents":[{"id":"d","type_id":null,"status":"needs_type","error_code":null,
        "pinned":false,"hidden_at":null,"file_deleted_at":null}],"types":[{"id":"cdl","title":"CDL"}],"nextOffset":20}
        """
        let list = try JSONDecoder().decode(ChatDocumentList.self, from: Data(json.utf8))
        XCTAssertNil(list.documents[0].type_id)
        XCTAssertEqual(list.documents[0].status, "needs_type")
        XCTAssertEqual(list.nextOffset, 20)
    }

    @MainActor
    func testBatchUsesDocumentEndpointAndDoesNotConfirmOrDial() async throws {
        var captured: [URLRequest] = []
        let client = APIClient(transport: { request in
            captured.append(request)
            return try ChatMemoryFixture.reply(request, body: ["message": ChatMemoryFixture.json(), "reply": NSNull()])
        }, tokenProvider: { "synthetic-session" })
        let id = UUID()
        let ids = (0..<10).map { _ in UUID().uuidString.lowercased() }
        _ = try await client.startChatDocuments(conversation: ChatMemoryFixture.conversation, ids: ids, requestId: id)
        XCTAssertEqual(captured.count, 1)
        let request = try XCTUnwrap(captured.first)
        XCTAssertEqual(request.url?.path, "/api/chat-v1/conversations/\(ChatMemoryFixture.conversation)/documents")
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["attachmentIds"] as? [String], ids)
        XCTAssertEqual(body["clientRequestId"] as? String, id.uuidString.lowercased())
        XCTAssertNil(body["memoryHash"]); XCTAssertNil(body["approvalToken"])
    }

    @MainActor
    func testWholeDocumentCardHasOneSaveAndOneCancelDespiteMultipleParts() throws {
        var input = ChatMemoryFixture.json()
        var rawAction = try XCTUnwrap(input["memoryAction"] as? [String: Any])
        var patches = try XCTUnwrap(rawAction["patches"] as? [[String: Any]])
        var after = try XCTUnwrap(patches[0]["after"] as? [String: Any])
        after["state"] = ["documentOnly": true, "status": "inactive", "source": ["kind": "document"]]
        after["content"] = ["title": "CDL", "body": "⚠ Проверь · Срок: неясно"]
        patches[0]["after"] = after; rawAction["patches"] = patches; input["memoryAction"] = rawAction
        let message = try JSONDecoder().decode(ChatMessage.self, from: JSONSerialization.data(withJSONObject: input))
        let patch = try XCTUnwrap(message.memoryAction?.patches.first)
        let action = ChatMemoryAction(id: UUID().uuidString, memoryHash: ChatMemoryFixture.hash, status: "proposed",
            createdAt: "2026-11-17T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", patches: [patch, patch], notice: nil)
        let card = ChatMemoryCardView(action: action, pending: false, onSave: {}, onCancel: {})
        func buttons(_ view: UIView) -> [UIButton] { view.subviews.flatMap { ($0 as? UIButton).map { [$0] } ?? buttons($0) } }
        XCTAssertEqual(buttons(card).filter { $0.accessibilityIdentifier == "chat.memory.save" }.count, 1)
        XCTAssertEqual(buttons(card).filter { $0.accessibilityIdentifier == "chat.memory.cancel" }.count, 1)
        func labels(_ view: UIView) -> [UILabel] { view.subviews.flatMap { ($0 as? UILabel).map { [$0] } ?? labels($0) } }
        let review = try XCTUnwrap(labels(card).first { $0.attributedText?.string.contains("⚠ Проверь") == true }?.attributedText)
        let range = (review.string as NSString).range(of: "⚠ Проверь")
        XCTAssertEqual(review.attribute(.foregroundColor, at: range.location, effectiveRange: nil) as? UIColor, .systemOrange)
    }
}
