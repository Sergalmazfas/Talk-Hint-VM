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
    /// The server confirmed the call goal (set before/at call start). Rendered
    /// as a compact event in the conversation feed, not a persistent banner.
    case goalSet(text: String)
    /// The active goal changed mid-call (e.g. the user redefined it via the
    /// assistant input). Rendered as a compact "Goal updated" feed event.
    case goalUpdated(text: String)
    /// PREPARE stage: Sol's conversational reply. `proposedGoal` is non-nil when
    /// the model is proposing a compact call goal for explicit confirmation.
    case prepareReply(text: String, proposedGoal: String?)
    /// PREPARE stage: the goal was confirmed and Sol produced the opening phrase
    /// (American English + translation into the user's language).
    case prepareOpening(phraseEn: String, translation: String?)
    /// PREPARE stage: an honest, user-facing failure (Sol unavailable, reset
    /// mid-flight, …). The text is safe to show verbatim — never substituted.
    case prepareError(text: String)
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
    /// The stream cannot authenticate because there is no valid session token —
    /// the user is signed out. The stream has stopped (`isActive == false`) and
    /// will not retry on its own. Distinct from `callHintStreamDidFailTerminally`
    /// (a network/server give-up): here the user must sign in, so the UI should
    /// surface an actionable "sign in" state rather than a stuck "Reconnecting…"
    /// label. This is the silent-failure case the manual-reconnect retry path
    /// would otherwise hit when `openSocket()` returns early with no token.
    func callHintStreamDidRequireSignIn(_ stream: CallHintStream)
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

    // MARK: - PREPARE stage (pre-call preparation chat)

    /// Sends one PREPARE turn (typed or transcribed). The reply arrives as a
    /// `prepareReply` event (or `prepareError` on an honest failure).
    ///
    /// `clientMessageId` makes retries idempotent: resending the SAME text with
    /// the SAME id after a reconnect returns the original server reply instead
    /// of creating a duplicate user turn (server-side dedup in prepare.ts).
    /// Returns `false` when there is no open socket — the caller must keep the
    /// text pending and resend after reconnect instead of losing it.
    @discardableResult
    func sendPrepareMessage(_ text: String, clientMessageId: String? = nil) -> Bool {
        send(CallHintStream.prepareMessagePayload(text: text, clientMessageId: clientMessageId))
    }

    /// Confirms the proposed call goal. The server activates it via the existing
    /// goal mechanism (a `goal_set` event echoes back) and then delivers the
    /// opening phrase as a `prepareOpening` event.
    ///
    /// `clientMessageId` makes confirmation retries idempotent: a reconnect
    /// resend with the same id replays the original opening phrase instead of
    /// re-firing goal side effects or generating a second opening.
    /// Returns `false` when there is no open socket.
    @discardableResult
    func confirmPrepareGoal(_ goal: String, clientMessageId: String? = nil) -> Bool {
        send(CallHintStream.prepareConfirmGoalPayload(goal: goal, clientMessageId: clientMessageId))
    }

    /// Resets the server-side PREPARE conversation so the next preparation
    /// starts from a clean slate.
    func resetPrepare() {
        send(CallHintStream.prepareResetPayload())
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

    /// Builds the `suggestion_ack` delivery confirmation for an inbound
    /// `suggestion` frame, or `nil` when the frame is not a suggestion or lacks
    /// the identifiers (`utteranceId` + `callSid`) the server needs to attribute
    /// the ack. Pure (no networking) so the ack contract is unit-testable —
    /// a dropped field here would silently zero out device-delivery latency data.
    static func suggestionAckPayload(forFrame text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["type"] as? String) == "suggestion",
              let utteranceId = obj["utteranceId"] as? NSNumber,
              let callSid = obj["callSid"] as? String, !callSid.isEmpty else { return nil }
        return ["type": "suggestion_ack", "utteranceId": utteranceId, "callSid": callSid]
    }

    /// Builds the `prepare_message` control message (one PREPARE turn). The
    /// optional `clientMessageId` is the idempotency key for reconnect resends.
    static func prepareMessagePayload(text: String, clientMessageId: String? = nil) -> [String: Any] {
        var payload: [String: Any] = ["type": "prepare_message", "text": text]
        if let id = clientMessageId, !id.isEmpty { payload["clientMessageId"] = id }
        return payload
    }

    /// Builds the `prepare_confirm_goal` control message. The optional
    /// `clientMessageId` is the idempotency key for reconnect resends.
    static func prepareConfirmGoalPayload(goal: String, clientMessageId: String? = nil) -> [String: Any] {
        var payload: [String: Any] = ["type": "prepare_confirm_goal", "goal": goal]
        if let id = clientMessageId, !id.isEmpty { payload["clientMessageId"] = id }
        return payload
    }

    /// Builds the `prepare_reset` control message.
    static func prepareResetPayload() -> [String: Any] {
        ["type": "prepare_reset"]
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

    /// Serializes and sends a control payload. Returns `false` (instead of
    /// silently dropping the message) when there is no open socket, so callers
    /// with user-typed content can preserve it for a retry.
    @discardableResult
    private func send(_ payload: [String: Any]) -> Bool {
        guard let task = task,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return false }
        task.send(.string(text)) { _ in }
        return true
    }

    private func openSocket() {
        guard isActive else { return }

        // No valid session token means the user is signed out, so the live `/ui`
        // socket can never authenticate. Stop the stream and surface an actionable
        // "sign in" state instead of silently leaving `isActive == true` (which
        // would strand the manual "Reconnect" path on a frozen "Reconnecting…"
        // label with no recovery).
        guard let token = SessionStore.shared.token, !token.isEmpty else {
            isActive = false
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.callHintStreamDidRequireSignIn(self)
            }
            return
        }

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

        // The server rejects an expired/revoked session by refusing the WebSocket
        // upgrade with an HTTP 401 (see `setupWebSocket` on the backend), which
        // surfaces here as the handshake response on the failed task. The decision
        // of how to react — sign-in vs. terminal give-up vs. another retry — is
        // factored into the pure `disconnectAction(...)` below so it can be
        // unit-tested without a live socket; this method just reads the handshake
        // status, tears the socket down, and applies the chosen action.
        let statusCode = (task?.response as? HTTPURLResponse)?.statusCode

        // Connection dropped mid-call: tear the socket down before reacting.
        task = nil
        session?.invalidateAndCancel()
        session = nil

        switch CallHintStream.disconnectAction(handshakeStatusCode: statusCode,
                                               priorAttempts: reconnectAttempts) {
        case .signIn:
            // Auth rejection (expired/revoked session): stop and surface the
            // actionable "sign in" state instead of retrying into the misleading
            // "Live assistant unavailable. Check your connection." terminal path —
            // same recovery affordance as the no-token case in `openSocket()`.
            isActive = false
            reconnectAttempts = 0
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.callHintStreamDidRequireSignIn(self)
            }

        case .giveUp:
            // Too many consecutive failures (server outage, etc.): stop retrying
            // behind a frozen feed and surface a terminal state the user can
            // retry by hand.
            reconnectAttempts += 1
            isActive = false
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.callHintStreamDidFailTerminally(self)
            }

        case .retry(let attempt):
            // Transient drop: notify progress and reconnect with backoff.
            reconnectAttempts = attempt
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.isActive else { return }
                self.delegate?.callHintStream(self,
                                              didDisconnectWillRetryAttempt: attempt,
                                              of: CallHintStream.maxReconnectAttempts)
            }

            let delay = CallHintStream.reconnectDelay(for: attempt)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self = self, self.isActive else { return }
                self.openSocket()
            }
        }
    }

    /// How the stream should react to a mid-call `/ui` socket drop, decided purely
    /// from the failed handshake's HTTP status and the count of prior consecutive
    /// reconnect failures.
    enum DisconnectAction: Equatable {
        /// The session is expired/revoked (auth rejection): stop and demand sign-in.
        case signIn
        /// Too many consecutive failures: stop and report a terminal failure.
        case giveUp
        /// A transient drop: reconnect as the given 1-based attempt number.
        case retry(attempt: Int)
    }

    /// Pure decision for `handleDisconnect`: maps a failed handshake status code
    /// and the prior reconnect-attempt count to the action the stream should take.
    /// An auth rejection (401/403) always routes to `.signIn`; otherwise the next
    /// attempt either trips the give-up ceiling (`.giveUp`) or schedules another
    /// `.retry`.
    ///
    /// Side-effect free (no networking, no dispatch) so the disconnect wiring —
    /// specifically the sign-in vs. reconnect branch the live `handleDisconnect`
    /// takes — can be unit-tested directly without a live socket. A bad edit
    /// (sending expired sessions down the retry path, or auth rejections into a
    /// reconnect loop) would otherwise be a silent regression, the same risk the
    /// `isAuthRejection` / give-up / timing helpers guard against.
    static func disconnectAction(handshakeStatusCode statusCode: Int?,
                                 priorAttempts: Int) -> DisconnectAction {
        if isAuthRejection(statusCode: statusCode) { return .signIn }
        let attempt = priorAttempts + 1
        if shouldGiveUp(after: attempt) { return .giveUp }
        return .retry(attempt: attempt)
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

    /// Whether a dropped `/ui` socket was an authentication rejection (the
    /// session token is expired or revoked) rather than a transient network
    /// failure. The backend refuses an unauthenticated WebSocket upgrade with an
    /// HTTP 401 (see `setupWebSocket`); 403 is treated the same way defensively.
    /// When `true`, the stream must surface `callHintStreamDidRequireSignIn` (the
    /// actionable "sign in" state) instead of retrying as a network blip and
    /// stranding the user on the misleading "connection lost" terminal state.
    ///
    /// Pure (no networking, no dispatch) so the auth-vs-network distinction can be
    /// unit-tested directly — a bad edit (matching the wrong codes, dropping the
    /// nil guard) would otherwise silently send expired-session users down the
    /// dead-end retry path, the same silent-regression risk the other helpers
    /// guard against.
    static func isAuthRejection(statusCode: Int?) -> Bool {
        guard let code = statusCode else { return false }
        return code == 401 || code == 403
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
            // Delivery ack: sent AFTER the delegate has rendered the suggestion
            // on the main queue, so the server-side "delivered" stage measures
            // the hint actually reaching the screen — not just socket arrival.
            if let ack = CallHintStream.suggestionAckPayload(forFrame: text) {
                self.send(ack)
            }
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
        case "goal_set":
            guard let body = obj["goal"] as? String, !body.isEmpty else { return nil }
            return .goalSet(text: body)
        case "goal_updated":
            guard let body = obj["goal"] as? String, !body.isEmpty else { return nil }
            return .goalUpdated(text: body)
        case "prepare_reply":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .prepareReply(text: body, proposedGoal: nonEmpty(obj["proposedGoal"]))
        case "prepare_opening":
            guard let phrase = obj["phraseEn"] as? String, !phrase.isEmpty else { return nil }
            return .prepareOpening(phraseEn: phrase, translation: nonEmpty(obj["translation"]))
        case "prepare_error":
            guard let body = obj["text"] as? String, !body.isEmpty else { return nil }
            return .prepareError(text: body)
        default:
            return nil
        }
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let s = value as? String, !s.isEmpty else { return nil }
        return s
    }
}
