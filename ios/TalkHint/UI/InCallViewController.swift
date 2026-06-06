import UIKit
import AVFoundation

/// Full-screen in-call assistant shown while a call is connected. Renders the
/// live transcript (caller + owner) and AI hint suggestions streamed from the
/// backend `/ui` WebSocket. Presented by `CallManager` on connect and dismissed
/// on disconnect.
final class InCallViewController: UIViewController {

    private let callerName: String
    private let stream = CallHintStream()

    /// Test seam: the live hint stream that the "Reconnect" button drives via
    /// `retryTapped`, exposed so the manual-reconnect path can be observed
    /// through the real instance instead of a stand-in.
    var hintStream: CallHintStream { stream }

    private let statusLabel = UILabel()
    private let reconnectSpinner = UIActivityIndicatorView(style: .medium)
    private let retryButton = UIButton(type: .system)
    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()

    // Pinned suggestion banner — always visible above the controls.
    private let suggestionBanner = UIView()
    private let suggestionPrimaryLabel = UILabel()
    private let suggestionSecondaryLabel = UILabel()

    private let goalField = UITextField()
    private let questionField = UITextField()
    private var inputBottomConstraint: NSLayoutConstraint?

    private let routeButton = UIButton(type: .system)
    private let muteButton = UIButton(type: .system)

    // Live (non-finalized) transcript card per speaker, kept independently —
    // like `interimMessages['guest']` / `interimMessages['you']` in the web.
    // Each is finalized only by its own `isFinal: true`.
    private var currentCallerCard: FeedCard?
    private var currentYouCard: FeedCard?

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
        // The mute state may have changed while another screen (e.g. the native
        // CallKit UI) was on top — resync the button when we re-appear.
        updateMuteButton()
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

        // Animated spinner shown only while a reconnect is in flight, so the
        // transient "Reconnecting…" state reads as in-progress rather than frozen.
        reconnectSpinner.hidesWhenStopped = true
        reconnectSpinner.setContentHuggingPriority(.required, for: .horizontal)
        reconnectSpinner.accessibilityIdentifier = "spinner-incall-reconnect"

        retryButton.setTitle("Reconnect", for: .normal)
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        retryButton.accessibilityIdentifier = "button-incall-retry"

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.accessibilityIdentifier = "scroll-incall-feed"
        scrollView.addSubview(feedStack)

        // Spinner sits inline with the status text so the reconnect indicator and
        // its label move together and stay centered under the title.
        let statusRow = UIStackView(arrangedSubviews: [reconnectSpinner, statusLabel])
        statusRow.axis = .horizontal
        statusRow.spacing = 6
        statusRow.alignment = .center

        let header = UIStackView(arrangedSubviews: [titleLabel, statusRow, retryButton])
        header.axis = .vertical
        header.spacing = 4
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        view.addSubview(scrollView)

        let controlsRow = buildControlsRow()
        let inputBar = buildInputBar()
        let suggestionBanner = buildSuggestionBanner()

