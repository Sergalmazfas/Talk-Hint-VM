import XCTest
@testable import TalkHint

@MainActor
final class ChatReadAloudTests: XCTestCase {
    func testManifestUsesUTF16NotCharactersAndRejectsOutOfRange() throws {
        let manifest = try JSONDecoder().decode(ChatReadAloudManifest.self, from:
            Data(#"{"revision":1,"offsetEncoding":"utf-16","textHash":"hash","segments":[{"offset":0,"length":4}]}"#.utf8))
        XCTAssertNoThrow(try manifest.validate(text: "Hi😀"))
        XCTAssertThrowsError(try manifest.validate(text: "Hi"))
        let split = try JSONDecoder().decode(ChatReadAloudManifest.self, from:
            Data(#"{"revision":1,"offsetEncoding":"utf-16","textHash":"hash","segments":[{"offset":0,"length":3},{"offset":3,"length":1}]}"#.utf8))
        XCTAssertThrowsError(try split.validate(text: "Hi😀"))
    }
    func testPCMIsWrappedAs24kMono16BitWAVAndOddLengthFails() throws {
        let pcm = Data([0, 0, 255, 127])
        let wav = try ChatReadAloudPlayer.wav(pcm)
        XCTAssertEqual(String(data: wav.prefix(4), encoding: .utf8), "RIFF")
        XCTAssertEqual(wav.count, 48)
        XCTAssertEqual(Array(wav[24..<28]), [192, 93, 0, 0]) // 24000 LE
        XCTAssertEqual(Array(wav.suffix(4)), Array(pcm))
        XCTAssertThrowsError(try ChatReadAloudPlayer.wav(Data([1])))
    }
    func testSpeechPOSTHasOnlyServerContractFieldsAndRejectsJSONOrRedirect() async throws {
        for status in [200, 302, 429] {
            let api = APIClient(transport: { request in
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer offline")
                let json = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                XCTAssertEqual(Set(json.keys), ["requestId", "playbackId", "offset", "length"])
                XCTAssertEqual(json["offset"] as? Int, 2)
                return (Data(#"{"error":"not audio"}"#.utf8),
                    HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json", "Location": "https://evil.invalid"])!)
            }, tokenProvider: { "offline" })
            do {
                _ = try await api.chatBinary("/api/chat-v1/conversations/c/messages/m/read-aloud", method: "POST",
                    body: ["requestId": UUID().uuidString, "playbackId": UUID().uuidString, "offset": 2, "length": 3], audio: true)
                XCTFail("Must not play JSON or follow redirect")
            } catch {}
        }
    }
    func testAgataPreemptsPlaybackAndBlocksAnotherPlayer() {
        let audio = ChatAudioOwnership.shared
        var stopped = 0
        XCTAssertTrue(audio.claimPlayback { stopped += 1; audio.releasePlayback() })
        let lease = audio.beginAgata()
        XCTAssertNotNil(lease)
        defer { audio.endAgata(lease) }
        XCTAssertEqual(stopped, 1)
        XCTAssertEqual(audio.owner, .agata)
        XCTAssertFalse(audio.claimPlayback {})
        audio.endAgata(UUID()) // stale session must not release the current lease
        XCTAssertEqual(audio.owner, .agata)
        audio.endAgata(lease)
        XCTAssertNil(audio.owner)
    }
    func testBusyAgataDoesNotRequestSpeechOrMicrophone() {
        var requests = 0
        let api = APIClient(transport: { _ in requests += 1; throw URLError(.badURL) }, tokenProvider: { "offline" })
        let player = ChatReadAloudPlayer(api: api, valid: { true })
        let lease = ChatAudioOwnership.shared.beginAgata()
        defer { player.stop(); ChatAudioOwnership.shared.endAgata(lease) }
        var code: Int?
        player.onError = { if case APIError.http(let c, _) = $0 { code = c } }
        player.play(ChatMessage(id: "m", conversationId: "c", sequence: 1, role: "assistant",
            text: "Hello", status: "complete", clientRequestId: nil, attachmentIds: [], createdAt: "", errorCode: nil))
        XCTAssertEqual(requests, 0); XCTAssertEqual(code, 409)
    }
    func testStopIgnoresLateManifestWithoutPaidPOST() async throws {
        var calls = 0
        let began = expectation(description: "manifest")
        var release: CheckedContinuation<Void, Never>?
        let api = APIClient(transport: { req in
            calls += 1
            XCTAssertEqual(req.httpMethod, "GET")
            await withCheckedContinuation { c in release = c; began.fulfill() }
            let d = Data(#"{"revision":1,"offsetEncoding":"utf-16","textHash":"h","segments":[{"offset":0,"length":5}]}"#.utf8)
            return (d, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline" })
        let player = ChatReadAloudPlayer(api: api, valid: { true })
        player.play(ChatMessage(id: "m", conversationId: "c", sequence: 1, role: "assistant",
            text: "Hello", status: "complete", clientRequestId: nil, attachmentIds: [], createdAt: "", errorCode: nil))
        await fulfillment(of: [began], timeout: 2)
        player.stop(); release?.resume()
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(calls, 1); XCTAssertNil(player.messageId)
    }
}
