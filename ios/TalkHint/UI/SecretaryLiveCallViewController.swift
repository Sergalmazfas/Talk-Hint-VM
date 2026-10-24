import UIKit
import AVFoundation

/// Live Secretary call monitor. The app only receives server-mixed call audio;
/// this controller never opens, records, or sends the iPhone microphone.
final class SecretaryLiveCallViewController: UIViewController {
    private let task: APIClient.SecretaryTask
    private let scrollView = UIScrollView()
    private let feed = UIStackView()
    private let statusLabel = UILabel()
    private let sourceStatusLabel = UILabel()
    private let routeButton = UIButton(type: .system)
    private let endButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private let routeCaption = UILabel()
    private var monitorState = SecretaryMonitorState()
    private var monitorError: String?
    private var hasSourceMonitoring = false
    private var sourceConnected: Bool?
    private var sourceReconnectSupported: Bool?
    private var guestTrackReceived: Bool?
    private var secretaryTrackReceived: Bool?
    private var sourceTransport: String?
    private var audioWatchdog: Timer?
    private var lastAudioAt = Date()
    private var audioRecoveryWork: DispatchWorkItem?
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var stream: SecretaryLiveCallStream?
    private var isSpeaker = true
    private var didEnd = false
    private var audioSessionActive = false
    private var isMonitorVisible = false
    private var reconnectWork: DispatchWorkItem?
    private var connectionTimeout: DispatchWorkItem?
    private var reconnectAttempt = 0
    private var renderedTranscript: String?
    private var turnCardsByID: [String: SecretaryTurnCard] = [:]
    var onFeedSubscriptionRequested: (() -> Void)?
    var audioPlaybackConfigurationForTesting: (() -> Bool)?
    var onCallEnded: (() -> Void)?

    init(task: APIClient.SecretaryTask) {
        self.task = task
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = NSLocalizedString("secretary.live.title", comment: "")
        navigationItem.hidesBackButton = true
        buildUI()
        observeLifecycle()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        isMonitorVisible = true
        guard !didEnd else { return }
        if canPlaySourceAudio {
            _ = configureAudioPlayback()
        } else {
            showSourceUnavailable()
        }
        // Subscribe to the read-only monitor feed even when the last reported
        // source state was absent. It may have started while this screen was away.
        connectStream()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        isMonitorVisible = false
        connectionTimeout?.cancel()
        reconnectWork?.cancel()
        stream?.disconnect()
        stream = nil
        // Leaving this read-only monitor must not hang up the server's call.
        stopPlayback()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        stream?.disconnect()
        stopPlayback()
    }

