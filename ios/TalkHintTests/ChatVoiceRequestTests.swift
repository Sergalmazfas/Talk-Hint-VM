import XCTest
@testable import TalkHint

@MainActor
final class ChatVoiceRequestTests: XCTestCase {
    func testTranscriptionPassesHintWithoutChangingEndpointOrModel() async throws {
        let api = APIClient(transport: { request in
            XCTAssertEqual(request.url?.path, "/api/prepare/stt")
            let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String])
            XCTAssertEqual(body["language"], "ru")
            XCTAssertEqual(body["mimeType"], "audio/wav")
            XCTAssertEqual(body["audio"], Data([1, 2]).base64EncodedString())
            XCTAssertNil(body["model"])
            return (Data("{\"text\":\"проверка\"}".utf8),
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline" })
        let text = try await api.prepareTranscribe(audio: Data([1, 2]), mimeType: "audio/wav", language: "ru")
        XCTAssertEqual(text, "проверка")
    }
    func testOldServerCapabilitiesDoNotImplyNewVoiceSupport() throws {
        let old = Data(#"{"ai":{"available":true},"attachments":{"available":false,"mimeTypes":[],"maxBytes":1},"voice":{"available":true},"voiceMode":{"available":true,"speech":{"available":true}}}"#.utf8)
        let caps = try JSONDecoder().decode(ChatCapabilities.self, from: old)
        XCTAssertNil(caps.voiceRevision)
    }
    func testPlanRunnerCannotStartAfterScreenOwnershipIsLost() async {
        let api = APIClient(transport: { _ in
            XCTFail("Invalid ownership must stop before any API")
            throw APIError.decoding
        }, tokenProvider: { "offline" })
        let runner = ChatVoicePlanRunner(api: api)
        let review = ChatPlanConfirmation.Review(phoneNumber: "+15734687030",
                                                instruction: "Offline", confirmationToken: "offline")
        do {
            _ = try await runner.start(review, valid: { false })
            XCTFail("Ownership loss must be rejected")
        } catch { /* expected; no session/audio/network setup */ }
    }
}
