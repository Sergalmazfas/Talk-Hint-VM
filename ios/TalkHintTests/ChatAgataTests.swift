import XCTest
import SwiftUI
@testable import TalkHint

final class ChatAgataTests: XCTestCase {
    private let conversation = "11111111-1111-4111-8111-111111111111"
    private let sessionId = "22222222-2222-4222-8222-222222222222"
    func testAdmissionErrorsAreNotMisreportedAsNetworkFailures() {
        for (code, key) in [
            ("AGATA_SESSION_UNRECONCILED", "unreconciled"),
            ("AGATA_MODEL_SPEND_UNRECONCILED", "reviewRequired"),
            ("AGATA_ADMISSION_UNKNOWN_NO_RETRY", "reviewRequired"),
            ("AUDIO_BUSY", "audioBusy"),
            ("AGATA_SESSION_ALREADY_CREATED", "alreadyCreated")
        ] {
            XCTAssertEqual(ChatAgataFailure.messageKey(APIError.http(409, code)), key)
        }
        XCTAssertEqual(ChatAgataFailure.messageKey(APIError.http(429, "AGATA_DAILY_BUDGET_REACHED")), "budget")
        XCTAssertEqual(ChatAgataFailure.messageKey(APIError.http(503, "UNAVAILABLE")), "error")
        XCTAssertEqual(ChatAgataFailure.messageKey(APIError.decoding), "error")
    }
    func testRecoveryUsesOwnerAuthenticationAndNeverCreatesVoice() async throws {
        for state in ["ready", "blocked", "review_required"] {
            let client = APIClient(transport: { r in
                XCTAssertEqual(r.url?.path, "/api/chat-v1/agata/recovery")
                XCTAssertEqual(r.httpMethod, "POST")
                XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer owner")
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: r.httpBody!) as? [String: Any])
                XCTAssertTrue(body.isEmpty)
                return (Data("{\"state\":\"\(state)\"}".utf8),
                        HTTPURLResponse(url: r.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "owner" })
            let result = try await client.recoverChatAgata()
            XCTAssertEqual(result.state.rawValue, state)
        }
    }
    func testRecoveryRejectsUnknownStateAndDoesNotRetryOnOldServer() async {
        for (status, body) in [(200, #"{"state":"unexpected"}"#), (404, #"{"error":"NOT_FOUND"}"#)] {
            var calls = 0
            let client = APIClient(transport: { r in
                calls += 1
                return (Data(body.utf8),
                        HTTPURLResponse(url: r.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "owner" })
            do { _ = try await client.recoverChatAgata(); XCTFail("Invalid recovery accepted") }
            catch {}
            XCTAssertEqual(calls, 1)
        }
    }
    private func ticket(_ edits: [String: Any] = [:]) throws -> Data {
        var value: [String: Any] = [
            "sessionId": sessionId, "conversationId": conversation, "callId": "call_fixture",
            "accessToken": "short-retell-token", "maxSeconds": 300,
            "iceServers": [["urls": ["stun:example.invalid"]]]
        ]
        value.merge(edits) { _, new in new }
        return try JSONSerialization.data(withJSONObject: value)
    }
    func testCreateUsesSameConversationOwnerAndStableRequestID() async throws {
        let data = try ticket(), expectedId = UUID()
        let client = APIClient(transport: { request in
            XCTAssertEqual(request.url?.path, "/api/chat-v1/conversations/\(self.conversation)/agata")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer owner-session")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            XCTAssertEqual(body["clientRequestId"] as? String, expectedId.uuidString.lowercased())
            XCTAssertEqual(body["language"] as? String, "ru")
            return (data, HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "owner-session" })
        let result = try await client.createChatAgata(conversationId: conversation, requestId: expectedId, language: "ru")
        XCTAssertEqual(result.sessionId, sessionId)
    }
    func testUnsupportedLocaleFallsBackToSupportedLanguage() async throws {
        let data = try ticket()
        let client = APIClient(transport: { request in
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            XCTAssertEqual(body["language"] as? String, "en")
            return (data, HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "owner" })
        _ = try await client.createChatAgata(conversationId: conversation, requestId: UUID(), language: "uk")
    }
    func testMismatchedConversationAndInvalidTicketsAreRejected() async throws {
        let invalid: [[String: Any]] = [
            ["conversationId": "somebody-elses-chat"], ["callId": "../bad"],
            ["accessToken": ""], ["maxSeconds": 301], ["maxSeconds": 0]
        ]
        for edits in invalid {
            let data = try ticket(edits)
            let client = APIClient(transport: { r in
                (data, HTTPURLResponse(url: r.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "owner" })
            do {
                _ = try await client.createChatAgata(conversationId: conversation, requestId: UUID(), language: "en")
                XCTFail("Invalid Retell receipt accepted")
            } catch APIError.decoding {} catch { XCTFail("Unexpected error: \(error)") }
        }
    }
    func testJoinedAndStopAreAuthenticatedAndNeverDial() async throws {
        let client = APIClient(transport: { request in
            XCTAssertTrue(request.url!.path.hasSuffix("/joined") || request.url!.path.hasSuffix("/stop"))
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer owner")
            XCTAssertFalse(request.url!.path.contains("secretary"))
            return (Data("{}".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "owner" })
        try await client.chatAgataOperation("joined", sessionId: sessionId)
        try await client.chatAgataOperation("stop", sessionId: sessionId)
    }
    func testInvalidOperationOrPathCannotReachTransport() async {
        let client = APIClient(transport: { _ in
            XCTFail("Unsafe operation reached transport"); throw APIError.decoding
        }, tokenProvider: { "owner" })
        for (operation, id) in [("confirm", sessionId), ("stop", "../elsewhere")] {
            do { try await client.chatAgataOperation(operation, sessionId: id); XCTFail("Accepted unsafe operation") }
            catch {}
        }
    }
    func testReconcileReadsExistingReceiptWithoutCreatingAnotherCall() async throws {
        let client = APIClient(transport: { r in
            XCTAssertEqual(r.httpMethod, "POST")
            XCTAssertTrue(r.url!.path.hasSuffix("/reconcile"))
            XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer owner")
            return (Data(#"{"state":"ended","orbState":"ended","budgetExceeded":false}"#.utf8),
                    HTTPURLResponse(url: r.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "owner" })
        let result = try await client.reconcileChatAgata(sessionId)
        XCTAssertEqual(result.state, "ended")
    }
    func testMissingOwnerStopsBeforeNetwork() async {
        let client = APIClient(transport: { _ in
            XCTFail("Unauthenticated creation reached network"); throw APIError.decoding
        }, tokenProvider: { nil })
        do { _ = try await client.createChatAgata(conversationId: conversation, requestId: UUID(), language: "en")
            XCTFail("Accepted missing owner")
        } catch APIError.notAuthenticated {} catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSignalingUsesOnlyEphemeralRetellTokenAndFixedHost() throws {
        let t = try JSONDecoder().decode(ChatAgataTicket.self, from: ticket())
        let r = try ChatAgataSignaling.request(ticket: t, sdp: "v=0\r\n")
        XCTAssertEqual(r.url?.host, "api.retellai.com")
        XCTAssertEqual(r.url?.scheme, "https")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer short-retell-token")
        XCTAssertEqual(r.httpMethod, "POST")
        let body = try JSONSerialization.jsonObject(with: r.httpBody!) as! [String: String]
        XCTAssertEqual(body, ["identity": "client", "sdp": "v=0\r\n"])
        let stop = try ChatAgataSignaling.request(ticket: t, sdp: "", sessionId: "rtc_fixture")
        XCTAssertEqual(stop.httpMethod, "DELETE")
        XCTAssertNil(stop.httpBody)
        XCTAssertThrowsError(try ChatAgataSignaling.request(ticket: t, sdp: "", sessionId: "../other"))
    }
    func testIceUrlsSupportBothProviderFormats() throws {
        let variants: [Any] = ["stun:example.invalid", ["stun:example.invalid"]]
        for urls in variants {
            let t = try JSONDecoder().decode(ChatAgataTicket.self,
                from: ticket(["iceServers": [["urls": urls, "username": "test", "credential": "ephemeral"]]]))
            XCTAssertEqual(t.iceServers[0].urls, ["stun:example.invalid"])
            XCTAssertEqual(t.iceServers[0].credential, "ephemeral")
        }
    }
    func testAudioStateUsesActualReceivedAudioNotGeneratedText() {
        var s = ChatAgataAudioState()
        XCTAssertEqual(s.sample(input: 0, output: 0, now: 1, thinking: false).phase, .listening)
        XCTAssertEqual(s.sample(input: 0, output: 0, now: 2, thinking: true).phase, .thinking)
        XCTAssertEqual(s.sample(input: 0, output: 0.1, now: 3, thinking: true).phase, .speaking)
        XCTAssertEqual(s.sample(input: 0, output: 0, now: 3.2, thinking: false).phase, .speaking)
        XCTAssertEqual(s.sample(input: 0, output: 0, now: 3.6, thinking: false).phase, .listening)
    }
    func testAudioStateClampsInvalidStatistics() {
        var s = ChatAgataAudioState()
        XCTAssertEqual(s.sample(input: .nan, output: .infinity, now: 1, thinking: false).level, 0)
        XCTAssertEqual(s.sample(input: 10, output: -1, now: 2, thinking: false).level, 1)
    }
    @MainActor
    func testScreenReusesOrbAndDoesNotStartNetworkOrAudioWhenLoaded() {
        let client = APIClient(transport: { _ in
            XCTFail("Loading artwork must not create a paid session"); throw APIError.decoding
        }, tokenProvider: { nil })
        let c = ChatAgataViewController(api: client,
            conversation: ChatConversation(id: conversation, title: "", createdAt: "", updatedAt: ""),
            validOwner: { false })
        c.loadViewIfNeeded()
        XCTAssertTrue(c.children.contains { $0 is UIHostingController<ChatVoiceOrbView> })
        XCTAssertEqual(c.modalPresentationStyle, .fullScreen)
    }
}
