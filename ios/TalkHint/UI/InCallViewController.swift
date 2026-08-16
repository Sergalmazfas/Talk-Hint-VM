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
    /// Vertical stack of tappable pill buttons shown for CHOICE-type hints;
    /// hidden for every other hint type.
    private let choiceButtonsStack = UIStackView()

    private let goalField = UITextField()
    private let questionField = UITextField()
    private var inputBottomConstraint: NSLayoutConstraint?

    private let routeButton = UIButton(type: .system)
    private let muteButton = UIButton(type: .system)
    private let routeCaption = UILabel()
    private let muteCaption = UILabel()

    // Live (non-finalized) transcript card per speaker, kept independently —
    // like `interimMessages['guest']` / `interimMessages['you']` in the web.
    // Each is finalized only by its own `isFinal: true`.
    private var currentCallerCard: FeedCard?
    private var currentYouCard: FeedCard?

    // True when the stream stopped because the user is signed out. In this state
    // the retry button acts as a "Sign in" affordance (presenting the login
    // screen) rather than a plain reconnect, since reconnecting without a token
    // would just fail again. Reset once a connect/retry path takes over.
    private var needsSignIn = false

    // Last goal text rendered in the feed. The server echoes goal_set on every
    // (re)connect (persisted selections are re-sent), so without this a mid-call
    // reconnect would duplicate the "GOAL" card in the conversation history.
    private var lastGoalShownInFeed: String?

    init(callerName: String) {
        self.callerName = callerName
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
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
        // A new call always starts without the previous call's goal — the goal is
        // part of one conversation's history, not a sticky app-level setting.
        // Clear it server-side too (covers calls that never opened a media
        // stream, where the server-side end-of-call cleanup never runs).
        stream.setGoal("")
        SessionStore.shared.callGoal = ""
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
        titleLabel.text = String(format: NSLocalizedString("incall.title", comment: ""), callerName)
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.textColor = Theme.ink
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityIdentifier = "text-incall-title"

        statusLabel.text = NSLocalizedString("incall.status.connecting", comment: "")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = Theme.sub
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "text-incall-status"

        // Animated spinner shown only while a reconnect is in flight, so the
        // transient "Reconnecting…" state reads as in-progress rather than frozen.
        reconnectSpinner.hidesWhenStopped = true
        reconnectSpinner.setContentHuggingPriority(.required, for: .horizontal)
        reconnectSpinner.accessibilityIdentifier = "spinner-incall-reconnect"

        retryButton.setTitle(NSLocalizedString("incall.reconnect", comment: ""), for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        retryButton.setTitleColor(Theme.green, for: .normal)
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

        let goalCard = buildGoalCard()

        let header = UIStackView(arrangedSubviews: [titleLabel, statusRow, retryButton, goalCard])
        header.axis = .vertical
        header.spacing = 4
        header.setCustomSpacing(12, after: retryButton)
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
        // Tap anywhere (not just the transcript scroll view — with the keyboard
        // up on small screens the scroll view can be fully covered, leaving the
        // user with NO way to dismiss the keyboard) to end editing. Buttons and
        // fields still receive their touches because cancelsTouchesInView=false,
        // and the delegate below excludes them from triggering dismissal (a tap
        // INTO a text field must focus it, not immediately resign it).
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        view.addGestureRecognizer(tap)
        // Also let a downward drag on the transcript dismiss the keyboard, like
        // Messages.
        scrollView.keyboardDismissMode = .interactive
    }

    /// The "Your goal" card pinned under the header, per the approved mockup —
    /// a white card with a hairline border, target icon, and the (editable)
    /// goal text. Editing here keeps the existing goal-editor behavior: typing
    /// a goal and hitting Set/Done sends it over the live stream.
    private func buildGoalCard() -> UIView {
        let card = UIView()
        card.backgroundColor = .white
        card.layer.cornerRadius = 16
        card.layer.borderWidth = 1
        card.layer.borderColor = Theme.line.cgColor
        card.accessibilityIdentifier = "card-goal-editor"

        let icon = UIImageView(image: UIImage(systemName: "target"))
        icon.tintColor = Theme.green
        icon.contentMode = .scaleAspectFit
        icon.setContentHuggingPriority(.required, for: .horizontal)
        icon.widthAnchor.constraint(equalToConstant: 16).isActive = true

        let caption = UILabel()
        caption.text = NSLocalizedString("incall.your_goal", comment: "")
        caption.font = .systemFont(ofSize: 13, weight: .semibold)
        caption.textColor = Theme.greenDark

        let captionRow = UIStackView(arrangedSubviews: [icon, caption, UIView()])
        captionRow.axis = .horizontal
        captionRow.spacing = 6
        captionRow.alignment = .center

        goalField.placeholder = NSLocalizedString("incall.goal.placeholder", comment: "")
        goalField.text = SessionStore.shared.callGoal
        goalField.borderStyle = .none
        goalField.font = .systemFont(ofSize: 14)
        goalField.textColor = Theme.ink
        goalField.returnKeyType = .done
        goalField.delegate = self
        goalField.accessibilityIdentifier = "input-goal"

        let setGoalButton = UIButton(type: .system)
        setGoalButton.setTitle(NSLocalizedString("incall.set", comment: ""), for: .normal)
        setGoalButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        setGoalButton.setTitleColor(Theme.greenDark, for: .normal)
        setGoalButton.backgroundColor = Theme.greenBg
        setGoalButton.layer.cornerRadius = 12
        setGoalButton.contentEdgeInsets = UIEdgeInsets(top: 5, left: 12, bottom: 5, right: 12)
        setGoalButton.addTarget(self, action: #selector(setGoalTapped), for: .touchUpInside)
        setGoalButton.accessibilityIdentifier = "button-set-goal"
        setGoalButton.setContentHuggingPriority(.required, for: .horizontal)

        let goalRow = UIStackView(arrangedSubviews: [goalField, setGoalButton])
        goalRow.axis = .horizontal
        goalRow.spacing = 8
        goalRow.alignment = .center

        let content = UIStackView(arrangedSubviews: [captionRow, goalRow])
        content.axis = .vertical
        content.spacing = 6
        content.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            content.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            content.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
        ])
        return card
    }

    private func buildInputBar() -> UIView {
        questionField.placeholder = NSLocalizedString("incall.ask.placeholder", comment: "")
        questionField.borderStyle = .none
        questionField.font = .systemFont(ofSize: 15)
        questionField.textColor = Theme.ink
        questionField.returnKeyType = .send
        questionField.delegate = self
        questionField.accessibilityIdentifier = "input-question"

        // The question field lives in a bordered pill so it reads as an input
        // on the all-white background (borderStyle .none has no chrome).
        let fieldPill = UIView()
        fieldPill.backgroundColor = Theme.fill
        fieldPill.layer.cornerRadius = 12
        fieldPill.layer.borderWidth = 1
        fieldPill.layer.borderColor = Theme.line.cgColor
        questionField.translatesAutoresizingMaskIntoConstraints = false
        fieldPill.addSubview(questionField)
        NSLayoutConstraint.activate([
            questionField.topAnchor.constraint(equalTo: fieldPill.topAnchor, constant: 8),
            questionField.bottomAnchor.constraint(equalTo: fieldPill.bottomAnchor, constant: -8),
            questionField.leadingAnchor.constraint(equalTo: fieldPill.leadingAnchor, constant: 12),
            questionField.trailingAnchor.constraint(equalTo: fieldPill.trailingAnchor, constant: -12),
        ])

        let askButton = UIButton(type: .system)
        askButton.setTitle(NSLocalizedString("incall.ask", comment: ""), for: .normal)
        askButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        askButton.setTitleColor(.white, for: .normal)
        askButton.backgroundColor = Theme.purple
        askButton.layer.cornerRadius = 12
        askButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        askButton.addTarget(self, action: #selector(askTapped), for: .touchUpInside)
        askButton.accessibilityIdentifier = "button-ask-ai"
        askButton.setContentHuggingPriority(.required, for: .horizontal)

        let askRow = UIStackView(arrangedSubviews: [fieldPill, askButton])
        askRow.axis = .horizontal
        askRow.spacing = 8
        askRow.alignment = .center
        askRow.translatesAutoresizingMaskIntoConstraints = false
        return askRow
    }

    /// The pinned "SUGGESTION" banner shown above the controls. Hidden until the
    /// first suggestion arrives, then updated in place with the latest one so it
    /// stays visible and never scrolls away with the transcript feed.
    private func buildSuggestionBanner() -> UIView {
        // Purple "AI hint" card per the approved mockup: light purple surface,
        // soft purple border, sparkles icon + "Hint" tag with a live dot.
        suggestionBanner.backgroundColor = Theme.purpleBg
        suggestionBanner.layer.cornerRadius = 16
        suggestionBanner.layer.borderWidth = 1
        suggestionBanner.layer.borderColor = UIColor(
            red: 0xC9 / 255.0, green: 0xBC / 255.0, blue: 0xFF / 255.0, alpha: 1).cgColor
        suggestionBanner.isHidden = true
        suggestionBanner.accessibilityIdentifier = "card-suggestion"

        let sparkles = UIImageView(image: UIImage(systemName: "sparkles"))
        sparkles.tintColor = Theme.purple
        sparkles.contentMode = .scaleAspectFit
        sparkles.setContentHuggingPriority(.required, for: .horizontal)
        sparkles.widthAnchor.constraint(equalToConstant: 16).isActive = true

        let tag = UILabel()
        tag.text = NSLocalizedString("incall.hint", comment: "")
        tag.font = .systemFont(ofSize: 13, weight: .semibold)
        tag.textColor = Theme.purple

        let liveDot = UIView()
        liveDot.backgroundColor = Theme.green
        liveDot.layer.cornerRadius = 3
        liveDot.widthAnchor.constraint(equalToConstant: 6).isActive = true
        liveDot.heightAnchor.constraint(equalToConstant: 6).isActive = true

        let liveLabel = UILabel()
        liveLabel.text = NSLocalizedString("incall.live", comment: "")
        liveLabel.font = .systemFont(ofSize: 11, weight: .medium)
        liveLabel.textColor = Theme.sub
        liveLabel.setContentHuggingPriority(.required, for: .horizontal)

        let tagRow = UIStackView(arrangedSubviews: [sparkles, tag, UIView(), liveDot, liveLabel])
        tagRow.axis = .horizontal
        tagRow.spacing = 6
        tagRow.alignment = .center

        suggestionPrimaryLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        suggestionPrimaryLabel.textColor = Theme.ink
        suggestionPrimaryLabel.numberOfLines = 0
        suggestionPrimaryLabel.accessibilityIdentifier = "text-suggestion"
        // The hint text must NEVER be squeezed out of existence. When the
        // keyboard is up on a small screen the bottom stack can run out of
        // vertical room, and Auto Layout resolves the overflow by compressing
        // the lowest-priority views — which was these labels, leaving a hint
        // card with only the "Hint • live" header and no visible hint.
        suggestionPrimaryLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        suggestionSecondaryLabel.font = .systemFont(ofSize: 14)
        suggestionSecondaryLabel.textColor = Theme.sub
        suggestionSecondaryLabel.numberOfLines = 0
        suggestionSecondaryLabel.isHidden = true
        suggestionSecondaryLabel.accessibilityIdentifier = "text-suggestion-translation"
        suggestionSecondaryLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        // CHOICE hint buttons — vertical stack, hidden until a CHOICE arrives.
        choiceButtonsStack.axis = .vertical
        choiceButtonsStack.spacing = 8
        choiceButtonsStack.isHidden = true
        choiceButtonsStack.accessibilityIdentifier = "stack-choice-buttons"

        let labels = UIStackView(arrangedSubviews: [tagRow, suggestionPrimaryLabel, suggestionSecondaryLabel, choiceButtonsStack])
        labels.axis = .vertical
        labels.spacing = 4
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

    /// Builds one CHOICE option pill button.
    ///
    /// - `option`: the CHOICE option to display.
    /// - `isPrimary`: the first option uses the filled purple style; subsequent
    ///   options use the outlined white-background style.
    private func buildChoiceButton(option: ChoiceOption, isPrimary: Bool) -> UIButton {
        let btn = UIButton(type: .custom)
        btn.contentHorizontalAlignment = .leading
        btn.layer.cornerRadius = 12
        btn.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        btn.titleLabel?.numberOfLines = 0
        btn.titleLabel?.lineBreakMode = .byWordWrapping

        // Title: if translation is present show it on line 1 with the en phrase
        // in quotes on line 2 (matching the mockup); otherwise show en alone.
        let displayTitle: String
        let enPhrase = option.en
        let hasTranslation = !option.translation.isEmpty
        if hasTranslation {
            displayTitle = option.translation + "\n" + "\"" + enPhrase + "\""
        } else {
            displayTitle = enPhrase
        }

        if isPrimary {
            btn.backgroundColor = Theme.purple
            let para = NSMutableParagraphStyle()
            para.lineBreakMode = .byWordWrapping
            let attrTitle = NSMutableAttributedString(
                string: displayTitle,
                attributes: [
                    .font: UIFont.systemFont(ofSize: 14, weight: .semibold),
                    .foregroundColor: UIColor.white,
                    .paragraphStyle: para,
                ]
            )
            // Dim the en-phrase part (second line) slightly when translation shown
            if hasTranslation, let nlRange = displayTitle.range(of: "\n") {
                let secondStart = displayTitle.distance(from: displayTitle.startIndex,
                                                        to: nlRange.upperBound)
                let nsRange = NSRange(location: secondStart,
                                     length: displayTitle.count - secondStart)
                attrTitle.addAttribute(.foregroundColor,
                                       value: UIColor.white.withAlphaComponent(0.8),
                                       range: nsRange)
                attrTitle.addAttribute(.font,
                                       value: UIFont.systemFont(ofSize: 12),
                                       range: nsRange)
            }
            btn.setAttributedTitle(attrTitle, for: .normal)
        } else {
            btn.backgroundColor = .white
            btn.layer.borderWidth = 1
            btn.layer.borderColor = Theme.line.cgColor
            let para = NSMutableParagraphStyle()
            para.lineBreakMode = .byWordWrapping
            let attrTitle = NSMutableAttributedString(
                string: displayTitle,
                attributes: [
                    .font: UIFont.systemFont(ofSize: 14, weight: .semibold),
                    .foregroundColor: Theme.ink,
                    .paragraphStyle: para,
                ]
            )
            if hasTranslation, let nlRange = displayTitle.range(of: "\n") {
                let secondStart = displayTitle.distance(from: displayTitle.startIndex,
                                                        to: nlRange.upperBound)
                let nsRange = NSRange(location: secondStart,
                                     length: displayTitle.count - secondStart)
                attrTitle.addAttribute(.foregroundColor,
                                       value: Theme.sub,
                                       range: nsRange)
                attrTitle.addAttribute(.font,
                                       value: UIFont.systemFont(ofSize: 12),
                                       range: nsRange)
            }
            btn.setAttributedTitle(attrTitle, for: .normal)
        }

        // Store the en phrase so the tap handler can retrieve it regardless of
        // which attributed-title configuration is displayed.
        btn.accessibilityValue = enPhrase
        btn.accessibilityIdentifier = isPrimary ? "button-choice-primary" : "button-choice-secondary"
        btn.addTarget(self, action: #selector(choiceOptionTapped(_:)), for: .touchUpInside)
        return btn
    }

    /// The circular Mute / End / Audio controls per the approved mockup —
    /// round buttons with small captions beneath. The mockup's third slot shows
    /// "Keypad", but DTMF isn't supported in-call; the existing audio-route
    /// control keeps that slot so no functionality is lost.
    private func buildControlsRow() -> UIView {
        configureCircleButton(muteButton, diameter: 56)
        muteButton.addTarget(self, action: #selector(muteButtonTapped), for: .touchUpInside)
        muteButton.accessibilityIdentifier = "button-mute"
        muteCaption.font = .systemFont(ofSize: 12)
        muteCaption.textColor = Theme.sub
        muteCaption.textAlignment = .center
        updateMuteButton()

        let endButton = UIButton(type: .system)
        configureCircleButton(endButton, diameter: 68)
        endButton.setImage(UIImage(systemName: "phone.down.fill"), for: .normal)
        endButton.tintColor = .white
        endButton.backgroundColor = UIColor(
            red: 0xEF / 255.0, green: 0x44 / 255.0, blue: 0x44 / 255.0, alpha: 1)
        endButton.layer.borderWidth = 0
        endButton.addTarget(self, action: #selector(endCallTapped), for: .touchUpInside)
        endButton.accessibilityIdentifier = "button-end-call"

        let endCaption = UILabel()
        endCaption.text = NSLocalizedString("incall.end", comment: "")
        endCaption.font = .systemFont(ofSize: 12)
        endCaption.textColor = Theme.sub
        endCaption.textAlignment = .center

        configureCircleButton(routeButton, diameter: 56)
        routeButton.addTarget(self, action: #selector(routeButtonTapped), for: .touchUpInside)
        routeButton.accessibilityIdentifier = "button-audio-route"
        routeCaption.font = .systemFont(ofSize: 12)
        routeCaption.textColor = Theme.sub
        routeCaption.textAlignment = .center
        routeCaption.adjustsFontSizeToFitWidth = true
        routeCaption.minimumScaleFactor = 0.7
        updateRouteButton()

        let mute = circleControl(button: muteButton, caption: muteCaption)
        let end = circleControl(button: endButton, caption: endCaption)
        let route = circleControl(button: routeButton, caption: routeCaption)

        let row = UIStackView(arrangedSubviews: [mute, end, route])
        row.axis = .horizontal
        row.spacing = 12
        row.distribution = .fillEqually
        row.alignment = .bottom
        row.translatesAutoresizingMaskIntoConstraints = false
        return row
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

    /// A circular control with its caption beneath, centered as one unit.
    private func circleControl(button: UIButton, caption: UILabel) -> UIView {
        let stack = UIStackView(arrangedSubviews: [button, caption])
        stack.axis = .vertical
        stack.spacing = 6
        stack.alignment = .center
        return stack
    }

    /// True when the session's current output route is the built-in speaker.
    private var isSpeakerRouteActive: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs
            .contains { $0.portType == .builtInSpeaker }
    }

    /// Caption + SF Symbol describing the current audio output route, used to
    /// label the route control so it always reflects the live route.
    private func currentRouteDescription() -> (caption: String, icon: String) {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        guard let port = outputs.first else { return (NSLocalizedString("incall.route.audio", comment: ""), "speaker.wave.2") }
        switch port.portType {
        case .builtInSpeaker:
            return (NSLocalizedString("incall.route.speaker", comment: ""), "speaker.wave.2.fill")
        case .builtInReceiver:
            return (NSLocalizedString("incall.route.iphone", comment: ""), "iphone")
        case .headphones, .headsetMic:
            return (NSLocalizedString("incall.route.headphones", comment: ""), "headphones")
        case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .usbAudio:
            return (port.portName, "headphones")
        case .carAudio:
            return (port.portName, "car.fill")
        default:
            return (port.portName, "speaker.wave.2")
        }
    }

    private func updateRouteButton() {
        let route = currentRouteDescription()
        routeButton.setImage(UIImage(systemName: route.icon), for: .normal)
        routeCaption.text = route.caption
        // Active speaker reads as "selected": green surface + green icon.
        routeButton.backgroundColor = isSpeakerRouteActive ? Theme.greenBg : Theme.fill
        routeButton.tintColor = isSpeakerRouteActive ? Theme.greenDark : Theme.ink
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
        let sheet = UIAlertController(title: NSLocalizedString("incall.route.title", comment: ""), message: nil,
                                      preferredStyle: .actionSheet)

        sheet.addAction(routeAction(title: NSLocalizedString("incall.route.iphone", comment: ""),
                                    selected: currentType == .builtInReceiver) { [weak self] in
            self?.routeToBuiltInReceiver()
        })
        sheet.addAction(routeAction(title: NSLocalizedString("incall.route.speaker", comment: ""),
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

        sheet.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))

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
        let action = UIAlertAction(title: selected ? String(format: NSLocalizedString("incall.route.selected", comment: ""), title) : title,
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
        muteButton.setImage(
            UIImage(systemName: muted ? "mic.slash.fill" : "mic.fill"), for: .normal)
        muteCaption.text = muted ? NSLocalizedString("incall.muted", comment: "") : NSLocalizedString("incall.mute", comment: "")
        muteButton.backgroundColor = muted
            ? UIColor.systemRed.withAlphaComponent(0.15)
            : Theme.fill
        muteButton.tintColor = muted ? .systemRed : Theme.ink
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
        // The goal shows up as a compact event in the conversation feed (via the
        // server's goal_set echo) — never as a persistent banner/status line.
        goalField.resignFirstResponder()
    }

    @objc private func retryTapped() {
        // When signed out, "Reconnect" instead routes the user to the login
        // screen — reconnecting without a token would just fail again and strand
        // them on the same sign-in message. Once they sign in we re-arm the stream.
        if needsSignIn {
            presentSignIn()
            return
        }
        retryButton.isHidden = true
        statusLabel.text = NSLocalizedString("incall.status.reconnecting", comment: "")
        stream.retry()
    }

    /// Presents the login screen over the in-call assistant so the user can sign
    /// back in without leaving the call. On success we re-arm the live stream so
    /// the assistant feed comes back; on cancel we leave the sign-in prompt in
    /// place so they can try again.
    private func presentSignIn() {
        let login = LoginViewController()
        login.onLoggedIn = { [weak self] in
            self?.dismiss(animated: true) {
                self?.resumeAfterSignIn()
            }
        }
        let nav = UINavigationController(rootViewController: login)
        login.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(dismissSignIn))
        present(nav, animated: true)
    }

    @objc private func dismissSignIn() {
        dismiss(animated: true)
    }

    /// Re-establishes the live assistant stream after the user signs back in from
    /// the in-call screen, returning the retry button to its normal "Reconnect"
    /// role.
    private func resumeAfterSignIn() {
        needsSignIn = false
        retryButton.setTitle(NSLocalizedString("incall.reconnect", comment: ""), for: .normal)
        retryButton.isHidden = true
        statusLabel.text = NSLocalizedString("incall.status.reconnecting", comment: "")
        reconnectSpinner.startAnimating()
        stream.retry()
    }

    @objc private func askTapped() {
        let question = questionField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !question.isEmpty else { return }
        let goal = goalField.text?.trimmingCharacters(in: .whitespacesAndNewlines)
        stream.askAI(question, goal: goal)
        appendCard(title: NSLocalizedString("incall.card.asked", comment: ""), titleColor: Theme.purple,
                   primary: question, secondary: nil,
                   background: Theme.purpleBg,
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

        // Always create the translation label so it can be filled in later when
        // an interim transcript is finalized; hidden until it has content.
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
                                 background: Theme.fill,
                                 testIdSuffix: testIdSuffix)
            new.setInterim(!isFinal)
            card = new
        }
        if isFinal {
            card = nil
        }
    }

    /// Show or replace the pinned suggestion banner with the latest suggestion.
    /// When `options` contains ≥ 2 entries the banner renders CHOICE pill
    /// buttons instead of plain text; the primary label is hidden in that mode.
    private func showSuggestion(en: String, translation: String?, options: [ChoiceOption]?) {
        // CHOICE path: hide the plain-text label and show tappable pill buttons.
        if let options = options, options.count >= 2 {
            suggestionPrimaryLabel.isHidden = true
            suggestionSecondaryLabel.isHidden = true

            // Remove any buttons from the previous CHOICE hint.
            choiceButtonsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for (index, option) in options.enumerated() {
                let btn = buildChoiceButton(option: option, isPrimary: index == 0)
                choiceButtonsStack.addArrangedSubview(btn)
            }
            choiceButtonsStack.isHidden = false
        } else {
            // Plain-text path: show the primary (and optional secondary) label.
            suggestionPrimaryLabel.text = en
            suggestionPrimaryLabel.isHidden = false
            if let translation = translation, !translation.isEmpty {
                suggestionSecondaryLabel.text = translation
                suggestionSecondaryLabel.isHidden = false
            } else {
                suggestionSecondaryLabel.isHidden = true
            }
            // Remove any stale CHOICE buttons left from the previous hint.
            choiceButtonsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            choiceButtonsStack.isHidden = true
        }
        suggestionBanner.isHidden = false
    }

    /// Copies the tapped CHOICE option's English phrase into the question field
    /// so the user can review it and say it aloud (or edit before sending).
    ///
    /// Deliberately does NOT auto-send via Ask AI: CHOICE alternatives are
    /// candidate spoken replies, not assistant queries — routing them through
    /// `ask_ai` would trigger goal-update detection and generate an unrelated
    /// assistant response. Populating the field lets the user act on it in the
    /// same way they would after typing any other phrase.
    @objc private func choiceOptionTapped(_ sender: UIButton) {
        guard let phrase = sender.accessibilityValue, !phrase.isEmpty else { return }
        questionField.text = phrase
        questionField.becomeFirstResponder()
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
                             title: NSLocalizedString("incall.card.caller", comment: ""), titleColor: Theme.greenDark,
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
                             title: NSLocalizedString("incall.card.you", comment: ""), titleColor: Theme.sub,
                             primary: text, secondary: nil,
                             testIdSuffix: "owner", isFinal: isFinal)
        case .suggestion(let en, let translation, let options):
            showSuggestion(en: en, translation: translation, options: options)
        case .fastPhrase(let text, let translation):
            appendCard(title: NSLocalizedString("incall.card.quick_phrase", comment: ""), titleColor: Theme.purple,
                       primary: text, secondary: translation,
                       background: Theme.purpleBg,
                       testIdSuffix: "fast-phrase")
        case .aiResponse(let text, let isError):
            appendCard(title: isError ? NSLocalizedString("common.error", comment: "") : NSLocalizedString("incall.card.assistant", comment: ""),
                       titleColor: isError ? .systemRed : Theme.purple,
                       primary: text, secondary: nil,
                       background: isError
                        ? UIColor.systemRed.withAlphaComponent(0.10)
                        : Theme.purpleBg,
                       testIdSuffix: "ai-response")
        case .goalSet(let text):
            // Compact one-time feed event; scrolls away with history. Skip the
            // duplicate echo the server sends after a mid-call reconnect.
            guard text != lastGoalShownInFeed else { return }
            lastGoalShownInFeed = text
            appendCard(title: NSLocalizedString("incall.card.goal", comment: ""), titleColor: Theme.greenDark,
                       primary: text, secondary: nil,
                       background: Theme.greenBg,
                       testIdSuffix: "goal")
        case .goalUpdated(let text):
            guard text != lastGoalShownInFeed else { return }
            lastGoalShownInFeed = text
            // Keep local state in sync so reconnects and Ask-AI requests carry
            // the new goal, and the goal field reflects what Brain now targets.
            SessionStore.shared.callGoal = text
            goalField.text = text
            appendCard(title: NSLocalizedString("incall.card.goal_updated", comment: ""), titleColor: Theme.greenDark,
                       primary: text, secondary: nil,
                       background: Theme.greenBg,
                       testIdSuffix: "goal-updated")
        case .prepareReply, .prepareOpening, .prepareError:
            // PREPARE-stage events belong to PrepareViewController; the in-call
            // screen never shows them (the prepare session ends with the call
            // starting), so they are deliberately ignored here.
            break
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
        needsSignIn = false
        retryButton.setTitle(NSLocalizedString("incall.reconnect", comment: ""), for: .normal)
        statusLabel.text = NSLocalizedString("incall.status.connected", comment: "")
        reconnectSpinner.stopAnimating()
        retryButton.isHidden = true
    }

    func callHintStream(_ stream: CallHintStream,
                        didDisconnectWillRetryAttempt attempt: Int,
                        of maxAttempts: Int) {
        // A live network retry, not a sign-in failure — restore the plain
        // "Reconnect" affordance in case we were previously in the signed-out state.
        needsSignIn = false
        retryButton.setTitle(NSLocalizedString("incall.reconnect", comment: ""), for: .normal)
        // Show progress (attempt N of M) with a live spinner so the feed reads as
        // actively recovering, not frozen, until the terminal state is reached.
        statusLabel.text = CallHintStream.reconnectingStatusText(attempt: attempt, of: maxAttempts)
        reconnectSpinner.startAnimating()
        retryButton.isHidden = true
    }

    func callHintStreamDidFailTerminally(_ stream: CallHintStream) {
        // A network/server give-up (not a missing token) — the button reconnects.
        needsSignIn = false
        retryButton.setTitle(NSLocalizedString("incall.reconnect", comment: ""), for: .normal)
        statusLabel.text = NSLocalizedString("incall.status.unavailable", comment: "")
        reconnectSpinner.stopAnimating()
        retryButton.isHidden = false
    }

    func callHintStreamDidRequireSignIn(_ stream: CallHintStream) {
        // The stream stopped because there's no valid session token (signed out).
        // Show an actionable message and turn the retry button into a "Sign in"
        // action that routes to the login screen, so the user can actually recover
        // the live assistant instead of re-hitting the same sign-in message.
        needsSignIn = true
        statusLabel.text = NSLocalizedString("incall.status.sign_in", comment: "")
        reconnectSpinner.stopAnimating()
        retryButton.setTitle(NSLocalizedString("incall.sign_in", comment: ""), for: .normal)
        retryButton.isHidden = false
    }
}

// MARK: - UIGestureRecognizerDelegate

extension InCallViewController: UIGestureRecognizerDelegate {
    /// The background tap-to-dismiss recognizer must ignore touches that land on
    /// interactive controls (text fields, buttons): with the recognizer attached
    /// to the root view, a tap INTO a text field would otherwise focus the field
    /// and then instantly resign it via `dismissKeyboard`, making text entry
    /// impossible.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldReceive touch: UITouch) -> Bool {
        var v: UIView? = touch.view
        while let current = v {
            if current is UIControl { return false }
            v = current.superview
        }
        return true
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
