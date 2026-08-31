import UIKit

/// Full-screen conversation surface for a connected Translator phone call.
/// Audio is carried exclusively by the active Twilio call; this screen only
/// observes its authenticated call feed and asks CallManager to control it.
final class TranslatorViewController: UIViewController {
    private let callerName: String
    private let stream = TranslatorPhoneFeedStream()
    private let statusLabel = UILabel()
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()
    private let muteButton = UIButton(type: .system)
    private let routeButton = UIButton(type: .system)
    private var currentGuest: Card?
    private var currentOwner: Card?

    private final class Card {
        let view: UIView
        let original: UILabel
        let translation: UILabel
        init(view: UIView, original: UILabel, translation: UILabel) {
            self.view = view
            self.original = original
            self.translation = translation
        }
    }

    init(callerName: String) {
        self.callerName = callerName
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildUI()
        stream.delegate = self
        stream.connect()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshMuteButton()
    }

    func teardown() {
        stream.stop()
        dismiss(animated: true)
    }

    func refreshMuteButton() {
        let muted = CallManager.shared.isMuted
        muteButton.setImage(UIImage(systemName: muted ? "mic.slash.fill" : "mic.fill"), for: .normal)
        muteButton.tintColor = muted ? .systemRed : Theme.ink
    }

    private func buildUI() {
        let title = UILabel()
        title.text = NSLocalizedString("translator.title", comment: "")
        title.font = .systemFont(ofSize: 24, weight: .bold)
        title.textColor = Theme.ink
        title.textAlignment = .center

        statusLabel.text = NSLocalizedString("translator.status.connecting", comment: "")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = Theme.sub
        statusLabel.textAlignment = .center
        statusLabel.accessibilityIdentifier = "text-translator-status"

        let header = UIStackView(arrangedSubviews: [title, statusLabel])
        header.axis = .vertical
        header.spacing = 3
        header.translatesAutoresizingMaskIntoConstraints = false

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(feedStack)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-translator-feed"

        let controls = controlsRow()
        view.addSubview(header)
        view.addSubview(scrollView)
        view.addSubview(controls)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            scrollView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -10),
            controls.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            controls.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            controls.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
        ])
    }

    private func controlsRow() -> UIView {
        configure(muteButton, image: "mic.fill", id: "button-translator-mute", diameter: 44)
        muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
        let end = UIButton(type: .system)
        configure(end, image: "phone.down.fill", id: "button-translator-end", diameter: 52)
        end.tintColor = .white
        end.backgroundColor = .systemRed
        end.layer.borderWidth = 0
        end.addTarget(self, action: #selector(endTapped), for: .touchUpInside)
        configure(routeButton, image: "speaker.wave.2.fill", id: "button-translator-audio-route", diameter: 44)
        routeButton.addTarget(self, action: #selector(routeTapped), for: .touchUpInside)
        let row = UIStackView(arrangedSubviews: [
            control(muteButton, NSLocalizedString("incall.mute", comment: "")),
            control(end, NSLocalizedString("incall.end", comment: "")),
            control(routeButton, NSLocalizedString("incall.route.speaker", comment: "")),
        ])
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.alignment = .bottom
        row.translatesAutoresizingMaskIntoConstraints = false
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
        stack.axis = .vertical
        stack.spacing = 3
        stack.alignment = .center
        return stack
    }

    @objc private func muteTapped() { CallManager.shared.toggleMute() }
    @objc private func endTapped() { CallManager.shared.endCall() }
    @objc private func routeTapped() {
        let useSpeaker = routeButton.accessibilityValue != "speaker"
        CallManager.shared.setSpeakerEnabled(useSpeaker)
        routeButton.accessibilityValue = useSpeaker ? "speaker" : "receiver"
        routeButton.setImage(UIImage(systemName: useSpeaker ? "speaker.wave.2.fill" : "iphone"), for: .normal)
    }

    private func upsert(_ card: inout Card?, title: String, original: String, translation: String?, final: Bool, color: UIColor) {
        if card == nil {
            let container = UIView()
            container.backgroundColor = color.withAlphaComponent(0.12)
            container.layer.cornerRadius = 14
            let tag = UILabel()
            tag.text = title
            tag.font = .systemFont(ofSize: 11, weight: .semibold)
            tag.textColor = color
            let primary = UILabel()
            primary.font = .systemFont(ofSize: 16)
            primary.numberOfLines = 0
            let secondary = UILabel()
            secondary.font = .systemFont(ofSize: 14)
            secondary.textColor = Theme.sub
            secondary.numberOfLines = 0
            let labels = UIStackView(arrangedSubviews: [tag, primary, secondary])
            labels.axis = .vertical; labels.spacing = 3; labels.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(labels)
            NSLayoutConstraint.activate([
                labels.topAnchor.constraint(equalTo: container.topAnchor, constant: 10), labels.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -10),
                labels.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12), labels.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            ])
            feedStack.addArrangedSubview(container)
            card = Card(view: container, original: primary, translation: secondary)
        }
        card?.original.text = original
        card?.translation.text = translation
        card?.translation.isHidden = translation?.isEmpty ?? true
        if final { card = nil }
        view.layoutIfNeeded()
        scrollView.setContentOffset(CGPoint(x: 0, y: max(0, scrollView.contentSize.height - scrollView.bounds.height)), animated: true)
    }
}

extension TranslatorViewController: TranslatorPhoneFeedStreamDelegate {
    func translatorPhoneFeedDidConnect(_ stream: TranslatorPhoneFeedStream) {
        statusLabel.text = NSLocalizedString("translator.status.listening", comment: "")
    }
    func translatorPhoneFeed(_ stream: TranslatorPhoneFeedStream, didReceive event: TranslatorPhoneFeedEvent) {
        switch event {
        case let .transcript(leg, source, translation, final):
            if leg == "guest" {
                upsert(&currentGuest, title: NSLocalizedString("incall.card.caller", comment: ""), original: source, translation: translation, final: final, color: Theme.greenDark)
            } else {
                upsert(&currentOwner, title: NSLocalizedString("incall.card.you", comment: ""), original: source, translation: translation, final: final, color: Theme.purple)
            }
        case let .translationDelta(leg, text):
            if leg == "guest", let card = currentGuest { card.translation.text = (card.translation.text ?? "") + text; card.translation.isHidden = false }
            if leg != "guest", let card = currentOwner { card.translation.text = (card.translation.text ?? "") + text; card.translation.isHidden = false }
        case let .translation(leg, text, _):
            if leg == "guest", let card = currentGuest { card.translation.text = text; card.translation.isHidden = false }
            if leg != "guest", let card = currentOwner { card.translation.text = text; card.translation.isHidden = false }
        case let .turnCompleted(leg):
            if leg == "guest" { currentGuest = nil } else { currentOwner = nil }
        case let .error(message, fatal):
            statusLabel.text = message
            if fatal { stream.stop() }
        }
    }
}