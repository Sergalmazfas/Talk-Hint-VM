import Foundation

struct ChatAgataAudioState {
    private var audibleAt = -Double.infinity
    mutating func sample(input: Double, output: Double, now: Double, thinking: Bool)
        -> (phase: ChatVoiceOrbView.Phase, level: Double) {
        let received = output.isFinite ? max(0, output) : 0
        let microphone = input.isFinite ? max(0, input) : 0
        if received > 0.001 { audibleAt = now }
        let speaking = now - audibleAt < 0.45
        return (speaking ? .speaking : thinking ? .thinking : .listening,
                min(1, (speaking ? received : microphone) * 6))
    }
}

private final class AgataNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class ChatAgataSession {
    private let api: APIClient
    private let conversationId: String
    private let validOwner: () -> Bool
    private let peer = ChatAgataPeer()
    private let trickle = ChatAgataTrickle()
    private var diagnostic = ChatAgataDiagnostics()
    private var ticket: ChatAgataTicket?
    private var signalId: String?
    private var monitor: Task<Void, Never>?
    private var meter: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var closed = false
    private var audioState = ChatAgataAudioState()
    private var serverPhase = "listening"
    private lazy var network: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.urlCache = nil
        return URLSession(configuration: c, delegate: AgataNoRedirect(), delegateQueue: nil)
    }()
    var onState: ((ChatVoiceOrbView.Phase, Double) -> Void)?
    var onText: ((String) -> Void)?
    var onError: (() -> Void)?
    var onEnded: ((Bool) -> Void)?

    init(api: APIClient, conversationId: String, validOwner: @escaping () -> Bool) {
        self.api = api; self.conversationId = conversationId; self.validOwner = validOwner
    }
    func start(language: String) async throws {
        guard validOwner(), !closed else { throw CancellationError() }
        // An unstructured creation finishes even if the screen closes while HTTP is in flight.
        // Its late receipt is stopped, not abandoned or retried with a new request ID.
        let api = api, conversationId = conversationId, requestId = UUID()
        let created = try await Task {
            try await api.createChatAgata(conversationId: conversationId, requestId: requestId, language: language)
        }.value
        ticket = created
        diagnostic = ChatAgataDiagnostics(sessionId: created.sessionId, callId: created.callId)
        peer.diagnostic = diagnostic
        diagnostic.record(.admission_complete)
        guard validOwner(), !closed, !Task.isCancelled else {
            try? await api.chatAgataOperation("stop", sessionId: created.sessionId)
            ticket = nil
            throw CancellationError()
        }
        peer.onFailure = { [weak self] in self?.failed() }
        peer.onCandidate = { [weak self] candidate in self?.trickle.enqueue(candidate) }
        trickle.onFailure = { [weak self] error in self?.diagnostic.record(.candidate_failed, error: error) }
        peer.onLevels = { [weak self] input, output in
            guard let self, !self.closed else { return }
            let state = self.audioState.sample(input: input, output: output,
                now: ProcessInfo.processInfo.systemUptime, thinking: self.serverPhase == "thinking")
            self.onState?(state.phase, state.level)
        }
        do {
            let offer = try await peer.offer(ice: created.iceServers)
            guard validOwner(), !closed, !Task.isCancelled else { throw CancellationError() }
            let request = try ChatAgataSignaling.request(ticket: created, sdp: offer)
            diagnostic.record(.sdp_post_start)
            // Finish a late signaling receipt so closing the screen can delete it.
            let network = network
            let (data, response) = try await Task { try await network.data(for: request) }.value
            diagnostic.record(.sdp_post_response, httpStatus: (response as? HTTPURLResponse)?.statusCode ?? 0)
            guard let http = response as? HTTPURLResponse, http.statusCode == 201 else {
                throw ChatAgataConnectionError.signalingHTTP
            }
            guard data.count < 262_144,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = body["session_id"] as? String, APIClient.validAgataComponent(id),
                  let sdp = body["sdp"] as? String, sdp.hasPrefix("v=0") else {
                throw ChatAgataConnectionError.signalingPayload
            }
            signalId = id
            guard validOwner(), !closed, !Task.isCancelled else {
                cleanRemote(created, signal: id); signalId = nil
                throw CancellationError()
            }
            try await peer.setAnswer(sdp)
            guard validOwner(), !closed, !Task.isCancelled else { throw CancellationError() }
            trickle.activate { [weak self] candidate in
                guard let self, !self.closed, self.validOwner(), !Task.isCancelled,
                      self.signalId == id else { throw CancellationError() }
                let r = try ChatAgataSignaling.candidateRequest(ticket: created, sessionId: id, candidate: candidate)
                let (_, result) = try await self.network.data(for: r)
                guard !self.closed, self.validOwner(), !Task.isCancelled else { throw CancellationError() }
                let code = (result as? HTTPURLResponse)?.statusCode ?? 0
                self.diagnostic.record(.candidate_patch_response, httpStatus: code)
                guard (200..<300).contains(code) else { throw ChatAgataConnectionError.candidateHTTP }
            }
            try await peer.waitUntilConnected()
            guard validOwner(), !closed, !Task.isCancelled else { throw CancellationError() }
            diagnostic.record(.joined_start)
            try await api.chatAgataOperation("joined", sessionId: created.sessionId)
            guard validOwner(), !closed, !Task.isCancelled else { throw CancellationError() }
            peer.microphone(true)
            diagnostic.record(.joined_complete)
            onState?(.listening, 0)
            meter = Task { [weak self] in
                while !Task.isCancelled {
                    guard let self, !self.closed, self.validOwner() else { self?.stop(); return }
                    self.peer.measureAudio()
                    try? await Task.sleep(nanoseconds: 150_000_000)
                }
            }
            monitor = Task { [weak self] in await self?.poll() }
            deadline = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(created.maxSeconds) * 1_000_000_000)
                guard !Task.isCancelled else { return }
                self?.stop(); self?.onEnded?(false)
            }
        } catch {
            diagnostic.record(.connect_failed, error: error)
            stop(); throw error
        }
    }
    private func poll() async {
        var misses = 0, tick = 0
        while !Task.isCancelled, !closed, let ticket {
            guard validOwner() else { stop(); return }
            do {
                // Observe a normal remote hangup and its receipt without starting a new call.
                if tick > 0 && tick % 5 == 0 { _ = try await api.reconcileChatAgata(ticket.sessionId) }
                let state = try await api.chatAgataStatus(ticket.sessionId)
                guard !closed, validOwner(), !Task.isCancelled else { return }
                misses = 0; serverPhase = state.orbState
                if state.budgetExceeded == true { stop(); onEnded?(true); return }
                if state.voiceErrorCode != nil { failed(); return }
                if state.state == "ended" { stop(); onEnded?(false); return }
                if state.state != "active" { failed(); return }
            } catch {
                misses += 1
                if misses >= 3 { failed(); return } // bounded, no new paid session
            }
            if tick % 3 == 0 {
                if let history = try? await api.chatMessages(conversationId: conversationId),
                   !closed, validOwner(), !Task.isCancelled,
                   let last = history.messages.last(where: { !$0.text.isEmpty }) { onText?(last.text) }
            }
            tick += 1
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
    }
    private func failed() {
        guard !closed else { return }
        diagnostic.record(.peer_failed)
        stop(); onError?()
    }
    func stop() {
        guard !closed else { return }
        closed = true
        diagnostic.record(.stop)
        trickle.stop()
        peer.close() // Immediate local microphone/playback stop, BEFORE HTTP cleanup.
        monitor?.cancel(); meter?.cancel(); deadline?.cancel()
        monitor = nil; meter = nil; deadline = nil
        if let ticket { cleanRemote(ticket, signal: signalId) }
        ticket = nil; signalId = nil
    }
    private func cleanRemote(_ ticket: ChatAgataTicket, signal: String?) {
        let api = api, network = network
        Task {
            async let stop: Void? = try? await api.chatAgataOperation("stop", sessionId: ticket.sessionId)
            if let signal, let r = try? ChatAgataSignaling.request(ticket: ticket, sdp: "", sessionId: signal) {
                _ = try? await network.data(for: r)
            }
            _ = await stop
            // Retell's final receipt can lag the stop acknowledgement; leave no
            // preventable active-session lock after the owner closes the Orb.
            for _ in 0..<3 {
                if let state = try? await api.reconcileChatAgata(ticket.sessionId), state.state == "ended" { break }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }
}