        // Suggestion banner + controls + input stacked together and pinned to the
        // bottom; the banner sits just above the controls so it never scrolls away.
        let bottomStack = UIStackView(arrangedSubviews: [suggestionBanner, controlsRow, inputBar])
        bottomStack.axis = .vertical
        bottomStack.spacing = 8
        bottomStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bottomStack)

        let guide = view.safeAreaLayoutGuide
        let bottomConstraint = bottomStack.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8)
        inputBottomConstraint = bottomConstraint
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            header.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            scrollView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 16),
            scrollView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomStack.topAnchor, constant: -8),

            bottomStack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            bottomStack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            bottomConstraint,

            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 8),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -8),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 16),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -16),
        ])

        observeKeyboard()
        observeAudioRoute()
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(tap)
    }

    private func buildInputBar() -> UIView {
        goalField.placeholder = "Set call goal (e.g. book a table)"
        goalField.text = SessionStore.shared.callGoal
        goalField.borderStyle = .roundedRect
        goalField.font = .preferredFont(forTextStyle: .subheadline)
        goalField.returnKeyType = .done
        goalField.delegate = self
        goalField.accessibilityIdentifier = "input-goal"

        let setGoalButton = UIButton(type: .system)
        setGoalButton.setTitle("Set", for: .normal)
        setGoalButton.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
        setGoalButton.addTarget(self, action: #selector(setGoalTapped), for: .touchUpInside)
        setGoalButton.accessibilityIdentifier = "button-set-goal"
        setGoalButton.setContentHuggingPriority(.required, for: .horizontal)

        let goalRow = UIStackView(arrangedSubviews: [goalField, setGoalButton])
        goalRow.axis = .horizontal
        goalRow.spacing = 8
        goalRow.alignment = .center

        questionField.placeholder = "Ask the assistant…"
        questionField.borderStyle = .roundedRect
        questionField.font = .preferredFont(forTextStyle: .body)
        questionField.returnKeyType = .send
        questionField.delegate = self
        questionField.accessibilityIdentifier = "input-question"

        let askButton = UIButton(type: .system)
        askButton.setTitle("Ask", for: .normal)
        askButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        askButton.addTarget(self, action: #selector(askTapped), for: .touchUpInside)
        askButton.accessibilityIdentifier = "button-ask-ai"
        askButton.setContentHuggingPriority(.required, for: .horizontal)

        let askRow = UIStackView(arrangedSubviews: [questionField, askButton])
        askRow.axis = .horizontal
        askRow.spacing = 8
        askRow.alignment = .center

        let bar = UIStackView(arrangedSubviews: [goalRow, askRow])
        bar.axis = .vertical
        bar.spacing = 8
        bar.translatesAutoresizingMaskIntoConstraints = false
        return bar
    }

    /// The pinned "SUGGESTION" banner shown above the controls. Hidden until the
    /// first suggestion arrives, then updated in place with the latest one so it
    /// stays visible and never scrolls away with the transcript feed.
    private func buildSuggestionBanner() -> UIView {
        suggestionBanner.backgroundColor = .systemGreen.withAlphaComponent(0.18)
        suggestionBanner.layer.cornerRadius = 12
        suggestionBanner.isHidden = true
        suggestionBanner.accessibilityIdentifier = "card-suggestion"

        let tag = UILabel()
        tag.text = "SUGGESTION"
        tag.font = .preferredFont(forTextStyle: .caption2)
        tag.textColor = .systemGreen

        // Larger, bold primary text so the suggestion stands out at a glance.
        let titleFont = UIFont.preferredFont(forTextStyle: .title3)
        suggestionPrimaryLabel.font = titleFont.fontDescriptor
            .withSymbolicTraits(.traitBold)
            .map { UIFont(descriptor: $0, size: 0) } ?? titleFont
        suggestionPrimaryLabel.numberOfLines = 0
        suggestionPrimaryLabel.accessibilityIdentifier = "text-suggestion"

        suggestionSecondaryLabel.font = .preferredFont(forTextStyle: .subheadline)
        suggestionSecondaryLabel.textColor = .secondaryLabel
        suggestionSecondaryLabel.numberOfLines = 0
        suggestionSecondaryLabel.isHidden = true
        suggestionSecondaryLabel.accessibilityIdentifier = "text-suggestion-translation"

        let labels = UIStackView(arrangedSubviews: [tag, suggestionPrimaryLabel, suggestionSecondaryLabel])
        labels.axis = .vertical
        labels.spacing = 2
        labels.translatesAutoresizingMaskIntoConstraints = false
        suggestionBanner.addSubview(labels)
        NSLayoutConstraint.activate([
            labels.topAnchor.constraint(equalTo: suggestionBanner.topAnchor, constant: 10),
            labels.bottomAnchor.constraint(equalTo: suggestionBanner.bottomAnchor, constant: -10),
            labels.leadingAnchor.constraint(equalTo: suggestionBanner.leadingAnchor, constant: 12),
            labels.trailingAnchor.constraint(equalTo: suggestionBanner.trailingAnchor, constant: -12),
        ])
        return suggestionBanner
    }

    private func buildControlsRow() -> UIView {
        routeButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        routeButton.titleLabel?.adjustsFontSizeToFitWidth = true
        routeButton.titleLabel?.minimumScaleFactor = 0.7
        routeButton.titleLabel?.lineBreakMode = .byTruncatingTail
        routeButton.layer.cornerRadius = 10
        routeButton.addTarget(self, action: #selector(routeButtonTapped), for: .touchUpInside)
        routeButton.accessibilityIdentifier = "button-audio-route"
        updateRouteButton()

        muteButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        muteButton.titleLabel?.adjustsFontSizeToFitWidth = true
        muteButton.titleLabel?.minimumScaleFactor = 0.7
        muteButton.titleLabel?.lineBreakMode = .byTruncatingTail
        muteButton.layer.cornerRadius = 10
        muteButton.addTarget(self, action: #selector(muteButtonTapped), for: .touchUpInside)
        muteButton.accessibilityIdentifier = "button-mute"
        updateMuteButton()

        let endButton = UIButton(type: .system)
        endButton.setTitle("End Call", for: .normal)
        endButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        endButton.setTitleColor(.white, for: .normal)
        endButton.backgroundColor = .systemRed
        endButton.layer.cornerRadius = 10
        endButton.addTarget(self, action: #selector(endCallTapped), for: .touchUpInside)
        endButton.accessibilityIdentifier = "button-end-call"

        let row = UIStackView(arrangedSubviews: [routeButton, muteButton, endButton])
        row.axis = .horizontal
        row.spacing = 12
        row.distribution = .fillEqually
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(equalToConstant: 50).isActive = true
        return row
    }

    /// True when the session's current output route is the built-in speaker.
    private var isSpeakerRouteActive: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs
            .contains { $0.portType == .builtInSpeaker }
    }

    /// Icon + short name describing the current audio output route, used to
    /// label the route button so it always reflects the live route.
    private func currentRouteLabel() -> String {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        guard let port = outputs.first else { return "🔈 Audio" }
        switch port.portType {
        case .builtInSpeaker:
            return "🔊 Speaker"
        case .builtInReceiver:
            return "📱 iPhone"
        case .headphones, .headsetMic:
            return "🎧 Headphones"
        case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE:
            return "🎧 \(port.portName)"
        case .usbAudio:
            return "🎧 \(port.portName)"
        case .carAudio:
            return "🚗 \(port.portName)"
        default:
            return "🔈 \(port.portName)"
        }
    }

    private func updateRouteButton() {
        routeButton.setTitle(currentRouteLabel(), for: .normal)
        routeButton.backgroundColor = isSpeakerRouteActive
            ? UIColor.systemBlue.withAlphaComponent(0.20)
            : .secondarySystemBackground
    }

    /// External (non-built-in) input ports the user can explicitly select as a
    /// call output — Bluetooth headsets, wired headsets, USB, and car audio.
    private static func isSelectableExternal(_ type: AVAudioSession.Port) -> Bool {
        switch type {
        case .bluetoothHFP, .bluetoothLE, .headsetMic, .headphones, .usbAudio, .carAudio:
            return true
        default:
            return false
        }
    }

    @objc private func routeButtonTapped() {
        let session = AVAudioSession.sharedInstance()
        let currentType = session.currentRoute.outputs.first?.portType
        let sheet = UIAlertController(title: "Audio Output", message: nil,
                                      preferredStyle: .actionSheet)

        sheet.addAction(routeAction(title: "iPhone",
                                    selected: currentType == .builtInReceiver) { [weak self] in
            self?.routeToBuiltInReceiver()
        })
        sheet.addAction(routeAction(title: "Speaker",
                                    selected: currentType == .builtInSpeaker) { [weak self] in
            self?.routeToSpeaker()
        })

        for input in session.availableInputs ?? []
        where Self.isSelectableExternal(input.portType) {
            let selected = session.currentRoute.outputs
                .contains { $0.portType == input.portType }
            sheet.addAction(routeAction(title: input.portName, selected: selected) { [weak self] in
                self?.routeToInput(input)
            })
        }

        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))

        // Required for iPad — anchor the action sheet to the route button.
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = routeButton
            popover.sourceRect = routeButton.bounds
        }
        present(sheet, animated: true)
    }

    private func routeAction(title: String,
                             selected: Bool,
                             handler: @escaping () -> Void) -> UIAlertAction {
        let action = UIAlertAction(title: selected ? "✓ \(title)" : title,
                                   style: .default) { _ in handler() }
        action.accessibilityIdentifier = "action-route-\(title)"
        return action
    }

    private func routeToSpeaker() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(.speaker)
        } catch {
            print("[InCall] route to speaker failed: \(error.localizedDescription)")
        }
        updateRouteButton()
    }

    private func routeToBuiltInReceiver() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(.none)
            if let builtIn = session.availableInputs?
                .first(where: { $0.portType == .builtInMic }) {
                try session.setPreferredInput(builtIn)
            }
        } catch {
            print("[InCall] route to iPhone failed: \(error.localizedDescription)")
        }
        updateRouteButton()
    }

    private func routeToInput(_ input: AVAudioSessionPortDescription) {
        let session = AVAudioSession.sharedInstance()
        do {
            // Clear any speaker override, then steer both directions at the
            // chosen external device by setting it as the preferred input.
            try session.overrideOutputAudioPort(.none)
            try session.setPreferredInput(input)
        } catch {
            print("[InCall] route to \(input.portName) failed: \(error.localizedDescription)")
        }
        updateRouteButton()
    }

    private func observeAudioRoute() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(audioRouteChanged(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: nil)
    }

    @objc private func audioRouteChanged(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.updateRouteButton()
        }
    }

    private func updateMuteButton() {
        let muted = CallManager.shared.isMuted
        muteButton.setTitle(muted ? "🔇 Muted" : "🎙 Mute", for: .normal)
        muteButton.backgroundColor = muted
            ? UIColor.systemRed.withAlphaComponent(0.20)
            : .secondarySystemBackground
    }

    /// Called by CallManager whenever the call's mute state changes (including
    /// external sources like CallKit's native mute) so the button never drifts
    /// from the real Twilio call state.
    func refreshMuteButton() {
        DispatchQueue.main.async { [weak self] in
            self?.updateMuteButton()
        }
    }

    @objc private func muteButtonTapped() {
        // Drive the mute through CallKit; the resulting CXSetMutedCallAction
        // applies it to the call and calls back into refreshMuteButton().
        CallManager.shared.toggleMute()
    }

    @objc private func endCallTapped() {
        CallManager.shared.endCall()
    }

    private func observeKeyboard() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange(_:)),
                           name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let overlap = max(0, view.bounds.height - view.safeAreaInsets.bottom
            - view.convert(frame, from: nil).origin.y)
        inputBottomConstraint?.constant = -8 - overlap
        view.layoutIfNeeded()
        scrollToBottom()
    }

    @objc private func keyboardWillHide() {
        inputBottomConstraint?.constant = -8
        view.layoutIfNeeded()
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    @objc private func setGoalTapped() {
        let goal = goalField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !goal.isEmpty else { return }
        stream.setGoal(goal)
        SessionStore.shared.callGoal = goal
        statusLabel.text = "Goal set: \(goal)"
        goalField.resignFirstResponder()
    }

    @objc private func retryTapped() {
        retryButton.isHidden = true
        statusLabel.text = "Reconnecting to live assistant…"
        stream.retry()
    }

    @objc private func askTapped() {
        let question = questionField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !question.isEmpty else { return }
        let goal = goalField.text?.trimmingCharacters(in: .whitespacesAndNewlines)
        stream.askAI(question, goal: goal)
        appendCard(title: "ASKED", titleColor: .systemPurple,
                   primary: question, secondary: nil,
                   background: .systemPurple.withAlphaComponent(0.10),
                   testIdSuffix: "asked")
        questionField.text = ""
    }

    // MARK: - Feed rendering

    /// A transcript card whose text can be updated in place while a speaker is
    /// still talking (interim results), then frozen when the turn is final.
    /// Mirrors the web `interimMessages[type]` behavior in `script.js`.
    private final class FeedCard {
        let view: UIView
        let primaryLabel: UILabel
        let secondaryLabel: UILabel

        init(view: UIView, primaryLabel: UILabel, secondaryLabel: UILabel) {
            self.view = view
            self.primaryLabel = primaryLabel
            self.secondaryLabel = secondaryLabel
        }

        /// Replace (not append) the card's text — the interim update path.
        func update(primary: String, secondary: String?) {
            primaryLabel.text = primary
            if let secondary = secondary, !secondary.isEmpty {
                secondaryLabel.text = secondary
                secondaryLabel.isHidden = false
            } else {
                secondaryLabel.isHidden = true
            }
        }

        /// Dim interim text (matches the web's 0.7 opacity); full opacity on final.
        func setInterim(_ interim: Bool) {
            view.alpha = interim ? 0.7 : 1.0
        }
    }

    @discardableResult
    private func appendCard(title: String,
                            titleColor: UIColor,
                            primary: String,
                            secondary: String?,
                            background: UIColor,
                            testIdSuffix: String) -> FeedCard {
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

        // Always create the translation label so it can be filled in later when
        // an interim transcript is finalized; hidden until it has content.
        let secondaryLabel = UILabel()
        secondaryLabel.font = .preferredFont(forTextStyle: .subheadline)
        secondaryLabel.textColor = .secondaryLabel
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
        scrollToBottom()
        return FeedCard(view: card, primaryLabel: primaryLabel, secondaryLabel: secondaryLabel)
    }

    /// Update the speaker's live card in place for interim results, or create a
    /// new one if none is open. On `isFinal` the card is frozen and its slot is
    /// cleared so the next utterance starts a fresh card.
    private func upsertTranscript(card: inout FeedCard?,
                                  title: String,
                                  titleColor: UIColor,
                                  primary: String,
                                  secondary: String?,
                                  testIdSuffix: String,
                                  isFinal: Bool) {
        if let existing = card {
            existing.update(primary: primary, secondary: secondary)
            existing.setInterim(!isFinal)
            scrollToBottom()
        } else {
            let new = appendCard(title: title, titleColor: titleColor,
                                 primary: primary, secondary: secondary,
                                 background: .secondarySystemBackground,
                                 testIdSuffix: testIdSuffix)
            new.setInterim(!isFinal)
            card = new
        }
        if isFinal {
            card = nil
        }
    }

    /// Show or replace the pinned suggestion banner with the latest suggestion.
    private func showSuggestion(en: String, translation: String?) {
        suggestionPrimaryLabel.text = en
        if let translation = translation, !translation.isEmpty {
            suggestionSecondaryLabel.text = translation
            suggestionSecondaryLabel.isHidden = false
        } else {
            suggestionSecondaryLabel.isHidden = true
        }
        suggestionBanner.isHidden = false
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
        case .guestTranscript(let text, let translation, let confidence, let isFinal):
            // Drop obviously garbled finals so noisy STT never hits the CALLER
            // line, matching the web UI's `isGarbageSTT` guard. Interim text
            // still updates in place.
            if isFinal && isGarbageSTT(text, confidence: confidence) {
                return
            }
            upsertTranscript(card: &currentCallerCard,
                             title: "CALLER", titleColor: .systemBlue,
                             primary: text, secondary: translation,
                             testIdSuffix: "guest", isFinal: isFinal)
        case .ownerTranscript(let text, let confidence, let isFinal):
            // Drop obviously garbled finals so noisy STT never hits the YOU line,
            // matching the web UI's `isGarbageSTT` guard. Interim text still
            // updates in place.
            if isFinal && isGarbageSTT(text, confidence: confidence) {
                return
            }
            upsertTranscript(card: &currentYouCard,
                             title: "YOU", titleColor: .systemGray,
                             primary: text, secondary: nil,
                             testIdSuffix: "owner", isFinal: isFinal)
        case .suggestion(let en, let translation):
            showSuggestion(en: en, translation: translation)
        case .fastPhrase(let text, let translation):
            appendCard(title: "QUICK PHRASE", titleColor: .systemOrange,
                       primary: text, secondary: translation,
                       background: .systemOrange.withAlphaComponent(0.12),
                       testIdSuffix: "fast-phrase")
        case .aiResponse(let text, let isError):
            appendCard(title: isError ? "ERROR" : "ASSISTANT",
                       titleColor: isError ? .systemRed : .systemPurple,
                       primary: text, secondary: nil,
                       background: (isError ? UIColor.systemRed : UIColor.systemPurple)
                        .withAlphaComponent(0.12),
                       testIdSuffix: "ai-response")
        }
    }

    /// Mirrors the web UI's `isGarbageSTT`: drops short / low-confidence /
    /// known-noise owner finals so garbled speech-to-text never shows on the
    /// YOU line. `confidence` is only checked when the server provides one.
    private func isGarbageSTT(_ text: String, confidence: Double?) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return true }

        // Too short - likely garbage.
        let words = trimmed.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" })
        if words.count < 3 { return true }

        // Low confidence.
        if let confidence = confidence, confidence < 0.65 { return true }

        // Common garbage patterns.
        let garbagePatterns = [
            "^(so|the|and|but|or|um|uh|like)\\s*$",
            "^(does it|so the|stairs|I'm stay|I stay)\\.?$",
            "^\\w{1,3}\\.?$"
        ]
        let range = NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)
        for pattern in garbagePatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
               regex.firstMatch(in: trimmed, options: [], range: range) != nil {
                return true
            }
        }

        return false
    }

    func callHintStreamDidConnect(_ stream: CallHintStream) {
        statusLabel.text = "Live assistant connected"
        reconnectSpinner.stopAnimating()
        retryButton.isHidden = true
    }

    func callHintStream(_ stream: CallHintStream,
                        didDisconnectWillRetryAttempt attempt: Int,
                        of maxAttempts: Int) {
        // Show progress (attempt N of M) with a live spinner so the feed reads as
        // actively recovering, not frozen, until the terminal state is reached.
        statusLabel.text = CallHintStream.reconnectingStatusText(attempt: attempt, of: maxAttempts)
        reconnectSpinner.startAnimating()
        retryButton.isHidden = true
    }

    func callHintStreamDidFailTerminally(_ stream: CallHintStream) {
        statusLabel.text = "Live assistant unavailable. Check your connection."
        reconnectSpinner.stopAnimating()
        retryButton.isHidden = false
    }

    func callHintStreamDidRequireSignIn(_ stream: CallHintStream) {
        // The stream stopped because there's no valid session token (signed out).
        // Show an actionable message instead of a stuck "Reconnecting…" label.
        // Keep the retry button visible so the user can try again after signing in.
        statusLabel.text = "Sign in to use the live assistant"
        reconnectSpinner.stopAnimating()
        retryButton.isHidden = false
    }
}

// MARK: - UITextFieldDelegate

extension InCallViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if textField === goalField {
            setGoalTapped()
        } else if textField === questionField {
            askTapped()
        }
        textField.resignFirstResponder()
        return true
    }
}
