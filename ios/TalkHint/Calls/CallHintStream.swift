import Foundation

/// A single item rendered in the in-call assistant feed.
enum CallHintEvent: Equatable {
    /// What the caller (the other party) said, optionally translated.
    /// `confidence` is the STT confidence score when the server provides one
    /// (used to filter garbled finals on the CALLER line).
    case guestTranscript(text: String, translation: String?, confidence: Double?, isFinal: Bool)
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
    /// The socket dropped mid-call and the stream is about to retry. `attempt` is
    /// the 1-based count of consecutive failed reconnects so far and `maxAttempts`
    /// is the give-up ceiling, so the UI can convey recovery progress (e.g.
    /// "attempt 2 of 5") instead of a static "Reconnecting…" label before the
    /// terminal `callHintStreamDidFailTerminally` state is reached.
    func callHintStream(_ stream: CallHintStream,
                        didDisconnectWillRetryAttempt attempt: Int,
                        of maxAttempts: Int)
    /// The socket dropped and reconnecting failed `maxReconnectAttempts` times in
    /// a row, so the stream has given up. The feed is now stopped (no further
    /// auto-reconnects); the UI should surface a terminal "connection lost" state
    /// and offer the user a way to retry via `retry()`.
    func callHintStreamDidFailTerminally(_ stream: CallHintStream)
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
    /// Whether the stream currently considers itself live — `true` from `connect()`
    /// (and through auto-reconnect attempts) until `disconnect()` or a terminal
    /// give-up. The setter stays private; the getter is exposed so tests can
    /// confirm the manual `retry()` path actually re-armed the stream rather than
    /// no-opping.
    private(set) var isActive = false
    private var reconnectAttempts = 0

    /// Starts the connection. Safe to call once per call session.
    func connect() {
        guard !isActive else { return }
        isActive = true
        reconnectAttempts = 0
        openSocket()
    }

    /// Re-arms the stream after it gave up (see `callHintStreamDidFailTerminally`).
    /// Backs the user-facing "retry" affordance: resets the failure counter and
    /// reopens the socket. No-op while the stream is already active.
    func retry() {
        guard !isActive else { return }
        connect()
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
        send(CallHintStream.askAIPayload(question: question, goal: goal))
    }

    /// Sets (or updates) the goal for the active call.
    func setGoal(_ goal: String) {
        send(CallHintStream.setGoalPayload(goal: goal))
    }

    /// Sets the native language used for translations/hints. Server honors
    /// "ru" / "es".
    func setLanguage(_ language: String) {
        send(CallHintStream.setLanguagePayload(language: language))
    }

    /// Sets the built-in assistant mode (universal / massage / dispatcher).
    func setMode(_ mode: String) {
        send(CallHintStream.setModePayload(mode: mode))
    }

    // MARK: - Pure outgoing-payload builders
    //
    // These mirror `decode(_:)` on the inbound side: side-effect free (no
    // networking, no dispatch) so the exact JSON contract sent to the backend
    // can be unit-tested directly. A renamed key or dropped field (e.g.
    // "question", "goal", "language", "mode") would silently break live-call
    // control, so the builders are the single source of truth for what we send.

    /// Builds the `ask_ai` control message. The optional `goal` is omitted
    /// entirely when nil or empty (the server treats an absent goal as "unchanged").
    static func askAIPayload(question: String, goal: String? = nil) -> [String: Any] {
        var payload: [String: Any] = ["type": "ask_ai", "question": question]
        if let goal = goal, !goal.isEmpty { payload["goal"] = goal }
        return payload
    }

    /// Builds the `set_goal` control message.
    static func setGoalPayload(goal: String) -> [String: Any] {
        ["type": "set_goal", "goal": goal]
    }

    /// Builds the `set_language` control message.
    static func setLanguagePayload(language: String) -> [String: Any] {
        ["type": "set_language", "language": language]
    }

    /// Builds the `set_mode` control message.
    static func setModePayload(mode: String) -> [String: Any] {
        ["type": "set_mode", "mode": mode]
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

        reconnectAttempts += 1

        // Give up after too many consecutive failures (server outage, revoked
        // auth, etc.) instead of retrying forever behind a frozen feed. Surface a
        // terminal state the UI can show, and stop so the user can retry by hand.
        if CallHintStream.shouldGiveUp(after: reconnectAttempts) {
            isActive = false
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.callHintStreamDidFailTerminally(self)
            }
            return
        }

        let attempt = reconnectAttempts
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.isActive else { return }
            self.delegate?.callHintStream(self,
                                          didDisconnectWillRetryAttempt: attempt,
                                          of: CallHintStream.maxReconnectAttempts)
        }

        let delay = CallHintStream.reconnectDelay(for: reconnectAttempts)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, self.isActive else { return }
            self.openSocket()
        }
    }

    /// Maximum number of consecutive failed reconnects before the stream gives up
    /// and reports a terminal failure instead of retrying indefinitely.
    static let maxReconnectAttempts = 5

    /// Whether the stream should stop retrying after `attempt` consecutive failed
    /// reconnects. Returns `true` once the count reaches `maxReconnectAttempts`.
    ///
    /// Pure (no networking, no dispatch) so the give-up threshold can be
    /// unit-tested directly — a bad edit (off-by-one, dropped ceiling) would
    /// otherwise either strand users on a frozen feed forever or give up after a
    /// single blip, the same silent-regression risk the timing tests guard against.
    static func shouldGiveUp(after attempt: Int) -> Bool {
        attempt >= maxReconnectAttempts
    }

    /// Backoff delay (seconds) before the `attempt`-th reconnect after the live
    /// `/ui` socket drops mid-call. Grows linearly with the attempt count and is
    /// capped at 6s so retries neither hammer the server nor stall the feed.
    ///
    /// Pure (no networking, no dispatch) so the timing contract can be unit-tested
    /// directly — a bad edit (dropped cap, zeroed multiplier) would otherwise be a
    /// silent regression, the same risk the decode/encode tests guard against.
    static func reconnectDelay(for attempt: Int) -> Double {
        min(Double(attempt) * 1.5, 6.0)
    }

    /// Human-readable status line shown while the live `/ui` socket is retrying
    /// mid-call. Surfaces the 1-based `attempt` count out of `maxAttempts` so the
    /// feed conveys progress (not a frozen "Reconnecting…"), and escalates the
    /// wording on the final attempt before the terminal give-up state.
    ///
    /// Pure (no networking, no dispatch) so the transient-state copy can be
    /// unit-tested directly, mirroring the timing / give-up helpers — a dropped
    /// attempt count or lost escalation would otherwise be a silent UX regression.
    static func reconnectingStatusText(attempt: Int, of maxAttempts: Int) -> String {
        let lead = attempt >= maxAttempts
            ? "Still trying to reconnect"
            : "Reconnecting to live assistant"
        return "\(lead)… (attempt \(attempt) of \(maxAttempts))"
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
                confidence: (obj["confidence"] as? NSNumber)?.doubleValue,
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
