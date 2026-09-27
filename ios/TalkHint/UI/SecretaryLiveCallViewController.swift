import UIKit
import AVFoundation

/// Live Secretary call monitor. The app only receives server-mixed call audio;
/// this controller never opens, records, or sends the iPhone microphone.
final class SecretaryLiveCallViewController: UIViewController {
    private let task: APIClient.SecretaryTask
    private let scrollView = UIScrollView()
    private let feed = UIStackView()
    private let statusLabel = UILabel()
    private let routeButton = UIButton(type: .system)
    private let endButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private let routeCaption = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var stream: SecretaryLiveCallStream?
    private var isSpeaker = true
    private var didEnd = false
    private var audioSessionActive = false
    private var reconnectWork: DispatchWorkItem?
    private var connectionTimeout: DispatchWorkItem?
    private var reconnectAttempt = 0
    private var renderedTranscript: String?
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
        configureAudioPlayback()
        observeLifecycle()
        connectStream()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        stream?.disconnect()
        stopPlayback()
    }

    private func buildUI() {
        statusLabel.text = NSLocalizedString("secretary.live.connecting", comment: "")
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

        feed.axis = .vertical
        feed.spacing = 10
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

        let header = UIStackView(arrangedSubviews: [heading, description, statusRow])
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

    private func configureAudioPlayback() {
        do {
            let session = AVAudioSession.sharedInstance()
            // playAndRecord supplies a controllable receiver/speaker route. No
            // input node, tap, recorder, or microphone permission is used.
            try session.setCategory(.playAndRecord, mode: .voiceChat,
                                    options: [.allowBluetooth])
            try session.setActive(true)
            audioSessionActive = true
            try session.overrideOutputAudioPort(isSpeaker ? .speaker : .none)
            guard SecretaryAudioPlayer.shared.start() else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            updateRouteControl()
        } catch {
            statusLabel.text = NSLocalizedString("secretary.live.audio_failed", comment: "")
            spinner.stopAnimating()
        }
    }

    private func observeLifecycle() {
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

    private func connectStream() {
        guard !didEnd, UIApplication.shared.applicationState == .active else { return }
        guard let token = SessionStore.shared.token, !token.isEmpty else {
            setConnectionFailure(NSLocalizedString("secretary.live.sign_in", comment: ""))
            return
        }
        stream?.disconnect()
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
        statusLabel.text = NSLocalizedString("secretary.live.connecting", comment: "")
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
        guard !didEnd, let type = message["type"] as? String else { return }
        connectionTimeout?.cancel()
        connectionTimeout = nil
        statusLabel.textColor = .secondaryLabel
        switch type {
        case "snapshot":
            reconnectAttempt = 0
            spinner.stopAnimating()
            statusLabel.text = NSLocalizedString("secretary.live.connected", comment: "")
            if let snapshot = message["task"] as? [String: Any] {
                renderSnapshot(snapshot)
            }
        case "turn":
            guard let role = message["role"] as? String,
                  let text = message["text"] as? String, !text.isEmpty else { return }
            spinner.stopAnimating()
            statusLabel.text = NSLocalizedString("secretary.live.connected", comment: "")
            appendTurn(role: role, text: text)
        case "audio":
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
            guard SecretaryAudioPlayer.shared.enqueue(muLaw: data) else {
                setConnectionFailure(NSLocalizedString("secretary.live.audio_failed", comment: ""))
                return
            }
            statusLabel.text = NSLocalizedString("secretary.live.connected", comment: "")
        case "status":
            guard let status = message["status"] as? String else { return }
            statusLabel.text = taskStatusTitle(status)
            if Self.isTerminal(status) {
                finishLiveCall(status: status)
            }
        default:
            break
        }
    }

    private func renderSnapshot(_ snapshot: [String: Any]) {
        var terminalStatus: String?
        defer {
            if let terminalStatus { finishLiveCall(status: terminalStatus) }
        }
        if let status = snapshot["status"] as? String {
            statusLabel.text = taskStatusTitle(status)
            if Self.isTerminal(status) {
                terminalStatus = status
            }
        }
        guard let transcript = snapshot["transcript"] else { return }
        if let text = transcript as? String, !text.isEmpty, text != renderedTranscript {
            renderedTranscript = text
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
        } else if let turns = transcript as? [[String: Any]] {
            feed.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for turn in turns {
                guard let role = turn["role"] as? String,
                      let text = turn["text"] as? String, !text.isEmpty else { continue }
                appendTurn(role: role, text: text)
            }
        }
    }

    private func appendTurn(role: String, text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let normalizedRole = role.lowercased()
        let isSecretary = normalizedRole == "secretary" || normalizedRole == "assistant"
        let isGuest = normalizedRole == "guest"
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = isGuest ? .white : .label
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        let bubble = UIView()
        bubble.backgroundColor = isSecretary ? .secondarySystemBackground :
            (isGuest ? Theme.green : .tertiarySystemBackground)
        bubble.layer.cornerRadius = 16
        bubble.translatesAutoresizingMaskIntoConstraints = false
        bubble.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -10),
            label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -12),
            bubble.widthAnchor.constraint(lessThanOrEqualTo: feed.widthAnchor, multiplier: 0.88),
        ])
        let row = UIStackView(arrangedSubviews: isGuest ? [UIView(), bubble] : [bubble, UIView()])
        row.axis = .horizontal
        row.alignment = .top
        feed.addArrangedSubview(row)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let bottom = CGPoint(x: 0, y: max(0, self.scrollView.contentSize.height - self.scrollView.bounds.height))
            self.scrollView.setContentOffset(bottom, animated: true)
        }
    }

    private func handleDisconnect(_ error: Error?) {
        guard !didEnd else { return }
        spinner.stopAnimating()
        reconnectAttempt += 1
        if reconnectAttempt > 5 {
            setConnectionFailure(NSLocalizedString("secretary.live.connection_lost", comment: ""))
            return
        }
        statusLabel.text = String(format: NSLocalizedString("secretary.live.reconnecting", comment: ""),
                                  reconnectAttempt, 5)
        let delay = min(Double(reconnectAttempt) * 1.5, 6)
        let work = DispatchWorkItem { [weak self] in self?.connectStream() }
        reconnectWork?.cancel()
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        _ = error
    }

    private func setConnectionFailure(_ text: String) {
        spinner.stopAnimating()
        statusLabel.text = text
        statusLabel.textColor = .systemRed
        retryButton.isHidden = didEnd
    }

    @objc private func retryConnection() {
        guard !didEnd else { return }
        reconnectAttempt = 0
        statusLabel.textColor = .secondaryLabel
        configureAudioPlayback()
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
        guard !didEnd else { return }
        statusLabel.text = NSLocalizedString("secretary.live.background_active", comment: "")
    }

    @objc private func appDidBecomeActive() {
        guard !didEnd else { return }
        configureAudioPlayback()
        reconnectAttempt = 0
        connectStream()
    }

    @objc private func audioInterrupted(_ notification: Notification) {
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
            configureAudioPlayback()
            if !didEnd { statusLabel.text = NSLocalizedString("secretary.live.connected", comment: "") }
        }
    }

    private func stopPlayback() {
        SecretaryAudioPlayer.shared.stop()
        guard audioSessionActive else { return }
        audioSessionActive = false
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

/// Single paced 8 kHz μ-law playback queue for both remote speakers.
/// This class has no microphone capture or recording path.
private final class SecretaryAudioPlayer {
    static let shared = SecretaryAudioPlayer()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queueLock = NSLock()
    private var pendingBytes = 0
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 8_000,
                                       channels: 1, interleaved: false)!
    private(set) var isReady = false

    private init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func start() -> Bool {
        do {
            if !engine.isRunning { try engine.start() }
            if !player.isPlaying { player.play() }
            isReady = true
            return true
        } catch {
            isReady = false
            return false
        }
    }

    func enqueue(muLaw: Data) -> Bool {
        guard isReady, !muLaw.isEmpty, muLaw.count <= 80_000, reserve(muLaw.count) else { return false }
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(muLaw.count))!
        buffer.frameLength = AVAudioFrameCount(muLaw.count)
        guard let channel = buffer.floatChannelData?[0] else {
            release(muLaw.count)
            return false
        }
        for (index, byte) in muLaw.enumerated() {
            channel[index] = Float(Self.decodeMuLaw(byte)) / 32_768
        }
        player.scheduleBuffer(buffer) { [weak self] in self?.release(muLaw.count) }
        return true
    }

    private func reserve(_ count: Int) -> Bool {
        queueLock.lock()
        defer { queueLock.unlock() }
        guard pendingBytes + count <= 240_000 else { return false }
        pendingBytes += count
        return true
    }

    private func release(_ count: Int) {
        queueLock.lock()
        pendingBytes = max(0, pendingBytes - count)
        queueLock.unlock()
    }

    func pause() {
        player.pause()
        engine.pause()
        isReady = false
    }

    func stop() {
        player.stop()
        engine.stop()
        isReady = false
        queueLock.lock()
        pendingBytes = 0
        queueLock.unlock()
    }

    private static func decodeMuLaw(_ input: UInt8) -> Int16 {
        let value = ~input
        let sign = value & 0x80
        let exponent = Int((value >> 4) & 0x07)
        let mantissa = Int(value & 0x0f)
        let sample = ((mantissa << 3) + 0x84) << exponent
        let decoded = sign == 0 ? sample - 0x84 : 0x84 - sample
        return Int16(clamping: decoded)
    }
}