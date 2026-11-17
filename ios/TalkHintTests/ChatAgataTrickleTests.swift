import XCTest
@testable import TalkHint

final class ChatAgataTrickleTests: XCTestCase {
    private func candidate(_ id: Int = 0) -> ChatAgataIceCandidate {
        ChatAgataIceCandidate(candidate: "candidate:fixture-\(id) 1 udp 1 192.0.2.1 1234 typ host",
                              sdpMid: "0", sdpMLineIndex: 0)
    }
    private func ticket() -> ChatAgataTicket {
        ChatAgataTicket(sessionId: "11111111-1111-4111-8111-111111111111",
                        conversationId: "22222222-2222-4222-8222-222222222222",
                        callId: "call_fixture", accessToken: "ephemeral-fixture", iceServers: [], maxSeconds: 300)
    }
    @MainActor
    private func until(_ condition: () -> Bool) async throws {
        for _ in 0..<1000 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("Timed out waiting for mocked trickle queue")
        throw ChatAgataConnectionError.iceTimeout
    }
    @MainActor
    func testCandidatesWaitForSessionAndFlushInOrder() async throws {
        let queue = ChatAgataTrickle()
        let first = candidate(1), second = candidate(2)
        var sent: [ChatAgataIceCandidate] = []
        queue.enqueue(first); queue.enqueue(second)
        await Task.yield()
        XCTAssertTrue(sent.isEmpty)
        queue.activate { sent.append($0) }
        try await until { sent.count == 2 }
        XCTAssertEqual(sent, [first, second])
        queue.stop()
    }
    @MainActor
    func testLateCandidatesAreSentWithoutWaitingForGatheringComplete() async throws {
        let queue = ChatAgataTrickle()
        var sent: [ChatAgataIceCandidate] = []
        queue.activate { sent.append($0) }
        queue.enqueue(candidate(1))
        try await until { sent.count == 1 }
        queue.enqueue(candidate(2))
        try await until { sent.count == 2 }
        XCTAssertEqual(sent, [candidate(1), candidate(2)])
        queue.stop()
    }
    @MainActor
    func testDuplicateCandidatesAreSentOnce() async throws {
        let queue = ChatAgataTrickle()
        var sent: [ChatAgataIceCandidate] = []
        queue.enqueue(candidate()); queue.enqueue(candidate())
        queue.activate { sent.append($0) }
        try await until { sent.count == 1 }
        queue.enqueue(candidate()); await Task.yield()
        XCTAssertEqual(sent.count, 1)
        queue.stop()
    }
    @MainActor
    func testStopDiscardsQueuedAndLateCandidates() async {
        let queue = ChatAgataTrickle()
        var sent = 0
        queue.enqueue(candidate(1)); queue.stop()
        queue.activate { _ in sent += 1 }
        queue.enqueue(candidate(2)); await Task.yield()
        XCTAssertEqual(sent, 0)
    }
    @MainActor
    func testStopDuringPatchNeverSendsNextCandidate() async throws {
        let queue = ChatAgataTrickle()
        var sent: [ChatAgataIceCandidate] = []
        var resume: CheckedContinuation<Void, Never>?
        queue.enqueue(candidate(1)); queue.enqueue(candidate(2))
        queue.activate {
            sent.append($0)
            await withCheckedContinuation { resume = $0 }
        }
        try await until { resume != nil }
        queue.stop(); queue.enqueue(candidate(3))
        resume?.resume(); resume = nil
        await Task.yield()
        XCTAssertEqual(sent, [candidate(1)])
    }
    @MainActor
    func testFailedCandidateDoesNotDiscardLaterRoutes() async throws {
        let queue = ChatAgataTrickle()
        var attempted: [ChatAgataIceCandidate] = [], failures = 0
        queue.onFailure = { _ in failures += 1 }
        queue.enqueue(candidate(1)); queue.enqueue(candidate(2))
        queue.activate {
            attempted.append($0)
            if attempted.count == 1 { throw URLError(.networkConnectionLost) }
        }
        try await until { attempted.count == 2 }
        XCTAssertEqual(failures, 1)
        queue.stop()
    }
    @MainActor
    func testQueueIsBoundedAndInvalidCandidatesNeverReachNetwork() async throws {
        let queue = ChatAgataTrickle()
        var sent = 0, failures = 0
        queue.onFailure = { _ in failures += 1 }
        for i in 0..<130 { queue.enqueue(candidate(i)) }
        queue.enqueue(ChatAgataIceCandidate(candidate: "", sdpMid: "0", sdpMLineIndex: 0))
        XCTAssertEqual(failures, 3)
        queue.activate { _ in sent += 1 }
        try await until { sent == 128 }
        XCTAssertEqual(sent, 128)
        queue.stop()
    }
    func testCandidatePatchUsesFixedHostEphemeralTokenAndNativeEnvelope() throws {
        let r = try ChatAgataSignaling.candidateRequest(ticket: ticket(), sessionId: "rtc_fixture", candidate: candidate())
        XCTAssertEqual(r.url?.absoluteString,
                       "https://api.retellai.com/webrtc-proxy/call_fixture/v1/webrtc/sessions/rtc_fixture")
        XCTAssertEqual(r.httpMethod, "PATCH")
        XCTAssertEqual(r.timeoutInterval, 5)
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer ephemeral-fixture")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: r.httpBody!) as? [String: Any])
        let c = try XCTUnwrap(body["candidate"] as? [String: Any])
        XCTAssertEqual(c["candidate"] as? String, candidate().candidate)
        XCTAssertEqual(c["sdpMid"] as? String, "0")
        XCTAssertEqual(c["sdpMLineIndex"] as? Int, 0)
        XCTAssertEqual(Set(body.keys), Set(["candidate"]))
        XCTAssertThrowsError(try ChatAgataSignaling.candidateRequest(ticket: ticket(), sessionId: "../other", candidate: candidate()))
    }
    func testDiagnosticsContainOnlyIdentifiersStatesAndCodes() {
        var events: [ChatAgataDiagnostics.Event] = []
        let diagnostic = ChatAgataDiagnostics(sessionId: "private conversation text",
                                              callId: "secret/token", sink: { events.append($0) })
        let error = NSError(domain: "PRIVATE_DOMAIN", code: -1005,
                            userInfo: [NSLocalizedDescriptionKey: "PRIVATE_TOKEN PRIVATE_SDP"])
        diagnostic.record(.connect_failed, httpStatus: 401, state: 1, error: error)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].sessionId, "unbound")
        XCTAssertEqual(events[0].callId, "unbound")
        XCTAssertEqual(events[0].errorDomain, "other")
        XCTAssertEqual(events[0].errorCode, -1005)
        XCTAssertEqual(events[0].httpStatus, 401)
        XCTAssertFalse(String(reflecting: events).contains("PRIVATE"))
    }
}
