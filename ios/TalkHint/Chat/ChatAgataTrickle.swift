import Foundation
import OSLog

/// Copy only values out of WebRTC's delegate callback, never an RTC object.
struct ChatAgataIceCandidate: Codable, Hashable, Sendable {
    let candidate: String
    let sdpMid: String?
    let sdpMLineIndex: Int32

    var isValid: Bool {
        !candidate.isEmpty && candidate.utf8.count <= 8192 &&
            sdpMLineIndex >= 0 && sdpMLineIndex < 64 && (sdpMid?.utf8.count ?? 0) <= 256
    }
}

enum ChatAgataConnectionError: Int, Error, CustomNSError {
    case invalidCandidate = 1001, candidateQueueFull, signalingHTTP, signalingPayload
    case candidateHTTP, iceFailed, iceTimeout
    static var errorDomain: String { "TalkHint.AgataRTC" }
    var errorCode: Int { rawValue }
    var errorUserInfo: [String: Any] { [:] }
}

/// Bounded, ordered trickle queue. A failed candidate does not discard later
/// usable routes; the peer's bounded ICE connection wait decides success.
@MainActor
final class ChatAgataTrickle {
    typealias Sender = @MainActor (ChatAgataIceCandidate) async throws -> Void
    private var pending: [ChatAgataIceCandidate] = []
    private var seen = Set<ChatAgataIceCandidate>()
    private var sender: Sender?
    private var sending: Task<Void, Never>?
    private var stopped = false
    var onFailure: ((Error) -> Void)?

    func enqueue(_ candidate: ChatAgataIceCandidate) {
        guard !stopped else { return }
        guard candidate.isValid else { onFailure?(ChatAgataConnectionError.invalidCandidate); return }
        guard !seen.contains(candidate) else { return }
        guard seen.count < 128 else { onFailure?(ChatAgataConnectionError.candidateQueueFull); return }
        seen.insert(candidate); pending.append(candidate); drain()
    }
    func activate(_ send: @escaping Sender) {
        guard !stopped, sender == nil else { return }
        sender = send; drain()
    }
    private func drain() {
        guard !stopped, sending == nil, !pending.isEmpty, let sender else { return }
        sending = Task { [weak self] in
            guard let self else { return }
            defer { self.sending = nil }
            while !self.stopped, !Task.isCancelled, !self.pending.isEmpty {
                let candidate = self.pending.removeFirst()
                do { try await sender(candidate) }
                catch {
                    guard !self.stopped, !Task.isCancelled else { return }
                    self.onFailure?(error)
                }
            }
        }
    }
    func stop() {
        stopped = true
        sending?.cancel(); sending = nil
        pending.removeAll(); seen.removeAll(); sender = nil; onFailure = nil
    }
}

/// Typed metadata only. Never log SDP, candidates/IPs, tokens, error descriptions
/// or conversation text. Capturable events also make the privacy boundary testable.
struct ChatAgataDiagnostics {
    enum Stage: String, Sendable {
        case admission_complete, offer_start, local_sdp_ready, sdp_post_start, sdp_post_response
        case remote_sdp_ready, candidate_received, candidate_patch_response, candidate_failed
        case ice_gathering, ice_connection, ice_timeout, joined_start, joined_complete
        case connect_failed, peer_failed, stop
    }
    struct Event {
        let stage: Stage
        let sessionId: String
        let callId: String
        let httpStatus: Int
        let state: Int
        let errorCode: Int
        let errorDomain: String
    }
    private static let logger = Logger(subsystem: "app.talkhint", category: "AgataRTC")
    private let sessionId: String
    private let callId: String
    private let sink: ((Event) -> Void)?
    init(sessionId: String = "", callId: String = "", sink: ((Event) -> Void)? = nil) {
        self.sessionId = UUID(uuidString: sessionId)?.uuidString.lowercased() ?? "unbound"
        self.callId = callId.hasPrefix("call_") && APIClient.validAgataComponent(callId) ? callId : "unbound"
        self.sink = sink
    }
    func record(_ stage: Stage, httpStatus: Int = 0, state: Int = -1, error: Error? = nil) {
        let ns = error.map { $0 as NSError }
        let domain = ns.map {
            [NSURLErrorDomain, ChatAgataConnectionError.errorDomain, "org.webrtc.RTCPeerConnection",
             "AVFoundationErrorDomain", "com.apple.coreaudio.avfaudio"].contains($0.domain) ? $0.domain : "other"
        } ?? "none"
        let event = Event(stage: stage, sessionId: sessionId, callId: callId,
                          httpStatus: httpStatus, state: state, errorCode: ns?.code ?? 0, errorDomain: domain)
        if let sink { sink(event); return }
        Self.logger.info("stage=\(event.stage.rawValue, privacy: .public) session=\(event.sessionId, privacy: .public) call=\(event.callId, privacy: .public) http=\(event.httpStatus) state=\(event.state) errorDomain=\(event.errorDomain, privacy: .public) errorCode=\(event.errorCode)")
    }
}
