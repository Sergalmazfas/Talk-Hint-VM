import XCTest
import Foundation
@testable import TalkHint

final class ChatAPITests: XCTestCase {
    func testSendUsesAuthenticatedContractAndStableClientRequestId() async throws {
        let requestId = UUID()
        var captured: URLRequest?
        let responseObject: [String: Any] = [
            "message": [
                "id": "m1", "conversationId": "c1", "sequence": 1, "role": "user",
                "text": "Hello", "status": "complete", "clientRequestId": requestId.uuidString.lowercased(),
                "attachmentIds": [], "createdAt": "2026-01-01T00:00:00.000Z"
            ],
            "reply": NSNull()
        ]
        let client = APIClient(transport: { request in
            captured = request
            let data = try JSONSerialization.data(withJSONObject: responseObject)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "test-session-token" })
        let result = try await client.sendChatMessage(conversationId: "c1", requestId: requestId,
                                                      text: "Hello", attachmentIds: [], language: "en")
        XCTAssertEqual(result.message.clientRequestId, requestId.uuidString.lowercased())
        XCTAssertEqual(captured?.httpMethod, "POST")
        XCTAssertTrue(captured?.url?.path.hasSuffix("/api/chat-v1/conversations/c1/messages") == true)
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer test-session-token")
        let body = try XCTUnwrap(captured?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["clientRequestId"] as? String, requestId.uuidString.lowercased())
        XCTAssertEqual(json["language"] as? String, "en")
    }

    func testAttachmentInfoEnvelopeMatchesServerShape() async throws {
        var capturedPath = ""
        let client = APIClient(transport: { request in
            capturedPath = request.url?.path ?? ""
            let data = try JSONSerialization.data(withJSONObject: [
                "attachment": ["id": "a1", "name": "brief.pdf", "mimeType": "application/pdf",
                               "size": 582, "status": "ready"]
            ])
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "alice-token" })
        let attachment = try await client.chatAttachmentInfo(id: "a1")
        XCTAssertEqual(capturedPath, "/api/chat-v1/attachments/a1/info")
        XCTAssertEqual(attachment.name, "brief.pdf")
        XCTAssertEqual(attachment.status, "ready")
    }

    func testOwnerMismatchStopsBeforeTransport() async {
        let scope = ChatSessionScope(ownerId: "alice")
        var transportCalled = false
        let client = APIClient(transport: { request in
            transportCalled = true
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: {
            scope.permits(currentUserId: "bob") ? "alice-token" : nil
        })
        do {
            _ = try await client.chatConversations()
            XCTFail("A client captured for Alice must not send after the active owner changes.")
        } catch APIError.notAuthenticated {
            XCTAssertFalse(transportCalled)
        } catch {
            XCTFail("Expected owner-scope authentication refusal, got \(error)")
        }
    }
}
