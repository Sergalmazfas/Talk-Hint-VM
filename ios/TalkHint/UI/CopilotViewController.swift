import UIKit

/// Translator-style conversation feed with a pinned private translation card.
/// CallManager owns the phone call and the private microphone gate.
final class CopilotViewController: UIViewController {
    let stream: CopilotStream
    /// Main's callback must close Owner→Guest before calling completion(true).
    var requestPrivateGate: (@escaping (Bool) -> Void) -> Void = { completion in completion(false) }
    /// Main drains private frames, queues hold_end, then restores normal
    /// uplink. This is called synchronously on every release/cancel; a nil
    /// hold ID means the local gate request was still in flight.
    var onReleaseHold: ((String?) -> Void)?
    var onSpeaker: ((Bool) -> Void)?
    var onMute: (() -> Void)?
    var onEnd: (() -> Void)?

    private let status = UILabel()
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()
    private let translationCard = UIView()
    private let translationLabel = UILabel()
    private let privateSourceLabel = UILabel()
    private let ptt = UIButton(type: .system)
    private let muteButton = UIButton(type: .system)
    private let routeButton = UIButton(type: .system)
    private var speakerEnabled = false
    private var cards: [String: ConversationCard] = [:]
    private final class ConversationCard {
        let original: UILabel
        let translation: UILabel
        init(original: UILabel, translation: UILabel) {
            self.original = original
            self.translation = translation
        }
    }
    private var holdId: String?
    private var privateActive = false
    private var failed = false
    private var pressed = false
    private var intentGeneration = 0
    private var releaseDeliveredGeneration: Int?
    private var releasePending = false

    init(callSid: String, language: String, sampleRateHz: Int, stream: CopilotStream? = nil) {
        // CallManager must pass the measured device sample rate. Supplying a
        // stream is useful when it already owns the transport.
        self.stream = stream ?? CopilotStream(callSid: callSid, language: language, sampleRateHz: sampleRateHz)
        super.init(nibName: nil, bundle: nil)
    }
    /// Use when CallManager/coordinator already constructed the stream with
    /// the measured hardware rate.
    convenience init(callSid: String, language: String, stream: CopilotStream) {
        self.init(callSid: callSid, language: language, sampleRateHz: 1, stream: stream)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = NSLocalizedString("copilot.title", comment: "")
        buildUI()
        stream.onReady = { [weak self] in self?.setReady() }
        stream.onGuestText = { [weak self] text, itemId in
            self?.upsertConversation(direction: "guest", itemId: itemId, translation: text)
        }
        stream.onPrivateText = { [weak self] text in
            self?.translationLabel.text = text
            self?.translationCard.isHidden = text.isEmpty
        }
        stream.onSourceText = { [weak self] direction, text, itemId in
            if direction == "private" {
                self?.privateSourceLabel.text = text
                self?.privateSourceLabel.isHidden = text.isEmpty
            } else {
                self?.upsertConversation(direction: direction, itemId: itemId, source: text)
            }
        }
        stream.onHoldReady = { [weak self] holdId in self?.serverHoldReady(holdId) }
        stream.onFailure = { [weak self] _ in self?.streamFailed() }
        stream.start()
    }

