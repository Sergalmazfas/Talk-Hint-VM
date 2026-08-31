import UIKit
import AVFoundation

/// Translator tab — a standalone, two-way voice translation window.
///
/// Deliberately mirrors the live in-call screen (`InCallViewController`): the
/// same overall layout — status line on top, a scrollable feed of rounded
/// conversation cards, and a pinned bottom row of circular call controls
/// (Mute / End / Audio route). It has NO avatar, NO Tutor, NO Hint banner and
/// NO Ask field: instead of hints, this screen's feed will show translation
/// pairs — the user's utterance followed by its translation, then the other
/// party's utterance followed by its translation.
///
final class TranslatorViewController: UIViewController {

    private let statusLabel = UILabel()
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()
    private let translatorStream = TranslatorStream()
    private let audioEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var outputFormat: AVAudioFormat?
    private var isRunning = false
    private var isMuted = false
    private var isSpeakerEnabled = true
    private var currentSourceLabel: UILabel?
    private var currentTranslationLabel: UILabel?
    private var startButton: UIButton?
    private var muteButton: UIButton?
    private var routeButton: UIButton?
    private var endButton: UIButton?
    private var hasInputTap = false
    private var audioGraphConfigured = false
    private let audioStateLock = NSLock()
    private var queuedPlaybackBuffers = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("translator.title", comment: "")
        view.backgroundColor = .systemBackground
        translatorStream.delegate = self
        buildUI()
        showPlaceholderFeed()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopTranslator()
    }

    deinit {
        translatorStream.stop()
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
    }

    private func buildUI() {
        // Status line — same style as the in-call status (13pt, Theme.sub).
        statusLabel.text = NSLocalizedString("translator.status.placeholder", comment: "")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = Theme.sub
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.accessibilityIdentifier = "text-translator-status"
        view.addSubview(statusLabel)

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-translator-feed"
        scrollView.addSubview(feedStack)
        view.addSubview(scrollView)

        let start = UIButton(type: .system)
        start.setTitle(NSLocalizedString("translator.start", comment: ""), for: .normal)
        start.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        start.backgroundColor = Theme.green
        start.tintColor = .white
        start.layer.cornerRadius = 12
        start.accessibilityIdentifier = "button-translator-start"
        start.addTarget(self, action: #selector(startTapped), for: .touchUpInside)
        start.translatesAutoresizingMaskIntoConstraints = false
        startButton = start
        view.addSubview(start)

        let controlsRow = buildControlsRow()
        view.addSubview(controlsRow)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: guide.topAnchor, constant: 6),
            statusLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            start.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 10),
            start.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            start.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            start.heightAnchor.constraint(equalToConstant: 46),

            scrollView.topAnchor.constraint(equalTo: start.bottomAnchor, constant: 8),
            scrollView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: controlsRow.topAnchor, constant: -8),

            controlsRow.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            controlsRow.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            controlsRow.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),

            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
        ])
    }

    /// Placeholder content until the realtime engine is connected: one card
    /// explaining what this screen will do, styled exactly like the in-call
    /// conversation cards so the final look is already visible.
    private func showPlaceholderFeed() {
        _ = appendCard(
            title: NSLocalizedString("translator.title", comment: ""),
            titleColor: Theme.purple,
            primary: NSLocalizedString("translator.placeholder.title", comment: ""),
            secondary: NSLocalizedString("translator.placeholder.message", comment: ""),
            background: Theme.purpleBg,
            testIdSuffix: "translator-placeholder")
    }

    // MARK: - Feed cards (same visual language as InCallViewController)

    @discardableResult
    private func appendCard(title: String,
                            titleColor: UIColor,
                            primary: String,
                            secondary: String?,
                            background: UIColor,
                            testIdSuffix: String) -> (primary: UILabel, secondary: UILabel) {
        let card = UIView()
        card.backgroundColor = background
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = "card-\(testIdSuffix)"

        let tag = UILabel()
        tag.text = title
        tag.font = .systemFont(ofSize: 11, weight: .semibold)
        tag.textColor = titleColor

        let primaryLabel = UILabel()
        primaryLabel.text = primary
        primaryLabel.font = .systemFont(ofSize: 15)
        primaryLabel.textColor = Theme.ink
        primaryLabel.numberOfLines = 0
        primaryLabel.accessibilityIdentifier = "text-\(testIdSuffix)"

        // Secondary line = the translation slot: every utterance card on this
        // screen will carry its translation right below the original text.
        let secondaryLabel = UILabel()
        secondaryLabel.font = .systemFont(ofSize: 13)
        secondaryLabel.textColor = Theme.sub
        secondaryLabel.numberOfLines = 0
        secondaryLabel.accessibilityIdentifier = "text-\(testIdSuffix)-translation"
        if let secondary = secondary, !secondary.isEmpty {
            secondaryLabel.text = secondary
        } else {
            secondaryLabel.isHidden = true
        }

        let labels = UIStackView(arrangedSubviews: [tag, primaryLabel, secondaryLabel])
        labels.axis = .vertical
        labels.spacing = 2
        labels.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(labels)
        NSLayoutConstraint.activate([
            labels.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            labels.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -10),
            labels.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            labels.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
        ])
        feedStack.addArrangedSubview(card)
        return (primaryLabel, secondaryLabel)
    }

    // MARK: - Call controls (same style/geometry as InCallViewController)

    /// Mute / End / Audio-route in the exact in-call style. These controls act
    /// only on this translator audio session, never on the phone/Hint call.
    private func buildControlsRow() -> UIView {
        let muteButton = UIButton(type: .system)
        configureCircleButton(muteButton, diameter: 44)
        muteButton.setImage(UIImage(systemName: "mic.slash.fill"), for: .normal)
        muteButton.isEnabled = false
        muteButton.accessibilityIdentifier = "button-translator-mute"
        muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
        self.muteButton = muteButton
        let muteCaption = caption(NSLocalizedString("incall.mute", comment: ""))

        let endButton = UIButton(type: .system)
        configureCircleButton(endButton, diameter: 52)
        endButton.setImage(UIImage(systemName: "phone.down.fill"), for: .normal)
        endButton.tintColor = .white
        endButton.backgroundColor = UIColor(
            red: 0xEF / 255.0, green: 0x44 / 255.0, blue: 0x44 / 255.0, alpha: 1)
        endButton.layer.borderWidth = 0
        endButton.isEnabled = false
        endButton.accessibilityIdentifier = "button-translator-end"
        endButton.addTarget(self, action: #selector(endTapped), for: .touchUpInside)
        self.endButton = endButton
        let endCaption = caption(NSLocalizedString("incall.end", comment: ""))

        let routeButton = UIButton(type: .system)
        configureCircleButton(routeButton, diameter: 44)
        routeButton.setImage(UIImage(systemName: "speaker.wave.2.fill"), for: .normal)
        routeButton.isEnabled = false
        routeButton.accessibilityIdentifier = "button-translator-audio-route"
        routeButton.addTarget(self, action: #selector(routeTapped), for: .touchUpInside)
        self.routeButton = routeButton
        let routeCaption = caption(NSLocalizedString("incall.route.speaker", comment: ""))

        let row = UIStackView(arrangedSubviews: [
            circleControl(button: muteButton, caption: muteCaption),
            circleControl(button: endButton, caption: endCaption),
            circleControl(button: routeButton, caption: routeCaption),
        ])
        row.axis = .horizontal
        row.spacing = 12
        row.distribution = .fillEqually
        row.alignment = .bottom
        row.translatesAutoresizingMaskIntoConstraints = false
        return row
    }

    private func caption(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: 10)
        label.textColor = Theme.sub
        label.textAlignment = .center
        return label
    }

    private func configureCircleButton(_ button: UIButton, diameter: CGFloat) {
        button.backgroundColor = Theme.fill
        button.layer.cornerRadius = diameter / 2
        button.layer.borderWidth = 1
        button.layer.borderColor = Theme.line.cgColor
        button.tintColor = Theme.ink
        button.widthAnchor.constraint(equalToConstant: diameter).isActive = true
        button.heightAnchor.constraint(equalToConstant: diameter).isActive = true
    }

    private func circleControl(button: UIButton, caption: UILabel) -> UIView {
        let stack = UIStackView(arrangedSubviews: [button, caption])
        stack.axis = .vertical
        stack.spacing = 3
        stack.alignment = .center
        return stack
    }

    // MARK: - Standalone translator lifecycle

    @objc private func startTapped() {
        startButton?.isEnabled = false
        statusLabel.text = NSLocalizedString("translator.status.connecting", comment: "")

        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else {
                    self.statusLabel.text = NSLocalizedString("translator.error.microphone", comment: "")
                    self.startButton?.isEnabled = true
                    return
                }
                self.translatorStream.connect()
            }
        }
    }

    @objc private func muteTapped() {
        audioStateLock.lock()
        isMuted.toggle()
        let muted = isMuted
        audioStateLock.unlock()
        muteButton?.setImage(
            UIImage(systemName: muted ? "mic.slash.fill" : "mic.fill"),
            for: .normal
        )
        muteButton?.tintColor = muted ? .systemRed : Theme.ink
    }

    @objc private func routeTapped() {
        isSpeakerEnabled.toggle()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(isSpeakerEnabled ? .speaker : .none)
            routeButton?.setImage(
                UIImage(systemName: isSpeakerEnabled ? "speaker.wave.2.fill" : "ear"),
                for: .normal
            )
        } catch {
            statusLabel.text = error.localizedDescription
        }
    }

    @objc private func endTapped() {
        stopTranslator()
    }

    private func startAudioBridge() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.defaultToSpeaker, .allowBluetooth]
        )
        try audioSession.setPreferredSampleRate(24_000)
        try audioSession.setPreferredIOBufferDuration(0.02)
        try audioSession.setActive(true)
        try audioSession.overrideOutputAudioPort(.speaker)

        if !audioGraphConfigured {
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: 24_000,
                channels: 1,
                interleaved: false
            ) else {
                throw NSError(
                    domain: "TalkHint.Translator",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Unable to configure translator audio"]
                )
            }
            outputFormat = format
            audioEngine.attach(playerNode)
            audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: format)
            audioGraphConfigured = true
        }

        let input = audioEngine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 960, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self else { return }
            self.audioStateLock.lock()
            let shouldSend = !self.isMuted && self.queuedPlaybackBuffers == 0
            self.audioStateLock.unlock()
            guard shouldSend,
                  let pcm = Self.makePCM16Mono24k(buffer: buffer),
                  !pcm.isEmpty else { return }
            self.translatorStream.sendAudio(pcm)
        }
        hasInputTap = true

        audioEngine.prepare()
        try audioEngine.start()
        playerNode.play()
        isRunning = true
        startButton?.isHidden = true
        muteButton?.isEnabled = true
        routeButton?.isEnabled = true
        endButton?.isEnabled = true
        statusLabel.text = NSLocalizedString("translator.status.listening", comment: "")
    }

    private func stopTranslator() {
        translatorStream.stop()
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
        playerNode.stop()
        audioEngine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        audioStateLock.lock()
        queuedPlaybackBuffers = 0
        isMuted = false
        audioStateLock.unlock()
        isRunning = false
        startButton?.isHidden = false
        startButton?.isEnabled = true
        muteButton?.isEnabled = false
        routeButton?.isEnabled = false
        endButton?.isEnabled = false
        currentSourceLabel = nil
        currentTranslationLabel = nil
        statusLabel.text = NSLocalizedString("translator.status.stopped", comment: "")
    }

    private func playTranslatedAudio(_ data: Data) {
        guard isRunning, let format = outputFormat, data.count >= 2 else { return }
        let frameCount = AVAudioFrameCount(data.count / MemoryLayout<Int16>.size)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
              let channel = buffer.int16ChannelData?[0] else { return }
        buffer.frameLength = frameCount
        data.withUnsafeBytes { bytes in
            guard let source = bytes.bindMemory(to: Int16.self).baseAddress else { return }
            channel.update(from: source, count: Int(frameCount))
        }

        audioStateLock.lock()
        queuedPlaybackBuffers += 1
        audioStateLock.unlock()
        playerNode.scheduleBuffer(buffer) { [weak self] in
            guard let self = self else { return }
            self.audioStateLock.lock()
            self.queuedPlaybackBuffers = max(0, self.queuedPlaybackBuffers - 1)
            self.audioStateLock.unlock()
        }
    }

    /// Converts the input node's native Float32 format (normally 48 kHz) into
    /// the fixed provider contract: little-endian PCM16 mono at 24 kHz.
    static func makePCM16Mono24k(buffer: AVAudioPCMBuffer) -> Data? {
        guard let channels = buffer.floatChannelData else { return nil }
        let sourceFrames = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        let sourceRate = buffer.format.sampleRate
        guard sourceFrames > 0, channelCount > 0, sourceRate > 0 else { return nil }

        let outputFrames = max(1, Int(Double(sourceFrames) * 24_000 / sourceRate))
        var samples = [Int16](repeating: 0, count: outputFrames)
        for outputIndex in 0..<outputFrames {
            let sourcePosition = Double(outputIndex) * sourceRate / 24_000
            let lower = min(sourceFrames - 1, Int(sourcePosition))
            let upper = min(sourceFrames - 1, lower + 1)
            let fraction = Float(sourcePosition - Double(lower))
            var mixed: Float = 0
            for channelIndex in 0..<channelCount {
                let lowerValue = channels[channelIndex][lower]
                let upperValue = channels[channelIndex][upper]
                mixed += lowerValue + (upperValue - lowerValue) * fraction
            }
            mixed /= Float(channelCount)
            let clipped = max(-1, min(1, mixed))
            samples[outputIndex] = Int16(clipped * Float(Int16.max))
        }
        return samples.withUnsafeBytes { Data($0) }
    }

    private func removePlaceholderFeedIfNeeded() {
        guard feedStack.arrangedSubviews.first?.accessibilityIdentifier == "card-translator-placeholder" else {
            return
        }
        for view in feedStack.arrangedSubviews {
            feedStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
    }

    private func beginTranscriptCard(source: String) {
        removePlaceholderFeedIfNeeded()
        let labels = appendCard(
            title: NSLocalizedString("translator.turn", comment: ""),
            titleColor: Theme.purple,
            primary: source,
            secondary: nil,
            background: Theme.purpleBg,
            testIdSuffix: "translator-turn-\(feedStack.arrangedSubviews.count)"
        )
        labels.secondary.isHidden = false
        labels.secondary.text = ""
        currentSourceLabel = labels.primary
        currentTranslationLabel = labels.secondary
        scrollToLatest()
    }

    private func scrollToLatest() {
        view.layoutIfNeeded()
        let offset = CGPoint(
            x: 0,
            y: max(0, scrollView.contentSize.height - scrollView.bounds.height)
        )
        scrollView.setContentOffset(offset, animated: true)
    }
}

