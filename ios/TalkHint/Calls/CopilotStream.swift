import Foundation

/// Authenticated, transient transport for the independent Copilot pipeline.
/// Audio is supplied by the Copilot-aware TVOAudioDevice; this object never
/// records, persists, or logs audio/text.
final class CopilotStream: NSObject, URLSessionWebSocketDelegate {
    enum State { case idle, connecting, ready, stopped }

    var onReady: (() -> Void)?
    var onGuestText: ((String, String?) -> Void)?
    var onPrivateText: ((String) -> Void)?
    /// Final speech recognition for the scrolling conversation (or the
    /// private draft). Private source text is never sent to the public feed.
    var onSourceText: ((String, String, String?) -> Void)?
    /// Called only after the server has acknowledged a particular hold.
    var onHoldReady: ((String) -> Void)?
    var onFailure: ((Error?) -> Void)?
    private var currentState: State = .idle
    private var ownerTranscriptSupported = false
    private let stateLock = NSLock()
    private let sendQueue = DispatchQueue(label: "app.talkhint.copilot.socket.send")
    var state: State {
        stateLock.lock(); defer { stateLock.unlock() }
        return currentState
    }
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession!
    private let callSid: String
    private let language: String
    private let sampleRateHz: Int
    /// Capture is cleared as soon as hold_end is queued, but display remains
    /// scoped to that hold while server VAD commits its final response.
    private var captureHoldId: String?
    private var displayHoldId: String?
    // `consume` is always called on main, so these transient response
    // accumulators do not need a second lock. They are intentionally bounded
    // to the current response: Copilot is not a transcript.
    private var responseDeltas: [String: String] = [:]
    private var latestGuestResponseId: String?
    private var latestPrivateResponseId: String?