    private func buildUI() {
        let title = UILabel()
        title.text = NSLocalizedString("copilot.title", comment: "")
        title.font = .systemFont(ofSize: 24, weight: .bold)
        title.textColor = Theme.ink
        title.textAlignment = .center
        status.font = .systemFont(ofSize: 13)
        status.textAlignment = .center
        status.textColor = Theme.sub
        status.text = NSLocalizedString("copilot.connecting", comment: "")
        status.accessibilityIdentifier = "text-copilot-status"
        let header = UIStackView(arrangedSubviews: [title, status])
        header.axis = .vertical; header.spacing = 3
        header.translatesAutoresizingMaskIntoConstraints = false

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(feedStack)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-copilot-feed"

        buildTranslationCard()

        ptt.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        ptt.setTitle("  " + NSLocalizedString("copilot.hold_to_talk", comment: ""), for: .normal)
        ptt.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        ptt.tintColor = .white
        ptt.setTitleColor(.white, for: .normal)
        ptt.backgroundColor = Theme.purple
        ptt.layer.cornerRadius = 24
        ptt.isEnabled = false
        ptt.setContentCompressionResistancePriority(.required, for: .vertical)
        ptt.accessibilityIdentifier = "copilot-ptt"
        ptt.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(pttChanged(_:))))

        let bottom = UIStackView(arrangedSubviews: [translationCard, ptt, controlsRow()])
        bottom.axis = .vertical; bottom.spacing = 10
        bottom.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        view.addSubview(scrollView)
        view.addSubview(bottom)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            scrollView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottom.topAnchor, constant: -10),
            bottom.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            bottom.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            bottom.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
            ptt.heightAnchor.constraint(equalToConstant: 48),
            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16)
        ])
    }

    private func buildTranslationCard() {
        translationCard.backgroundColor = Theme.purpleBg
        translationCard.layer.cornerRadius = 16
        translationCard.layer.borderWidth = 1
        translationCard.layer.borderColor = UIColor(
            red: 0xC9 / 255.0, green: 0xBC / 255.0, blue: 0xFF / 255.0, alpha: 1).cgColor
        translationCard.accessibilityIdentifier = "card-copilot-translation"
        translationCard.isHidden = true
        let icon = UIImageView(image: UIImage(systemName: "character.bubble"))
        icon.tintColor = Theme.purple
        icon.widthAnchor.constraint(equalToConstant: 16).isActive = true
        let tag = UILabel()
        tag.text = NSLocalizedString("copilot.translation", comment: "")
        tag.font = .systemFont(ofSize: 13, weight: .semibold)
        tag.textColor = Theme.purple
        let tagRow = UIStackView(arrangedSubviews: [icon, tag, UIView()])
        tagRow.axis = .horizontal; tagRow.spacing = 6; tagRow.alignment = .center
        translationLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        translationLabel.textColor = Theme.ink
        translationLabel.numberOfLines = 0
        translationLabel.accessibilityIdentifier = "text-copilot-translation"
        translationLabel.setContentCompressionResistancePriority(.required, for: .vertical)
        privateSourceLabel.font = .systemFont(ofSize: 14)
        privateSourceLabel.textColor = Theme.sub
        privateSourceLabel.numberOfLines = 0
        privateSourceLabel.isHidden = true
        let content = UIStackView(arrangedSubviews: [tagRow, translationLabel, privateSourceLabel])
        content.axis = .vertical; content.spacing = 4
        content.translatesAutoresizingMaskIntoConstraints = false
        translationCard.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: translationCard.topAnchor, constant: 10),
            content.bottomAnchor.constraint(equalTo: translationCard.bottomAnchor, constant: -10),
            content.leadingAnchor.constraint(equalTo: translationCard.leadingAnchor, constant: 12),
            content.trailingAnchor.constraint(equalTo: translationCard.trailingAnchor, constant: -12)
        ])
    }

    private func controlsRow() -> UIView {
        configure(muteButton, image: "mic.fill", id: "button-copilot-mute", diameter: 44)
        muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
        let end = UIButton(type: .system)
        configure(end, image: "phone.down.fill", id: "button-copilot-end", diameter: 52)
        end.tintColor = .white; end.backgroundColor = .systemRed; end.layer.borderWidth = 0
        end.addTarget(self, action: #selector(endTapped), for: .touchUpInside)
        configure(routeButton, image: "speaker.wave.2.fill", id: "button-copilot-audio-route", diameter: 44)
        routeButton.addTarget(self, action: #selector(speakerTapped), for: .touchUpInside)
        let row = UIStackView(arrangedSubviews: [
            control(muteButton, NSLocalizedString("incall.mute", comment: "")),
            control(end, NSLocalizedString("incall.end", comment: "")),
            control(routeButton, NSLocalizedString("incall.route.speaker", comment: ""))
        ])
        row.axis = .horizontal; row.distribution = .fillEqually; row.alignment = .bottom
        return row
    }

    private func configure(_ button: UIButton, image: String, id: String, diameter: CGFloat) {
        button.setImage(UIImage(systemName: image), for: .normal)
        button.tintColor = Theme.ink
        button.backgroundColor = Theme.fill
        button.layer.cornerRadius = diameter / 2
        button.layer.borderWidth = 1
        button.layer.borderColor = Theme.line.cgColor
        button.accessibilityIdentifier = id
        button.widthAnchor.constraint(equalToConstant: diameter).isActive = true
        button.heightAnchor.constraint(equalToConstant: diameter).isActive = true
    }

    private func control(_ button: UIButton, _ text: String) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: 10)
        label.textColor = Theme.sub
        label.textAlignment = .center
        let stack = UIStackView(arrangedSubviews: [button, label])
        stack.axis = .vertical; stack.spacing = 3; stack.alignment = .center
        return stack
    }

    private func upsertConversation(direction: String, itemId: String?,
                                    source: String? = nil, translation: String? = nil) {
        let key = "\(direction)|\(itemId ?? "current")"
        if cards[key] == nil {
            let color = direction == "guest" ? Theme.greenDark : Theme.purple
            let container = UIView()
            container.backgroundColor = color.withAlphaComponent(0.12)
            container.layer.cornerRadius = 14
            let tag = UILabel()
            tag.text = NSLocalizedString(direction == "guest" ? "incall.card.caller" : "incall.card.you", comment: "")
            tag.font = .systemFont(ofSize: 11, weight: .semibold)
            tag.textColor = color
            let original = UILabel()
            original.font = .systemFont(ofSize: 16)
            original.numberOfLines = 0
            original.isHidden = true
            let translated = UILabel()
            translated.font = .systemFont(ofSize: 14)
            translated.textColor = Theme.sub
            translated.numberOfLines = 0
            translated.isHidden = true
            let labels = UIStackView(arrangedSubviews: [tag, original, translated])
            labels.axis = .vertical; labels.spacing = 3
            labels.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(labels)
            NSLayoutConstraint.activate([
                labels.topAnchor.constraint(equalTo: container.topAnchor, constant: 10),
                labels.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -10),
                labels.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
                labels.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12)
            ])
            feedStack.addArrangedSubview(container)
            cards[key] = ConversationCard(original: original, translation: translated)
        }
        if let source { cards[key]?.original.text = source; cards[key]?.original.isHidden = false }
        if let translation { cards[key]?.translation.text = translation; cards[key]?.translation.isHidden = false }
        view.layoutIfNeeded()
        let bottom = max(0, scrollView.contentSize.height - scrollView.bounds.height)
        scrollView.setContentOffset(CGPoint(x: 0, y: bottom), animated: true)
    }

    private func setReady() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.ptt.isEnabled = !self.releasePending
            self.status.text = NSLocalizedString("copilot.ready", comment: "")
        }
    }

    private func streamFailed() {
        DispatchQueue.main.async { [weak self] in
            self?.failed = true; self?.ptt.isEnabled = false
            // Keep the control receiving touch-up while a press is in flight;
            // the release event is what safely hands the audio gate back.
            if self?.pressed == true { self?.ptt.isEnabled = true }
            self?.status.text = NSLocalizedString("copilot.unavailable", comment: "")
        }
    }

    @objc private func pttChanged(_ gesture: UILongPressGestureRecognizer) {
        // Release must be handled even after transport failure. The audio
        // gate intentionally remains closed until this event reaches main.
        if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
            deliverReleaseIfNeeded()
            return
        }
        guard !failed, !releasePending, stream.state == .ready else { return }
        if gesture.state == .began {
            pressed = true
            status.text = NSLocalizedString("copilot.preparing", comment: "")
            intentGeneration += 1
            releaseDeliveredGeneration = nil
            let generation = intentGeneration
            let id = UUID().uuidString
            requestPrivateGate { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.pressed, self.intentGeneration == generation else {
                        // Release is delivered synchronously by the gesture
                        // handler exactly once. A late gate result never
                        // emits a second release request.
                        return
                    }
                    guard granted, !self.failed else {
                        self.status.text = NSLocalizedString("copilot.unavailable", comment: "")
                        return
                    }
                    self.holdId = id
                    self.translationLabel.text = nil
                    self.privateSourceLabel.text = nil
                    self.privateSourceLabel.isHidden = true
                    self.translationCard.isHidden = true
                    // UI remains non-private until the server's hold_ready arrives.
                    self.stream.holdStart(holdId: id)
                }
            }
        }
    }

    private func deliverReleaseIfNeeded() {
        guard pressed, releaseDeliveredGeneration != intentGeneration else { return }
        pressed = false
        releaseDeliveredGeneration = intentGeneration
        releasePending = true
        ptt.isEnabled = false
        let id = holdId
        holdId = nil; privateActive = false
        // Do not send hold_end or reopen audio here. The coordinator must
        // drain device frames first, then queue hold_end, then reopen.
        onReleaseHold?(id)
        status.text = NSLocalizedString(failed ? "copilot.unavailable" : "copilot.ready", comment: "")
    }

    /// Coordinator calls this after private frames have drained, hold_end has
    /// been queued, and Owner→Guest uplink is open again. Until then a new
    /// press is rejected, preventing overlapping release drains.
    func gateRestored() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.gateRestored() }
            return
        }
        releasePending = false
        if !failed, stream.state == .ready { ptt.isEnabled = true }
    }

    private func serverHoldReady(_ id: String) {
        guard pressed, holdId == id, !failed else { return }
        privateActive = true
        status.text = NSLocalizedString("copilot.private", comment: "")
    }

    @objc private func speakerTapped() {
        speakerEnabled.toggle()
        onSpeaker?(speakerEnabled)
        routeButton.setImage(UIImage(systemName: speakerEnabled ? "speaker.wave.2.fill" : "iphone"), for: .normal)
    }
    @objc private func muteTapped() {
        onMute?()
        let muted = CallManager.shared.isMuted
        muteButton.setImage(UIImage(systemName: muted ? "mic.slash.fill" : "mic.fill"), for: .normal)
        muteButton.tintColor = muted ? .systemRed : Theme.ink
    }
    @objc private func endTapped() { onEnd?() }

    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        stream.stop()
        super.dismiss(animated: flag, completion: completion)
    }
}