    private func buildUI() {
        statusLabel.text = NSLocalizedString(
            hasSourceMonitoring ? "secretary.live.feed_connecting" : "secretary.live.connecting",
            comment: "")
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.accessibilityIdentifier = "text-secretary-live-status"

        spinner.hidesWhenStopped = true
        spinner.startAnimating()

        let heading = UILabel()
        heading.text = task.phoneNumber
        heading.font = .systemFont(
            ofSize: UIFont.preferredFont(forTextStyle: .title2).pointSize,
            weight: .bold)
        heading.textAlignment = .center
        heading.numberOfLines = 1

        let description = UILabel()
        description.text = task.instruction
        description.font = .preferredFont(forTextStyle: .subheadline)
        description.textColor = .secondaryLabel
        description.numberOfLines = 3
        description.textAlignment = .center


        retryButton.setTitle(NSLocalizedString("secretary.live.retry", comment: ""), for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        retryButton.isHidden = true
        retryButton.accessibilityIdentifier = "button-secretary-live-retry"
        retryButton.addTarget(self, action: #selector(retryConnection), for: .touchUpInside)
        let statusRow = UIStackView(arrangedSubviews: [spinner, statusLabel, retryButton])
        statusRow.axis = .horizontal
        statusRow.alignment = .center
        statusRow.spacing = 8
        statusRow.distribution = .fill
        statusRow.translatesAutoresizingMaskIntoConstraints = false

        sourceStatusLabel.font = .preferredFont(forTextStyle: .footnote)
        sourceStatusLabel.textColor = .secondaryLabel
        sourceStatusLabel.numberOfLines = 0
        sourceStatusLabel.textAlignment = .center
        sourceStatusLabel.isHidden = true
        sourceStatusLabel.accessibilityIdentifier = "text-secretary-source-status"

        feed.axis = .vertical
        feed.spacing = 10
        feed.accessibilityIdentifier = "feed-secretary-live-transcript"
        feed.translatesAutoresizingMaskIntoConstraints = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-secretary-live-transcript"
        scrollView.addSubview(feed)

        configureCircle(routeButton, symbol: "speaker.wave.2.fill", color: Theme.green)
        routeButton.accessibilityIdentifier = "button-secretary-live-speaker"
        routeButton.addTarget(self, action: #selector(toggleSpeaker), for: .touchUpInside)
        configureCircle(endButton, symbol: "phone.down.fill", color: .systemRed)
        endButton.tintColor = .white
        endButton.accessibilityIdentifier = "button-secretary-live-end"
        endButton.accessibilityLabel = NSLocalizedString("secretary.live.end", comment: "")
        endButton.addTarget(self, action: #selector(endCallTapped), for: .touchUpInside)

        routeCaption.font = .systemFont(ofSize: 11)
        routeCaption.textColor = .secondaryLabel
        routeCaption.textAlignment = .center
        let endCaption = UILabel()
        endCaption.text = NSLocalizedString("secretary.live.end", comment: "")
        endCaption.font = .systemFont(ofSize: 11)
        endCaption.textColor = .secondaryLabel
        endCaption.textAlignment = .center
        let controls = UIStackView(arrangedSubviews: [
            verticalControl(button: routeButton, caption: routeCaption),
            verticalControl(button: endButton, caption: endCaption),
        ])
        controls.axis = .horizontal
        controls.alignment = .center
        controls.distribution = .equalCentering
        controls.translatesAutoresizingMaskIntoConstraints = false

        let header = UIStackView(arrangedSubviews: [heading, description, statusRow, sourceStatusLabel])
        header.axis = .vertical
        header.alignment = .fill
        header.spacing = 10
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        view.addSubview(scrollView)
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
            header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            header.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),

            scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 16),
            scrollView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -20),

            feed.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feed.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -12),
            feed.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feed.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),

            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 48),
            controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -48),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18),
        ])
    }

    private func configureCircle(_ button: UIButton, symbol: String, color: UIColor) {
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = color
        button.backgroundColor = color.withAlphaComponent(0.12)
        button.layer.cornerRadius = 27
        button.widthAnchor.constraint(equalToConstant: 54).isActive = true
        button.heightAnchor.constraint(equalToConstant: 54).isActive = true
    }

    private func verticalControl(button: UIButton, caption: UILabel) -> UIView {
        let stack = UIStackView(arrangedSubviews: [button, caption])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 4
        return stack
    }

    private func configureAudioPlayback() -> Bool {
        guard isMonitorVisible, !didEnd else { return false }
        if let audioPlaybackConfigurationForTesting {
            return audioPlaybackConfigurationForTesting()
        }
        guard !CallManager.shared.hasPhoneAudioSession else {
            stopPlayback()
            setConnectionFailure(NSLocalizedString("secretary.live.audio_interrupted", comment: ""))
            return false
        }
        do {
            let session = AVAudioSession.sharedInstance()
            // playAndRecord supplies a controllable receiver/speaker route. No
            // input node, tap, recorder, or microphone permission is used.
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.allowBluetooth])
            try session.setActive(true)
            audioSessionActive = true
            try session.overrideOutputAudioPort(isSpeaker ? .speaker : .none)
            guard SecretaryAudioPlayer.shared.start() else {
                stopPlayback()
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return false
            }
            monitorState.resetAudio()
            monitorError = nil
            lastAudioAt = Date()
            NSLog("[SecretaryMonitor] route=%@ rate=%.0f volume=%.2f",
                  session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","),
                  session.sampleRate, session.outputVolume)
            SecretaryAudioPlayer.shared.onPlayed = { [weak self] in
                guard let self, self.isMonitorVisible, !self.didEnd else { return }
                self.monitorState.renderAudio()
                self.refreshMonitorStatus()
            }
            updateRouteControl()
            startAudioWatchdog()
            return true
        } catch {
            let failure = error as NSError
            NSLog("[SecretaryAudio] session failed (%@:%ld)", failure.domain, failure.code)
            stopPlayback()
            setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
            return false
        }
    }

    private func startAudioWatchdog() {
        audioWatchdog?.invalidate()
        audioWatchdog = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self, self.isMonitorVisible, !self.didEnd,
                  self.monitorState.connected, self.canPlaySourceAudio else { return }
            if Date().timeIntervalSince(self.lastAudioAt) > 8 {
                self.setConnectionFailure(NSLocalizedString("secretary.live.audio_missing", comment: ""))
            }
        }
    }

    private func observeLifecycle() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(audioConfigurationChanged),
            name: .AVAudioEngineConfigurationChange, object: SecretaryAudioPlayer.shared.engine)
        NotificationCenter.default.addObserver(
            self, selector: #selector(audioInterrupted(_:)),
            name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance())
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func audioConfigurationChanged() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.audioConfigurationChanged() }
            return
        }
        guard isMonitorVisible, !didEnd, audioSessionActive else { return }
        audioRecoveryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isMonitorVisible, !self.didEnd, self.audioSessionActive else { return }
            SecretaryAudioPlayer.shared.stop()
            guard self.configureAudioPlayback() else { return }
            self.refreshMonitorStatus()
        }
        audioRecoveryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func connectStream() {
        guard isMonitorVisible, !didEnd, UIApplication.shared.applicationState == .active else { return }
        onFeedSubscriptionRequested?()
        guard let token = SessionStore.shared.token, !token.isEmpty else {
            setConnectionFailure(NSLocalizedString("secretary.live.sign_in", comment: ""))
            return
        }
        stream?.disconnect()
        monitorState.reset()
        monitorError = nil
        lastAudioAt = Date()
        startAudioWatchdog()
        let liveStream = SecretaryLiveCallStream(taskID: task.id, token: token)
        stream = liveStream
        liveStream.onMessage = { [weak self, weak liveStream] message in
            guard let self, self.stream === liveStream else { return }
            self.receive(message)
        }
        liveStream.onDisconnect = { [weak self, weak liveStream] error in
            guard let self, self.stream === liveStream else { return }
            self.handleDisconnect(error)
        }
        liveStream.connect()
        spinner.startAnimating()
        statusLabel.textColor = .secondaryLabel
        statusLabel.text = NSLocalizedString(
            hasSourceMonitoring ? "secretary.live.feed_connecting" : "secretary.live.connecting",
            comment: "")
        retryButton.isHidden = true
        let timeout = DispatchWorkItem { [weak self, weak liveStream] in
            guard let self, let liveStream, self.stream === liveStream, !self.didEnd else { return }
            liveStream.disconnect()
            self.handleDisconnect(nil)
        }
        connectionTimeout?.cancel()
        connectionTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
    }

    private func receive(_ message: [String: Any]) {
        guard isMonitorVisible, !didEnd, let type = message["type"] as? String else { return }
        if let monitoring = message["monitoring"] as? [String: Any] {
            applyMonitoring(monitoring)
        } else if type == "monitor_state" {
            // monitor_state carries these fields at the top level. Older GPT
            // servers omit the capability entirely and retain legacy behavior.
            applyMonitoring(message)
        }
        connectionTimeout?.cancel()
        connectionTimeout = nil
        switch type {
        case "snapshot":
            reconnectAttempt = 0
            spinner.stopAnimating()
            monitorState.connect()
            if let snapshot = message["task"] as? [String: Any] {
                renderSnapshot(snapshot)
            }
            refreshMonitorStatus()
        case "turn":
            guard let role = message["role"] as? String,
                  let text = message["text"] as? String, !text.isEmpty else { return }
            spinner.stopAnimating()
            monitorState.connect()
            refreshMonitorStatus()
            let turnId = message["turnId"] as? String
            upsertTurn(id: turnId, role: role, text: text, translation: nil)
        case "monitor_state":
            spinner.stopAnimating()
            monitorState.connect()
            refreshMonitorStatus()
        case "subtitle", "subtitle_unavailable":
            break // Historical servers may still send these. Secretary shows original speech only.
        case "audio":
            if hasSourceMonitoring, sourceConnected != true { return }
            guard let role = message["role"] as? String,
                  let payload = message["payload"] as? String,
                  let data = Data(base64Encoded: payload), !data.isEmpty else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            guard SecretaryAudioPlayer.shared.isReady else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            guard SecretaryAudioPlayer.shared.enqueue(muLaw: data, role: role) else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            lastAudioAt = Date()
            if monitorError == NSLocalizedString("secretary.live.audio_missing", comment: "") {
                monitorError = nil
                retryButton.isHidden = true
            }
            monitorState.receiveAudio()
            refreshMonitorStatus()
        case "status":
            guard let status = message["status"] as? String else { return }
            if Self.isTerminal(status) {
                finishLiveCall(status: status)
            } else { refreshMonitorStatus() }
        default:
            break
        }
    }

    private var canPlaySourceAudio: Bool {
        // Missing metadata is the legacy GPT behavior. For the Retell source
        // protocol, wait for server confirmation before opening playback.
        !hasSourceMonitoring || sourceConnected == true
    }

    /// Server track receipt is intentionally separate from local playback:
    /// received packets cannot prove that audio was audible on this phone.
    func applyMonitoring(_ fields: [String: Any]) {
        let wasConnected = sourceConnected
        hasSourceMonitoring = true
        sourceTransport = fields["transport"] as? String
        sourceConnected = fields["sourceConnected"] as? Bool
        sourceReconnectSupported = fields["sourceReconnectSupported"] as? Bool
        guestTrackReceived = fields["guestReceived"] as? Bool
        secretaryTrackReceived = fields["secretaryReceived"] as? Bool
        updateSourceStatus()

        guard isMonitorVisible, !didEnd else { return }
        if sourceConnected == true, wasConnected != true {
            // The server says an existing source is connected. Re-arm only
            // local playback; never issue a source-start request.
            retryButton.isHidden = true
            guard configureAudioPlayback() else { return }
            refreshMonitorStatus()
        } else if sourceConnected != true {
            showSourceUnavailable()
        }
    }

    private func updateSourceStatus() {
        guard hasSourceMonitoring else {
            sourceStatusLabel.isHidden = true
            return
        }
        sourceStatusLabel.isHidden = false
        retryButton.setTitle(
            NSLocalizedString("secretary.live.feed_retry", comment: ""), for: .normal)
        if sourceConnected == true {
            sourceStatusLabel.text = String(
                format: NSLocalizedString("secretary.live.source.connected", comment: ""),
                sourceTransport ?? "—",
                localizedTrackReceipt(guestTrackReceived),
                localizedTrackReceipt(secretaryTrackReceived))
            sourceStatusLabel.textColor = .secondaryLabel
        } else if sourceConnected == false && sourceReconnectSupported == false {
            sourceStatusLabel.text = NSLocalizedString("secretary.live.source.unavailable", comment: "")
            sourceStatusLabel.textColor = .systemRed
        } else {
            sourceStatusLabel.text = NSLocalizedString("secretary.live.source.unknown", comment: "")
            sourceStatusLabel.textColor = .systemOrange
        }
    }

    private func localizedTrackReceipt(_ received: Bool?) -> String {
        guard let received else {
            return NSLocalizedString("secretary.live.source.receipt_unknown", comment: "")
        }
        return NSLocalizedString(
            received ? "secretary.live.source.received" : "secretary.live.source.not_received",
            comment: "")
    }

    private func showSourceUnavailable() {
        guard hasSourceMonitoring, sourceConnected != true else { return }
        // A missing source affects only local audio playback. The read-only feed
        // remains subscribed for transcript, status, and later source updates.
        monitorState.resetAudio()
        stopPlayback()
        let sourceDependentAudioErrors = [
            NSLocalizedString("secretary.live.audio_missing", comment: ""),
            NSLocalizedString("secretary.live.audio_failed", comment: ""),
        ]
        if let monitorError, sourceDependentAudioErrors.contains(monitorError) {
            self.monitorError = nil
        }
        if monitorState.connected { refreshMonitorStatus() }
    }

    // Shared rendering entry points are internal so UIKit regression tests can
    // replay real feed data without starting audio, transport or a phone call.
    func renderSnapshot(_ snapshot: [String: Any]) {
        var terminalStatus: String?
        defer {
            if let terminalStatus { finishLiveCall(status: terminalStatus) }
        }
        if let status = snapshot["status"] as? String {
            if Self.isTerminal(status) {
                statusLabel.text = taskStatusTitle(status)
                terminalStatus = status
            }
        }
        if let turns = snapshot["transcriptTurns"] as? [[String: Any]], !turns.isEmpty {
            for turn in turns {
                guard let id = turn["id"] as? String,
                      let role = turn["role"] as? String,
                      let text = turn["text"] as? String, !text.isEmpty else { continue }
                upsertTurn(
                    id: id,
                    role: role,
                    text: text,
                    translation: nil)
            }
            return
        }
        guard let transcript = snapshot["transcript"] else { return }
        if let text = transcript as? String, !text.isEmpty, text != renderedTranscript {
            renderedTranscript = text
            turnCardsByID.removeAll()
            feed.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for line in text.components(separatedBy: .newlines) where !line.isEmpty {
                if let colon = line.firstIndex(of: ":") {
                    let rawRole = String(line[..<colon]).trimmingCharacters(in: .whitespacesAndNewlines)
                    let role = rawRole.lowercased()
                    switch role {
                    case "secretary", "assistant":
                        appendTurn(role: "secretary", text: String(line[line.index(after: colon)...]))
                    case "guest", "other party":
                        appendTurn(role: "guest", text: String(line[line.index(after: colon)...]))
                    default:
                        appendTurn(role: "transcript", text: line)
                    }
                } else {
                    appendTurn(role: "transcript", text: line)
                }
            }
        }
    }

    func upsertTurn(id: String?, role: String, text: String, translation: String?) {
        if let id, let existing = turnCardsByID[id] {
            existing.update(text: text)
            return
        }
        guard let card = appendTurn(role: role, text: text, translation: nil) else { return }
        if let id { turnCardsByID[id] = card }
    }

    private final class SecretaryTurnCard {
        let bubble: UIView
        let originalLabel: UILabel
        let translationLabel: UILabel

        init(bubble: UIView, originalLabel: UILabel, translationLabel: UILabel) {
            self.bubble = bubble
            self.originalLabel = originalLabel
            self.translationLabel = translationLabel
        }

        func update(text: String) { originalLabel.text = text }

        func updateTranslation(_ translation: String) {
            translationLabel.text = translation
            translationLabel.isHidden = false
        }
    }

    @discardableResult
    private func appendTurn(role: String, text: String, translation: String? = nil) -> SecretaryTurnCard? {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let normalizedRole = role.lowercased()
        let isSecretary = normalizedRole == "secretary" || normalizedRole == "assistant"
        let isGuest = normalizedRole == "guest"
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = isGuest ? .white : .label
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        let translationLabel = UILabel()
        translationLabel.font = .systemFont(ofSize: 13)
        translationLabel.textColor = isGuest ? UIColor.white.withAlphaComponent(0.86) : .secondaryLabel
        translationLabel.numberOfLines = 0
        translationLabel.accessibilityIdentifier = "text-secretary-turn-translation"
        if let translation, !translation.isEmpty {
            translationLabel.text = translation
        } else {
            translationLabel.isHidden = true
        }
        let labels = UIStackView(arrangedSubviews: [label, translationLabel])
        labels.axis = .vertical
        labels.spacing = 3
        labels.translatesAutoresizingMaskIntoConstraints = false

        let bubble = UIView()
        bubble.accessibilityIdentifier = "card-secretary-turn-\(isGuest ? "guest" : (isSecretary ? "secretary" : "transcript"))"
        bubble.backgroundColor = isSecretary ? .secondarySystemBackground :
            (isGuest ? Theme.green : .tertiarySystemBackground)
        bubble.layer.cornerRadius = 16
        bubble.translatesAutoresizingMaskIntoConstraints = false
        bubble.addSubview(labels)
        NSLayoutConstraint.activate([
            labels.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 10),
            labels.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -10),
            labels.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 12),
            labels.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -12),
        ])
        let row = UIStackView(arrangedSubviews: isGuest ? [UIView(), bubble] : [bubble, UIView()])
        row.axis = .horizontal
        row.alignment = .top
        feed.addArrangedSubview(row)
        // A cross-view constraint may only be activated after both views have
        // a common ancestor. Activating this before insertion crashes on the
        // first live turn and on replaying any non-empty snapshot.
        bubble.widthAnchor.constraint(lessThanOrEqualTo: feed.widthAnchor, multiplier: 0.88).isActive = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let bottom = CGPoint(x: 0, y: max(0, self.scrollView.contentSize.height - self.scrollView.bounds.height))
            self.scrollView.setContentOffset(bottom, animated: true)
        }
        return SecretaryTurnCard(bubble: bubble, originalLabel: label, translationLabel: translationLabel)
    }

    private func handleDisconnect(_ error: Error?) {
        guard isMonitorVisible, !didEnd else { return }
        spinner.stopAnimating()
        audioWatchdog?.invalidate()
        monitorState.reset()
        if canPlaySourceAudio {
            SecretaryAudioPlayer.shared.stop()
        } else {
            stopPlayback()
        }
        if let error = error as NSError? {
            NSLog("[SecretaryMonitor] feed disconnected (%@:%ld)", error.domain, error.code)
        }
        reconnectAttempt += 1
        if reconnectAttempt > 5 {
            setConnectionFailure(NSLocalizedString("secretary.live.connection_lost", comment: ""))
            return
        }
        let reconnectKey = hasSourceMonitoring
            ? "secretary.live.feed_reconnecting"
            : "secretary.live.reconnecting"
        statusLabel.text = String(format: NSLocalizedString(reconnectKey, comment: ""),
                                  reconnectAttempt, 5)
        let delay = min(Double(reconnectAttempt) * 1.5, 6)
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if self.canPlaySourceAudio {
                _ = self.configureAudioPlayback()
            } else {
                self.showSourceUnavailable()
            }
            self.connectStream()
        }
        reconnectWork?.cancel()
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        _ = error
    }

    private func setConnectionFailure(_ text: String) {
        monitorError = text
        spinner.stopAnimating()
        statusLabel.text = text
        statusLabel.textColor = .systemRed
        retryButton.isHidden = didEnd
    }

    private func refreshMonitorStatus() {
        guard !didEnd else { return }
        if let monitorError {
            statusLabel.text = monitorError
            statusLabel.textColor = .systemRed
            retryButton.isHidden = didEnd
        } else {
            statusLabel.text = NSLocalizedString(monitorState.statusKey, comment: "")
            statusLabel.textColor = .secondaryLabel
        }
    }

    @objc private func retryConnection() {
        guard !didEnd else { return }
        reconnectAttempt = 0
        statusLabel.textColor = .secondaryLabel
        if canPlaySourceAudio { _ = configureAudioPlayback() }
        else { showSourceUnavailable() }
        connectStream()
    }

    private static func isTerminal(_ status: String) -> Bool {
        ["completed", "failed", "cancelled", "canceled", "no_answer", "busy", "needs_action", "unknown",
         "ended", "hangup", "hung_up", "disconnected"]
            .contains(status.lowercased().replacingOccurrences(of: "-", with: "_"))
    }

    private func taskStatusTitle(_ status: String) -> String {
        let key: String
        switch status.lowercased().replacingOccurrences(of: "-", with: "_") {
        case "queued", "pending": key = "secretary.status.queued"
        case "starting", "ringing", "calling": key = "secretary.status.calling"
        case "connected", "finalizing", "in_progress": key = "secretary.status.in_progress"
        case "completed": key = "secretary.status.completed"
        case "needs_action", "requires_action", "action_required", "follow_up", "needs_follow_up":
            key = "secretary.status.needs_action"
        case "no_answer", "not_reached": key = "secretary.status.no_answer"
        case "busy": key = "secretary.status.busy"
        case "failed": key = "secretary.status.failed"
        case "cancelled", "canceled": key = "secretary.status.cancelled"
        case "unknown": key = "secretary.status.unknown"
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
        return NSLocalizedString(key, comment: "")
    }

    @objc private func toggleSpeaker() {
        isSpeaker.toggle()
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(isSpeaker ? .speaker : .none)
            updateRouteControl()
        } catch {
            isSpeaker.toggle()
            setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
        }
    }

    private func updateRouteControl() {
        let key = isSpeaker ? "secretary.live.speaker" : "secretary.live.iphone"
        routeButton.setImage(UIImage(systemName: isSpeaker ? "speaker.wave.2.fill" : "iphone"), for: .normal)
        routeButton.accessibilityLabel = NSLocalizedString(key, comment: "")
        routeCaption.text = NSLocalizedString(key, comment: "")
        routeButton.backgroundColor = isSpeaker ? Theme.green.withAlphaComponent(0.12) : .secondarySystemBackground
    }

    @objc private func endCallTapped() {
        guard !didEnd else { return }
        let alert = UIAlertController(
            title: NSLocalizedString("secretary.live.end.confirm.title", comment: ""),
            message: NSLocalizedString("secretary.live.end.confirm.message", comment: ""),
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("secretary.live.end", comment: ""), style: .destructive) { [weak self] _ in
            self?.hangup()
        })
        present(alert, animated: true)
    }

    private func hangup() {
        endButton.isEnabled = false
        spinner.startAnimating()
        statusLabel.text = NSLocalizedString("secretary.live.ending", comment: "")
        Task {
            do {
                let updated = try await APIClient.shared.hangupSecretaryTask(id: task.id)
                await MainActor.run {
                    self.finishLiveCall(status: updated.status)
                }
            } catch {
                await MainActor.run {
                    self.spinner.stopAnimating()
                    self.endButton.isEnabled = true
                    self.setConnectionFailure(error.localizedDescription)
                }
            }
        }
    }

    @objc private func appDidEnterBackground() {
        guard isMonitorVisible, !didEnd else { return }
        if hasSourceMonitoring {
            statusLabel.text = NSLocalizedString("secretary.live.feed_background_active", comment: "")
        } else {
            statusLabel.text = NSLocalizedString("secretary.live.background_active", comment: "")
        }
    }

    @objc private func appDidBecomeActive() {
        guard isMonitorVisible, !didEnd else { return }
        if canPlaySourceAudio { _ = configureAudioPlayback() }
        else { showSourceUnavailable() }
        reconnectAttempt = 0
        connectStream()
    }

    @objc private func audioInterrupted(_ notification: Notification) {
        guard isMonitorVisible, !didEnd else { return }
        guard let info = notification.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            SecretaryAudioPlayer.shared.pause()
            statusLabel.text = NSLocalizedString("secretary.live.audio_interrupted", comment: "")
        } else {
            let rawOptions = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            guard options.contains(.shouldResume) else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            if canPlaySourceAudio { _ = configureAudioPlayback() }
            else { showSourceUnavailable() }
            if !didEnd { refreshMonitorStatus() }
        }
    }

    private func stopPlayback() {
        audioWatchdog?.invalidate()
        audioRecoveryWork?.cancel()
        guard audioSessionActive else { return }
        SecretaryAudioPlayer.shared.stop()
        audioSessionActive = false
        guard !CallManager.shared.hasPhoneAudioSession else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func finishLiveCall(status: String) {
        guard !didEnd else { return }
        didEnd = true
        connectionTimeout?.cancel()
        reconnectWork?.cancel()
        spinner.stopAnimating()
        endButton.isEnabled = false
        statusLabel.text = taskStatusTitle(status)
        retryButton.isHidden = true
        stream?.disconnect()
        stopPlayback()
        onCallEnded?()
    }
}

