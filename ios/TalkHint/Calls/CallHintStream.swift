import Foundation

/// A single item rendered in the in-call assistant feed.
enum CallHintEvent: Equatable {
    /// What the caller (the other party) said, optionally translated.
    case guestTranscript(text: String, translation: String?, isFinal: Bool)
    /// What the user (the phone owner) said. `confidence` is the STT confidence
    /// score when the server provides one (used to filter garbled finals).
    case ownerTranscript(text: String, confidence: Double?, isFinal: Bool)
    /// A GPT reply suggestion for the user to say, with its translation.
    case suggestion(en: String, translation: String?)
    /// A low-latency "fast layer" phrase to fill a pause.
    case fastPhrase(text: String, translation: String?)
    /// A reply to a question the user typed via "Ask AI".
    case aiResponse(text: String, isError: Bool)
}

protocol CallHintStreamDelegate: AnyObject {
    func callHintStream(_ stream: CallHintStream, didReceive event: CallHintEvent)
    func callHintStreamDidConnect(_ stream: CallHintStream)
    func callHintStreamDidDisconnect(_ stream: CallHintStream)
}

/// Subscribes to the backend `/ui` WebSocket and surfaces live transcripts and
/// AI hints during an active call. Authenticates with the user's session token
/// (passed as a query param) so it connects "as the same user".
///
/// Lifecycle is driven by `CallManager`: `connect()` on call connect,
/// `disconnect()` on call end. The task auto-reconnects while it is supposed to
/// be running, so a brief network blip during a call does not lose the feed.
final class CallHintStream: NSObject {
    weak var delegate: CallHintStreamDelegate?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var isActive = false
    private var reconnectAttempts = 0

    /// Starts the connection. Safe to call once per call session.
    func connect() {
        guard !isActive else { return }
        isActive = true
        reconnectAttempts = 0
        openSocket()
    }

    /// Tears the connection down cleanly. Safe to call multiple times.
    func disconnect() {
        isActive = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    /// Sends a free-form question to the assistant. The reply arrives as an
    /// `ai_response` event on the feed.
    func askAI(_ question: String, goal: String? = nil) {
        var payload: [String: Any] = ["type": "ask_ai", "question": question]
        if let goal = goal, !goal.isEmpty { payload["goal"] = goal }
        send(payload)
    }

    /// Sets (or updates) the goal for the active call.
    func setGoal(_ goal: String) {
        send(["type": "set_goal", "goal": goal])
    }

    /// Sets the native language used for translations/hints. Server honors
    /// "ru" / "es".
    func setLanguage(_ language: String) {
        send(["type": "set_language", "language": language])
    }

    /// Sets the built-in assistant mode (universal / massage / dispatcher).
    func setMode(_ mode: String) {
        send(["type": "set_mode", "mode": mode])
    }

    /// Pushes the user's saved Assistant-tab selections (mode, language, goal) to
    /// the live socket so each call reflects what they chose. Called right after
    /// the socket connects.
    private func applyPersistedSelections() {
        let store = SessionStore.shared
        setMode(store.activeMode)
        setLanguage(store.language)
        let goal = store.callGoal.trimmingCharacters(in: .whitespacesAndNewlines)
        if !goal.isEmpty {
            setGoal(goal)
        }
    }

    private func send(_ payload: [String: Any]) {
        guard let task = task,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private func openSocket() {
        guard isActive, let token = SessionStore.shared.token else { return }

        var components = URLComponents(
            url: AppConfig.webSocketBaseURL.appendingPathComponent("ui"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else { return }

        let session = URLSession(configuration: .default)
        self.session = session
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        receiveNext()
        applyPersistedSelections()

        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.isActive else { return }
            self.delegate?.callHintStreamDidConnect(self)
        }
    }

    private func receiveNext() {
        task?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure:
                self.handleDisconnect()
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(text: text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handle(text: text)
                    }
                @unknown default:
                    break
                }
                self.receiveNext()
            }
        }
    }

    private func handleDisconnect() {
        guard isActive else { return }
        // Connection dropped mid-call: notify and retry with backoff.
        task = nil
        session?.invalidateAndCancel()
        session = nil

        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.isActive else { return }
            self.delegate?.callHintStreamDidDisconnect(self)
        }

        reconnectAttempts += 1
        let delay = min(Double(reconnectAttempts) * 1.5, 6.0)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, self.isActive else { return }
            self.openSocket()
        }
    }

    private func handle(text: String) {
        guard let event = CallHintStream.decode(text) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.delegate?.callHintStream(self, didReceive: event)
        }
    }

    /// Pure parser for a single `/ui` WebSocket text frame. Returns the decoded
    /// `CallHintEvent`, or `nil` when the payload is malformed, has an unknown
    /// `type`, or carries an empty body. Kept side-effect free (no networking, no
    /// dispatching) so it can be unit-tested directly.
    static func decode(_ text: String) -> CallHintEvent? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return nil }

        switch type {
        case "guest_transcript":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .guestTranscript(
                text: body,
                translation: nonEmpty(obj["translation"]),
                isFinal: (obj["isFinal"] as? Bool) ?? false
            )
        case "owner_transcript":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .ownerTranscript(
                text: body,
                confidence: (obj["confidence"] as? NSNumber)?.doubleValue,
                isFinal: (obj["isFinal"] as? Bool) ?? false
            )
        case "suggestion":
            guard let en = obj["en"] as? String, !en.isEmpty else { return nil }
            return .suggestion(en: en, translation: nonEmpty(obj["translation"]))
        case "fast_phrase":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .fastPhrase(text: body, translation: nonEmpty(obj["translation"]))
        case "ai_response":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .aiResponse(text: body, isError: (obj["error"] as? Bool) ?? false)
        default:
            return nil
        }
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let s = value as? String, !s.isEmpty else { return nil }
        return s
    }
}