extension TranslatorViewController: TranslatorStreamDelegate {
    func translatorStream(_ stream: TranslatorStream, didReceive event: TranslatorStreamEvent) {
        switch event {
        case .connected:
            do {
                try startAudioBridge()
            } catch {
                statusLabel.text = error.localizedDescription
                stopTranslator()
            }
        case .sourceTranscript(let text):
            beginTranscriptCard(source: text)
        case .translatedTranscriptDelta(let delta):
            if currentTranslationLabel == nil {
                beginTranscriptCard(source: "…")
            }
            currentTranslationLabel?.text = (currentTranslationLabel?.text ?? "") + delta
            scrollToLatest()
        case .translatedTranscriptDone(let text):
            if currentTranslationLabel == nil {
                beginTranscriptCard(source: "…")
            }
            currentTranslationLabel?.text = text
            scrollToLatest()
        case .audio(let data):
            playTranslatedAudio(data)
        case .turnCompleted:
            currentSourceLabel = nil
            currentTranslationLabel = nil
        case .error(let message, let fatal):
            statusLabel.text = message
            if fatal {
                stopTranslator()
                statusLabel.text = message
            }
        case .closed:
            if isRunning {
                stopTranslator()
                statusLabel.text = NSLocalizedString("translator.error.connection", comment: "")
            }
        }
    }
}