private final class SecretaryLiveCallStream {
    private let taskID: String
    private let token: String
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    var onMessage: (([String: Any]) -> Void)?
    var onDisconnect: ((Error?) -> Void)?
    private var isActive = false

    init(taskID: String, token: String) {
        self.taskID = taskID
        self.token = token
    }

    func connect() {
        guard !isActive else { return }
        var components = URLComponents(url: AppConfig.webSocketBaseURL.appendingPathComponent("secretary-feed"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "taskId", value: taskID),
        ]
        guard let url = components.url else {
            onDisconnect?(APIError.decoding)
            return
        }
        isActive = true
        let session = URLSession(configuration: .default)
        self.session = session
        let socket = session.webSocketTask(with: url)
        self.socket = socket
        socket.resume()
        receiveNext()
    }

    func disconnect() {
        isActive = false
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session?.invalidateAndCancel()
        session = nil
    }

    private func receiveNext() {
        socket?.receive { [weak self] result in
            guard let self, self.isActive else { return }
            switch result {
            case .failure(let error):
                self.isActive = false
                self.session?.invalidateAndCancel()
                self.session = nil
                self.socket = nil
                DispatchQueue.main.async { self.onDisconnect?(error) }
            case .success(let message):
                let data: Data?
                switch message {
                case .string(let text): data = text.data(using: .utf8)
                case .data(let value): data = value
                @unknown default: data = nil
                }
                if let data,
                   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    DispatchQueue.main.async { self.onMessage?(object) }
                }
                self.receiveNext()
            }
        }
    }
}
