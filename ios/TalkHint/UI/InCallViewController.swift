import UIKit

/// Full-screen in-call assistant shown while a call is connected. Renders the
/// live transcript (caller + owner) and AI hint suggestions streamed from the
/// backend `/ui` WebSocket. Presented by `CallManager` on connect and dismissed
/// on disconnect.
final class InCallViewController: UIViewController {

    private let callerName: String
    private let stream = CallHintStream()

    private let statusLabel = UILabel()
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()

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

    /// Called by CallManager when the call ends — closes the stream and dismisses.
    func teardown() {
        stream.disconnect()
        if presentingViewController != nil {
            dismiss(animated: true)
        }
    }

    deinit {
        stream.disconnect()
    }

    private func buildUI() {
        let titleLabel = UILabel()
        titleLabel.text = "On call with \(callerName)"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityIdentifier = "text-incall-title"

        statusLabel.text = "Connecting to live assistant…"
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "text-incall-status"

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-incall-feed"
        scrollView.addSubview(feedStack)

        let header = UIStackView(arrangedSubviews: [titleLabel, statusLabel])
        header.axis = .vertical
        header.spacing = 4
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        view.addSubview(scrollView)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 16),
            scrollView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: guide.bottomAnchor),

            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
        ])
    }

    // MARK: - Feed rendering

    private func appendCard(title: String,
                            titleColor: UIColor,
                            primary: String,
                            secondary: String?,
                            background: UIColor,
                            testIdSuffix: String) {
        let card = UIView()
        card.backgroundColor = background
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = "card-\(testIdSuffix)"

        let tag = UILabel()
        tag.text = title
        tag.font = .preferredFont(forTextStyle: .caption2)
        tag.textColor = titleColor

        let primaryLabel = UILabel()
        primaryLabel.text = primary
        primaryLabel.font = .preferredFont(forTextStyle: .body)
        primaryLabel.numberOfLines = 0
        primaryLabel.accessibilityIdentifier = "text-\(testIdSuffix)"

        let labels = UIStackView(arrangedSubviews: [tag, primaryLabel])
        labels.axis = .vertical
        labels.spacing = 2

        if let secondary = secondary {
            let secondaryLabel = UILabel()
            secondaryLabel.text = secondary
            secondaryLabel.font = .preferredFont(forTextStyle: .subheadline)
            secondaryLabel.textColor = .secondaryLabel
            secondaryLabel.numberOfLines = 0
            secondaryLabel.accessibilityIdentifier = "text-\(testIdSuffix)-translation"
            labels.addArrangedSubview(secondaryLabel)
        }

        labels.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(labels)
        NSLayoutConstraint.activate([
            labels.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            labels.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -10),
            labels.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            labels.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
        ])

        feedStack.addArrangedSubview(card)
        scrollToBottom()
    }

    private func scrollToBottom() {
        view.layoutIfNeeded()
        let bottom = max(0, scrollView.contentSize.height - scrollView.bounds.height
            + scrollView.adjustedContentInset.bottom)
        if bottom > 0 {
            scrollView.setContentOffset(CGPoint(x: 0, y: bottom), animated: true)
        }
    }
}

// MARK: - CallHintStreamDelegate

extension InCallViewController: CallHintStreamDelegate {
    func callHintStream(_ stream: CallHintStream, didReceive event: CallHintEvent) {
        switch event {
        case .guestTranscript(let text, let translation, _):
            appendCard(title: "CALLER", titleColor: .systemBlue,
                       primary: text, secondary: translation,
                       background: .secondarySystemBackground,
                       testIdSuffix: "guest")
        case .ownerTranscript(let text, _):
            appendCard(title: "YOU", titleColor: .systemGray,
                       primary: text, secondary: nil,
                       background: .secondarySystemBackground,
                       testIdSuffix: "owner")
        case .suggestion(let en, let translation):
            appendCard(title: "SUGGESTION", titleColor: .systemGreen,
                       primary: en, secondary: translation,
                       background: .systemGreen.withAlphaComponent(0.12),
                       testIdSuffix: "suggestion")
        case .fastPhrase(let text, let translation):
            appendCard(title: "QUICK PHRASE", titleColor: .systemOrange,
                       primary: text, secondary: translation,
                       background: .systemOrange.withAlphaComponent(0.12),
                       testIdSuffix: "fast-phrase")
        }
    }

    func callHintStreamDidConnect(_ stream: CallHintStream) {
        statusLabel.text = "Live assistant connected"
    }

    func callHintStreamDidDisconnect(_ stream: CallHintStream) {
        statusLabel.text = "Reconnecting to live assistant…"
    }
}
