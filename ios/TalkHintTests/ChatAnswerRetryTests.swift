import XCTest
@testable import TalkHint

@MainActor
final class ChatAnswerRetryTests: XCTestCase {
    func testOlderServerDoesNotAdvertiseAnswerRetry() throws {
        let data = Data(#"{"ai":{"available":false},"voice":{"available":false},"attachments":{"available":false,"mimeTypes":[],"maxBytes":2097152}}"#.utf8)
        let capabilities = try JSONDecoder().decode(ChatCapabilities.self, from: data)
        XCTAssertNil(capabilities.answerRetry)
    }
    private actor Probe {
        var paths: [String] = []
        var ids: [String] = []
        var keySets: [Set<String>] = []
        func record(path: String, id: String, keys: Set<String>) -> Int {
            paths.append(path); ids.append(id); keySets.append(keys)
            return paths.count
        }
        func snapshot() -> ([String], [String], [Set<String>]) { (paths, ids, keySets) }
    }
    func testLostResponseReusesSameKeyAndNeverUsesNormalSendOrConfirmation() async throws {
        let probe = Probe()
        let api = APIClient(transport: { request in
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            let count = await probe.record(path: request.url!.path,
                id: body["clientRequestId"] as? String ?? "", keys: Set(body.keys))
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url!.path.hasSuffix("/messages/failed/retry-answer"))
            if count == 1 { throw URLError(.networkConnectionLost) }
            let data = Data(#"{"reply":{"id":"retry","conversationId":"c","sequence":3,"role":"assistant","text":"","status":"queued","attachmentIds":[],"createdAt":""}}"#.utf8)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline-fixture" })
        let id = UUID()
        do { _ = try await api.retryChatAnswer(conversationId: "c", messageId: "failed", requestId: id); XCTFail("expected lost response") }
        catch { /* The caller reconciles the same key, never re-sends a normal message. */ }
        let reply = try await api.retryChatAnswer(conversationId: "c", messageId: "failed", requestId: id)
        let (paths, ids, keys) = await probe.snapshot()
        XCTAssertEqual(reply.id, "retry")
        XCTAssertEqual(Set(paths).count, 1)
        XCTAssertEqual(ids[0], ids[1])
        XCTAssertFalse(keys[0].contains("text"))
        XCTAssertFalse(keys[0].contains("planHash"))
    }
}