    /// `sampleRateHz` must be measured from the active audio device. There is
    /// intentionally no guessed/default hardware rate.
    init(callSid: String, language: String, sampleRateHz: Int) {
        self.callSid = callSid
        self.language = language
        self.sampleRateHz = sampleRateHz
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func start() {
        guard state == .idle, let token = SessionStore.shared.token else {
            fail(nil)
            return
        }
        var components = URLComponents(
            url: AppConfig.webSocketBaseURL.appendingPathComponent("copilot-stream"),
            resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components?.url else { fail(nil); return }
        setState(.connecting)
        let task = session.webSocketTask(with: url)
        stateLock.lock(); socket = task; stateLock.unlock()
        task.resume()
    }

    func stop() {
        setState(.stopped)
        stateLock.lock(); let task = socket; socket = nil; stateLock.unlock()
        task?.cancel(with: .normalClosure, reason: nil)
    }

    /// Frames must be PCM16 little-endian and base64 encoded by the caller.
    func sendAudio(pcm16Base64: String, direction: String, holdId: String? = nil) {
        guard state == .ready else { return }
        if direction == "owner" {
            stateLock.lock()
            let supported = ownerTranscriptSupported
            stateLock.unlock()
            guard supported else { return }
        }
        var message: [String: Any] = ["type": "audio", "direction": direction, "pcm16": pcm16Base64]
        if direction == "private" {
            guard let holdId = holdId ?? currentCaptureHoldId() else { return }
            message["holdId"] = holdId
        }
        send(message)
    }

    func holdStart(holdId: String) {
        guard state == .ready else { return }
        stateLock.lock(); captureHoldId = holdId; displayHoldId = holdId; stateLock.unlock()
        // A new hold starts a new private response namespace. Late deltas
        // from the previous hold can never overwrite this phrase.
        responseDeltas = responseDeltas.filter { !$0.key.hasPrefix("private|") }
        latestPrivateResponseId = nil
        send(["type": "hold_start", "holdId": holdId])
    }

    func holdEnd(holdId: String, completion: (() -> Void)? = nil) {
        stateLock.lock()
        if captureHoldId == holdId { captureHoldId = nil }
        stateLock.unlock()
        guard state == .ready else {
            // There is no socket frame to queue after a transport failure.
            // Still notify the owner so it can perform its safe fail-closed
            // transition on release.
            completion?()
            return
        }
        send(["type": "hold_end", "holdId": holdId], completion: completion)
    }

    private func send(_ object: [String: Any], completion: (() -> Void)? = nil) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        sendQueue.async { [weak self] in
            guard let self, self.state != .stopped else { return }
            self.currentSocket()?.send(.string(text)) { [weak self] error in
                if let error { self?.fail(error) }
                else { completion?() }
            }
        }
    }

    private func receiveNext() {
        guard let socket = currentSocket() else { return }
        socket.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error): self.fail(error)
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    DispatchQueue.main.async { [weak self] in self?.consume(json) }
                }
                self.receiveNext()
            @unknown default: break
            }
        }
    }

    private func consume(_ json: [String: Any]) {
        switch json["type"] as? String {
        case "ready":
            stateLock.lock()
            ownerTranscriptSupported = (json["capabilities"] as? [String])?.contains("owner_transcript") == true
            stateLock.unlock()
            setState(.ready)
            emit { $0.onReady?() }
        case "hold_ready":
            if let holdId = json["holdId"] as? String {
                emit { $0.onHoldReady?(holdId) }
            }
        case "source_text":
            if let direction = json["direction"] as? String,
               let text = json["text"] as? String {
                let hold = holdId(in: json)
                if direction == "private" {
                    guard hold == currentDisplayHoldId() else { return }
                }
                if direction == "guest" || direction == "owner" || direction == "private" {
                    let item = json["itemId"] as? String
                    emit { $0.onSourceText?(direction, text, item) }
                }
            }
        case "guest_text", "text":
            if json["direction"] as? String == "private" {
                if let text = json["text"] as? String { emit { $0.onPrivateText?(text) } }
            } else if let text = json["text"] as? String {
                emit { $0.onGuestText?(text, nil) }
            }
        case "text_delta":
            consumeTextDelta(json)
        case "text_done":
            consumeTextDone(json)
        case "private_text":
            if let text = json["text"] as? String { emit { $0.onPrivateText?(text) } }
        case "error":
            fail(nil)
        default: break
        }
    }

    /// Realtime responses use `responseId` (some server revisions used
    /// `response_id`). Missing IDs are ignored rather than accidentally
    /// merging two unrelated responses.
    private func consumeTextDelta(_ json: [String: Any]) {
        guard let responseId = responseId(in: json),
              let direction = json["direction"] as? String,
              let delta = (json["delta"] as? String) ?? (json["text"] as? String),
              direction == "guest" || direction == "private" else { return }
        guard accepts(responseId: responseId, direction: direction, holdId: holdId(in: json)) else { return }
        let key = "\(direction)|\(responseId)"
        responseDeltas[key, default: ""] += delta
        let text = responseDeltas[key] ?? ""
        if direction == "private" {
            latestPrivateResponseId = responseId
            emit { $0.onPrivateText?(text) }
        } else {
            latestGuestResponseId = responseId
            let item = json["itemId"] as? String
            emit { $0.onGuestText?(text, item) }
        }
    }

    private func consumeTextDone(_ json: [String: Any]) {
        guard let responseId = responseId(in: json),
              let direction = json["direction"] as? String,
              direction == "guest" || direction == "private",
              acceptsDone(responseId: responseId, direction: direction, holdId: holdId(in: json)) else { return }
        let key = "\(direction)|\(responseId)"
        let text = (json["text"] as? String) ?? responseDeltas[key] ?? ""
        responseDeltas.removeValue(forKey: key)
        // A late done for an older response must not replace the phrase from
        // the response currently being streamed.
        if direction == "private" {
            emit { $0.onPrivateText?(text) }
        } else {
            let item = json["itemId"] as? String
            emit { $0.onGuestText?(text, item) }
        }
    }

    private func responseId(in json: [String: Any]) -> String? {
        let id = (json["responseId"] as? String) ?? (json["response_id"] as? String)
        guard let id, !id.isEmpty else { return nil }
        return id
    }

    private func holdId(in json: [String: Any]) -> String? {
        (json["holdId"] as? String) ?? (json["hold_id"] as? String)
    }

    private func accepts(responseId: String, direction: String, holdId: String?) -> Bool {
        if direction == "private" {
            // Private output is scoped to the hold that created it. A server
            // response without that scope is never allowed onto this screen.
            guard let active = currentDisplayHoldId(), holdId == active else { return false }
            if latestPrivateResponseId != responseId {
                responseDeltas = responseDeltas.filter { !$0.key.hasPrefix("private|") }
            }
        } else if latestGuestResponseId != responseId {
            responseDeltas = responseDeltas.filter { !$0.key.hasPrefix("guest|") }
        }
        return true
    }

    private func acceptsDone(responseId: String, direction: String, holdId: String?) -> Bool {
        if direction == "private" {
            guard let active = currentDisplayHoldId(), holdId == active else { return false }
            if let latest = latestPrivateResponseId, latest != responseId { return false }
            latestPrivateResponseId = responseId
        } else if let latest = latestGuestResponseId, latest != responseId {
            return false
        } else {
            latestGuestResponseId = responseId
        }
        return true
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        send(["type": "start", "callSid": callSid, "language": language,
              "sampleRateHz": sampleRateHz, "conversationFeed": true])
        receiveNext()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        if error != nil { fail(error) }
    }

    private func setState(_ value: State) {
        stateLock.lock(); currentState = value; stateLock.unlock()
    }

    private func currentSocket() -> URLSessionWebSocketTask? {
        stateLock.lock(); defer { stateLock.unlock() }
        return socket
    }

    private func currentHoldId() -> String? {
        stateLock.lock(); defer { stateLock.unlock() }
        return displayHoldId
    }

    private func currentDisplayHoldId() -> String? {
        currentHoldId()
    }

    private func currentCaptureHoldId() -> String? {
        stateLock.lock(); defer { stateLock.unlock() }
        return captureHoldId
    }

    private func emit(_ callback: @escaping (CopilotStream) -> Void) {
        DispatchQueue.main.async { [weak self] in
            if let self { callback(self) }
        }
    }

    private func fail(_ error: Error?) {
        setState(.stopped)
        emit { $0.onFailure?(error) }
    }
}