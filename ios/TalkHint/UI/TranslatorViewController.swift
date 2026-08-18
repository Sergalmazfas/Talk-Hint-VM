import UIKit

/// Translator tab — a standalone screen for calls with live speech translation
/// (stage 1: visual placeholder/prototype, no realtime engine yet).
///
/// Deliberately mirrors the live in-call screen (`InCallViewController`): the
/// same overall layout — status line on top, a scrollable feed of rounded
/// conversation cards, and a pinned bottom row of circular call controls
/// (Mute / End / Audio route). It has NO avatar, NO Tutor, NO Hint banner and
/// NO Ask field: instead of hints, this screen's feed will show translation
/// pairs — the user's utterance followed by its translation, then the other
/// party's utterance followed by its translation.
///
/// Future stages (kept OUT of this file for now, see project plan):
/// - stage 2 wires this screen to a realtime translation model. Translator
///   calls MUST go through the same `CallManager` / call-session / history
///   entities as regular Hint calls (see `CallManager.CallMode`) — never a
///   separate, isolated "translator history".
/// - stage 3 adds switching between the Hint call and Translator inside one
///   active call session.
final class TranslatorViewController: UIViewController {

    private let statusLabel = UILabel()
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("translator.title", comment: "")
        view.backgroundColor = .systemBackground
        buildUI()
        showPlaceholderFeed()
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

        let controlsRow = buildControlsRow()
        view.addSubview(controlsRow)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: guide.topAnchor, constant: 6),
            statusLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            scrollView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
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
        appendCard(
            title: NSLocalizedString("translator.title", comment: ""),
            titleColor: Theme.purple,
            primary: NSLocalizedString("translator.placeholder.title", comment: ""),
            secondary: NSLocalizedString("translator.placeholder.message", comment: ""),
            background: Theme.purpleBg,
            testIdSuffix: "translator-placeholder")
    }

    // MARK: - Feed cards (same visual language as InCallViewController)

    private func appendCard(title: String,
                            titleColor: UIColor,
                            primary: String,
                            secondary: String?,
                            background: UIColor,
                            testIdSuffix: String) {
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
    }

    // MARK: - Call controls (same style/geometry as InCallViewController)

    /// Mute / End / Audio-route in the exact in-call style. Disabled until the
    /// realtime engine is connected (stage 2) — placeholder screens must never
    /// pretend a control works.
    private func buildControlsRow() -> UIView {
        let muteButton = UIButton(type: .system)
        configureCircleButton(muteButton, diameter: 44)
        muteButton.setImage(UIImage(systemName: "mic.slash.fill"), for: .normal)
        muteButton.isEnabled = false
        muteButton.accessibilityIdentifier = "button-translator-mute"
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
        let endCaption = caption(NSLocalizedString("incall.end", comment: ""))

        let routeButton = UIButton(type: .system)
        configureCircleButton(routeButton, diameter: 44)
        routeButton.setImage(UIImage(systemName: "speaker.wave.2.fill"), for: .normal)
        routeButton.isEnabled = false
        routeButton.accessibilityIdentifier = "button-translator-audio-route"
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
}
