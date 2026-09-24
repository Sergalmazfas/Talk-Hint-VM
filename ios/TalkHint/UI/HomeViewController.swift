import UIKit

/// "Calls" tab — the landing screen after login, redesigned per the approved
/// canvas mockups: big "Calls" title with a settings gear, a number field with
/// an AI-prepare entry point (and a compact "Goal ready ✓" badge once a goal is
/// confirmed), an in-app keypad, a green Call pill, and the two most recent
/// calls with one-tap redial. Prepare opens as a bottom sheet over this screen.
final class HomeViewController: UIViewController {

    // MARK: - State

    /// The number being dialed, kept in E.164-friendly raw form ("+1800…").
    private var dialed = "" { didSet { renderNumber() } }
    private var recents: [APIClient.CallRecord] = []
    private let callMode: CallManager.CallMode
    private var outgoingCallUUID: UUID?

    init(mode: CallManager.CallMode = .hint) {
        callMode = mode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: - UI

    private let numberLabel = UILabel()
    private let placeholderLabel = UILabel()
    private let goalBadge = UIButton(type: .system)
    private let prepareButton = UIButton(type: .system)
    private let deleteButton = UIButton(type: .system)
    private let recentsStack = UIStackView()
    private let recentsHeader = UIStackView()
    private let callButton = UIButton(type: .system)
    private let copilotLanguageButton = UIButton(type: .system)

    private static let copilotLanguages: [(code: String, key: String)] = [
        ("ru", "copilot.language.ru"),
        ("es", "copilot.language.es"),
        ("uk", "copilot.language.uk"),
        ("kk", "copilot.language.kk"),
    ]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationController?.setNavigationBarHidden(true, animated: false)
        buildUI()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(outgoingCallStateChanged(_:)),
            name: CallManager.outgoingCallStateDidChange,
            object: CallManager.shared)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
        if callMode == .hint { renderGoalState() }
        loadRecents()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Pushed screens (Settings) use the standard navigation bar.
        navigationController?.setNavigationBarHidden(false, animated: animated)
    }

    // MARK: - Layout

    private func buildUI() {
        // Header: "Calls" + gear.
        let titleLabel = UILabel()
        titleLabel.text = NSLocalizedString(callMode == .hint ? "home.title" :
                                            (callMode == .copilot ? "copilot.title" : "translator.title"), comment: "")
        titleLabel.font = .systemFont(ofSize: 32, weight: .bold)
        titleLabel.textColor = .label

        let gear = UIButton(type: .system)
        gear.setImage(UIImage(systemName: "gearshape"), for: .normal)
        gear.tintColor = Theme.sub
        gear.accessibilityIdentifier = "button-open-settings"
        gear.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)

        // Always-visible Prepare entry in the header (centered pill): the
        // in-field sparkle can get replaced/squeezed while dialing, so this is
        // the stable way into call preparation.
        var prepConfig = UIButton.Configuration.filled()
        prepConfig.image = UIImage(systemName: "sparkles")
        prepConfig.imagePadding = 6
        prepConfig.baseBackgroundColor = Theme.purple.withAlphaComponent(0.12)
        prepConfig.baseForegroundColor = Theme.purple
        prepConfig.cornerStyle = .capsule
        prepConfig.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
        prepConfig.attributedTitle = AttributedString(
            NSLocalizedString("home.prepare", comment: ""),
            attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 14, weight: .semibold)]))
        let headerPrepare = UIButton(configuration: prepConfig)
        headerPrepare.accessibilityIdentifier = "button-prepare-call-header"
        headerPrepare.addTarget(self, action: #selector(prepareTapped), for: .touchUpInside)
        headerPrepare.setContentHuggingPriority(.required, for: .horizontal)
        headerPrepare.setContentCompressionResistancePriority(.required, for: .horizontal)

        let spacerL = UIView()
        let spacerR = UIView()
        let header = UIStackView(arrangedSubviews: [titleLabel, spacerL, headerPrepare, spacerR, gear])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 8
        // Equal-width spacers keep the pill visually centered between the
        // title and the gear (a plain .fill stack splits them arbitrarily).
        spacerL.widthAnchor.constraint(equalTo: spacerR.widthAnchor).isActive = true
        headerPrepare.isHidden = callMode != .hint

        // Number field card.
        let fieldCard = UIView()
        fieldCard.layer.cornerRadius = 16
        fieldCard.layer.borderWidth = 1
        fieldCard.layer.borderColor = Theme.line.cgColor
        fieldCard.backgroundColor = .systemBackground

        let phoneIcon = UIImageView(image: UIImage(systemName: "phone"))
        phoneIcon.tintColor = Theme.sub
        phoneIcon.contentMode = .scaleAspectFit
        phoneIcon.setContentHuggingPriority(.required, for: .horizontal)

        numberLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        numberLabel.textColor = .label
        numberLabel.adjustsFontSizeToFitWidth = true
        numberLabel.minimumScaleFactor = 0.6
        numberLabel.lineBreakMode = .byTruncatingHead
        // When the number is still too long even after shrinking, cut off the
        // BEGINNING (…) so the digits being typed stay visible at the end.
        numberLabel.accessibilityIdentifier = "input-dial-number"
        let pasteButton = UIButton(type: .system)
        pasteButton.setTitle(NSLocalizedString("home.paste", comment: ""), for: .normal)
        pasteButton.accessibilityIdentifier = "button-paste-number"
        pasteButton.addTarget(self, action: #selector(pasteNumber), for: .touchUpInside)
        pasteButton.setContentCompressionResistancePriority(.required, for: .horizontal)

        placeholderLabel.text = NSLocalizedString("home.enter_number", comment: "")
        placeholderLabel.font = .systemFont(ofSize: 16)
        placeholderLabel.textColor = .tertiaryLabel

        deleteButton.setImage(UIImage(systemName: "delete.left"), for: .normal)
        deleteButton.tintColor = Theme.sub
        deleteButton.isHidden = true
        deleteButton.accessibilityIdentifier = "button-dial-delete"
        deleteButton.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
        deleteButton.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(deleteHeld(_:))))
        deleteButton.setContentHuggingPriority(.required, for: .horizontal)

        // AI prepare entry: purple sparkles before a goal exists…
        prepareButton.setImage(UIImage(systemName: "sparkles"), for: .normal)
        prepareButton.tintColor = Theme.purple
        prepareButton.accessibilityIdentifier = "button-prepare-call"
        prepareButton.addTarget(self, action: #selector(prepareTapped), for: .touchUpInside)
        prepareButton.setContentHuggingPriority(.required, for: .horizontal)

        // …replaced by a compact "Goal ready ✓" badge once confirmed
        // (tapping it re-opens Prepare to review or change the goal).
        goalBadge.setTitle(NSLocalizedString("home.goal_ready", comment: ""), for: .normal)
        goalBadge.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        goalBadge.setTitleColor(Theme.greenDark, for: .normal)
        goalBadge.backgroundColor = Theme.greenBg
        goalBadge.layer.cornerRadius = 12
        goalBadge.contentEdgeInsets = UIEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
        goalBadge.isHidden = true
        goalBadge.accessibilityIdentifier = "badge-goal-ready"
        goalBadge.addTarget(self, action: #selector(prepareTapped), for: .touchUpInside)
        goalBadge.setContentHuggingPriority(.required, for: .horizontal)
        goalBadge.setContentCompressionResistancePriority(.required, for: .horizontal)

        let numberWrap = UIView()
        numberWrap.addSubview(placeholderLabel)
        numberWrap.addSubview(numberLabel)
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        numberLabel.translatesAutoresizingMaskIntoConstraints = false

        let fieldStack = UIStackView(arrangedSubviews: [phoneIcon, numberWrap, pasteButton, deleteButton])
        fieldStack.axis = .horizontal
        fieldStack.alignment = .center
        fieldStack.spacing = 8
        fieldStack.translatesAutoresizingMaskIntoConstraints = false
        fieldCard.addSubview(fieldStack)
        goalBadge.isHidden = callMode != .hint
        prepareButton.isHidden = callMode != .hint

        // Keypad.
        let keypad = buildKeypad()

        copilotLanguageButton.setTitle(copilotLanguageTitle(), for: .normal)
        copilotLanguageButton.setImage(UIImage(systemName: "globe"), for: .normal)
        copilotLanguageButton.tintColor = Theme.green
        copilotLanguageButton.accessibilityIdentifier = "copilot-language-picker"
        copilotLanguageButton.contentHorizontalAlignment = .leading
        copilotLanguageButton.addTarget(self, action: #selector(copilotLanguageTapped), for: .touchUpInside)
        copilotLanguageButton.isHidden = callMode != .copilot

        // Call button.
        var callConfig = UIButton.Configuration.filled()
        callConfig.cornerStyle = .capsule
        callConfig.baseBackgroundColor = Theme.green
        callConfig.baseForegroundColor = .white
        callConfig.image = UIImage(systemName: "phone.fill")
        callConfig.imagePadding = 8
        callConfig.title = NSLocalizedString("home.call", comment: "")
        callConfig.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 32, bottom: 12, trailing: 32)
        callButton.configuration = callConfig
        callButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        callButton.accessibilityIdentifier = "button-start-call"
        callButton.addTarget(self, action: #selector(callTapped), for: .touchUpInside)

        let dismissKeyboardTap = UITapGestureRecognizer(target: self, action: #selector(dismissDialKeyboard))
        dismissKeyboardTap.cancelsTouchesInView = false
        view.addGestureRecognizer(dismissKeyboardTap)

        let callRow = UIStackView(arrangedSubviews: [callButton])
        callRow.axis = .vertical
        callRow.alignment = .center

        // Recents.
        let recentsTitle = UILabel()
        recentsTitle.text = NSLocalizedString("home.recent_calls", comment: "")
        recentsTitle.font = .systemFont(ofSize: 12, weight: .semibold)
        recentsTitle.textColor = Theme.sub

        let seeAll = UIButton(type: .system)
        seeAll.setTitle(NSLocalizedString("home.see_all", comment: ""), for: .normal)
        seeAll.titleLabel?.font = .systemFont(ofSize: 13, weight: .medium)
        seeAll.setTitleColor(Theme.green, for: .normal)
        seeAll.accessibilityIdentifier = "button-see-all-calls"
        seeAll.addTarget(self, action: #selector(seeAllTapped), for: .touchUpInside)

        recentsHeader.axis = .horizontal
        recentsHeader.alignment = .center
        recentsHeader.addArrangedSubview(recentsTitle)
        recentsHeader.addArrangedSubview(UIView())
        recentsHeader.addArrangedSubview(seeAll)
        recentsHeader.isHidden = true

        recentsStack.axis = .vertical
        recentsStack.spacing = 4

        let goalRow = UIStackView(arrangedSubviews: [UIView(), goalBadge])
        goalRow.isHidden = callMode != .hint
        let root = UIStackView(arrangedSubviews: [
            header, fieldCard, goalRow, copilotLanguageButton, keypad, recentsHeader, recentsStack
        ])
        root.axis = .vertical
        root.spacing = 16
        root.setCustomSpacing(20, after: keypad)
        root.setCustomSpacing(8, after: recentsHeader)
        root.translatesAutoresizingMaskIntoConstraints = false

        // Scrollable so the keypad + recents stay reachable on short iPhones.
        let scroll = UIScrollView()
        scroll.alwaysBounceVertical = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(root)
        view.addSubview(scroll)
        view.addSubview(callRow)
        callRow.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: callRow.topAnchor, constant: -12),
            callRow.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            callRow.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            callRow.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            callButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),

            root.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 8),
            root.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            root.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            root.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -8),
            root.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),

            fieldStack.topAnchor.constraint(equalTo: fieldCard.topAnchor, constant: 12),
            fieldStack.bottomAnchor.constraint(equalTo: fieldCard.bottomAnchor, constant: -12),
            fieldStack.leadingAnchor.constraint(equalTo: fieldCard.leadingAnchor, constant: 14),
            fieldStack.trailingAnchor.constraint(equalTo: fieldCard.trailingAnchor, constant: -14),

            phoneIcon.widthAnchor.constraint(equalToConstant: 18),

            numberWrap.heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
            placeholderLabel.leadingAnchor.constraint(equalTo: numberWrap.leadingAnchor),
            placeholderLabel.centerYAnchor.constraint(equalTo: numberWrap.centerYAnchor),
            numberLabel.leadingAnchor.constraint(equalTo: numberWrap.leadingAnchor),
            numberLabel.trailingAnchor.constraint(equalTo: numberWrap.trailingAnchor),
            numberLabel.centerYAnchor.constraint(equalTo: numberWrap.centerYAnchor),
        ])
    }

    private func buildKeypad() -> UIView {
        let keys: [(String, String)] = [
            ("1", ""), ("2", "ABC"), ("3", "DEF"),
            ("4", "GHI"), ("5", "JKL"), ("6", "MNO"),
            ("7", "PQRS"), ("8", "TUV"), ("9", "WXYZ"),
            ("*", ""), ("0", "+"), ("#", ""),
        ]
        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 10
        grid.distribution = .fillEqually

        for rowIndex in 0..<4 {
            let row = UIStackView()
            row.axis = .horizontal
            row.distribution = .equalCentering
            for col in 0..<3 {
                let (digit, letters) = keys[rowIndex * 3 + col]
                row.addArrangedSubview(makeKey(digit: digit, letters: letters))
            }
            // equalCentering needs edge anchors; wrap with padding.
            row.isLayoutMarginsRelativeArrangement = true
            row.layoutMargins = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
            grid.addArrangedSubview(row)
        }
        return grid
    }

    private func makeKey(digit: String, letters: String) -> UIButton {
        let key = UIButton(type: .system)
        key.backgroundColor = Theme.fill
        key.layer.cornerRadius = 32
        key.widthAnchor.constraint(equalToConstant: 64).isActive = true
        key.heightAnchor.constraint(equalToConstant: 64).isActive = true
        key.accessibilityIdentifier = "key-\(digit == "*" ? "star" : digit == "#" ? "hash" : digit)"

        let digitLabel = UILabel()
        digitLabel.text = digit
        digitLabel.font = .systemFont(ofSize: 26, weight: .medium)
        digitLabel.textColor = Theme.ink
        digitLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [digitLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false

        if !letters.isEmpty {
            let lettersLabel = UILabel()
            lettersLabel.text = letters
            lettersLabel.font = .systemFont(ofSize: 9, weight: .medium)
            lettersLabel.textColor = Theme.sub
            stack.addArrangedSubview(lettersLabel)
        }
        key.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: key.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: key.centerYAnchor),
        ])

        key.addAction(UIAction { [weak self] _ in
            guard let self = self else { return }
            if digit == "0", self.suppressNextZero {
                self.suppressNextZero = false
                return
            }
            self.append(digit)
        }, for: .touchUpInside)
        if digit == "0" {
            // Long-press "0" enters "+" (standard dialer behavior, needed for E.164).
            let hold = UILongPressGestureRecognizer(target: self, action: #selector(zeroHeld(_:)))
            key.addGestureRecognizer(hold)
        }
        return key
    }

    // MARK: - Dialing

    private func append(_ digit: String) {
        guard dialed.count < 17 else { return }
        UIDevice.current.playInputClick()
        dialed += digit
    }

    /// Keeps hardware-keyboard and pasted input in the same E.164-friendly
    /// representation used by the on-screen keypad.
    static func normalizedDialInput(_ value: String) -> String {
        var result = ""
        for character in value {
            if character.isNumber {
                result.append(character)
            } else if character == "+", result.isEmpty {
                result.append(character)
            }
            if result.count == 17 { break }
        }
        return result
    }

    @objc private func pasteNumber() {
        // Read the clipboard only after the user's explicit Paste action.
        guard let text = UIPasteboard.general.string else { return }
        let number = Self.normalizedDialInput(text)
        guard !number.isEmpty else { return }
        dialed = number
    }

    /// Set when a long-press on "0" was recognized, so the button's normal
    /// touch-up doesn't ALSO append a "0" on finger release.
    private var suppressNextZero = false

    @objc private func zeroHeld(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        // "+" is only valid as the leading character of an E.164 number.
        // Suppress the companion touchUpInside only when we actually inserted "+";
        // otherwise a long-press mid-number would silently eat the "0" keystroke.
        if dialed.isEmpty {
            suppressNextZero = true
            dialed = "+"
        }
    }

    @objc private func deleteTapped() {
        guard !dialed.isEmpty else { return }
        dialed = String(dialed.dropLast())
    }

    @objc private func deleteHeld(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        dialed = ""
    }

    private func renderNumber() {
        numberLabel.text = formatForDisplay(dialed)
        placeholderLabel.isHidden = !dialed.isEmpty
        deleteButton.isHidden = dialed.isEmpty
    }

    /// Light display formatting for US-style numbers ("+1 (800) 683-7392");
    /// everything else is shown as typed.
    private func formatForDisplay(_ raw: String) -> String {
        guard raw.hasPrefix("+1"), raw.count > 2 else { return raw }
        let digits = String(raw.dropFirst(2))
        guard digits.allSatisfy(\.isNumber) else { return raw }
        var result = "+1"
        let area = digits.prefix(3)
        let mid = digits.dropFirst(3).prefix(3)
        let tail = digits.dropFirst(6).prefix(4)
        if !area.isEmpty { result += " (\(area)" + (area.count == 3 ? ")" : "") }
        if !mid.isEmpty { result += " \(mid)" }
        if !tail.isEmpty { result += "-\(tail)" }
        return result
    }

    // MARK: - Goal badge

    private func renderGoalState() {
        let hasGoal = !SessionStore.shared.callGoal
            .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        goalBadge.isHidden = !hasGoal
        prepareButton.isHidden = hasGoal
    }

    // MARK: - Recents

    private func loadRecents() {
        Task { @MainActor in
            guard let calls = try? await APIClient.shared.calls() else { return }
            recents = Array(calls.prefix(2))
            renderRecents()
        }
    }

    private func renderRecents() {
        recentsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        recentsHeader.isHidden = recents.isEmpty
        for call in recents {
            recentsStack.addArrangedSubview(makeRecentRow(call))
        }
    }

    /// The other party's number for this call, from the current user's side.
    /// Same convention as History: `direction` is "outgoing"/"incoming".
    private func isOutgoing(_ call: APIClient.CallRecord) -> Bool {
        call.direction?.lowercased() == "outgoing"
    }

    private func otherParty(of call: APIClient.CallRecord) -> String {
        let party = isOutgoing(call) ? call.toNumber : call.fromNumber
        return party.isEmpty ? (isOutgoing(call) ? call.fromNumber : call.toNumber) : party
    }

    private func makeRecentRow(_ call: APIClient.CallRecord) -> UIView {
        let number = otherParty(of: call)
        let name = call.contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let avatar = UILabel()
        avatar.text = String((name.isEmpty ? "#" : name).prefix(1)).uppercased()
        avatar.font = .systemFont(ofSize: 15, weight: .bold)
        avatar.textColor = .white
        avatar.textAlignment = .center
        avatar.backgroundColor = Theme.green
        avatar.layer.cornerRadius = 18
        avatar.layer.masksToBounds = true
        avatar.translatesAutoresizingMaskIntoConstraints = false
        avatar.widthAnchor.constraint(equalToConstant: 36).isActive = true
        avatar.heightAnchor.constraint(equalToConstant: 36).isActive = true

        let numberLabel = UILabel()
        numberLabel.text = formatForDisplay(number)
        numberLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        numberLabel.textColor = Theme.ink

        let nameLabel = UILabel()
        nameLabel.text = name.isEmpty ? (isOutgoing(call) ? NSLocalizedString("home.outgoing", comment: "") : NSLocalizedString("home.incoming", comment: "")) : name
        nameLabel.font = .systemFont(ofSize: 12)
        nameLabel.textColor = Theme.sub

        let textStack = UIStackView(arrangedSubviews: [numberLabel, nameLabel])
        textStack.axis = .vertical
        textStack.spacing = 1

        let whenLabel = UILabel()
        whenLabel.text = call.startedAt.map { Self.recentDateFormatter.localizedString(for: $0, relativeTo: Date()) } ?? ""
        whenLabel.font = .systemFont(ofSize: 12)
        whenLabel.textColor = Theme.sub
        whenLabel.setContentHuggingPriority(.required, for: .horizontal)

        let redial = UIButton(type: .system)
        redial.setImage(UIImage(systemName: "phone.fill"), for: .normal)
        redial.tintColor = Theme.green
        redial.backgroundColor = Theme.greenBg
        redial.layer.cornerRadius = 16
        redial.translatesAutoresizingMaskIntoConstraints = false
        redial.widthAnchor.constraint(equalToConstant: 32).isActive = true
        redial.heightAnchor.constraint(equalToConstant: 32).isActive = true
        redial.accessibilityIdentifier = "button-redial"
        redial.addAction(UIAction { [weak self] _ in self?.startCall(to: number) }, for: .touchUpInside)

        let row = UIStackView(arrangedSubviews: [avatar, textStack, UIView(), whenLabel, redial])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 10
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)

        let tap = UITapGestureRecognizer(target: self, action: #selector(recentRowTapped(_:)))
        row.addGestureRecognizer(tap)
        row.tag = recentsStack.arrangedSubviews.count
        return row
    }

    @objc private func recentRowTapped(_ g: UITapGestureRecognizer) {
        guard let tag = g.view?.tag, recents.indices.contains(tag) else { return }
        // Tapping the row fills the field; the green button redials directly.
        dialed = otherParty(of: recents[tag])
    }

    private static let recentDateFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    // MARK: - Actions

    @objc private func settingsTapped() {
        navigationController?.pushViewController(SettingsViewController(), animated: true)
    }

    private func copilotLanguageTitle() -> String {
        let code = SessionStore.shared.copilotLanguage
        let name = Self.copilotLanguages.first(where: { $0.code == code })
            .map { NSLocalizedString($0.key, comment: "") } ?? NSLocalizedString("copilot.language.ru", comment: "")
        return NSLocalizedString("copilot.language.selected", comment: "").replacingOccurrences(of: "%@", with: name)
    }

    @objc private func copilotLanguageTapped() {
        guard callMode == .copilot else { return }
        let sheet = UIAlertController(
            title: NSLocalizedString("copilot.language.title", comment: ""),
            message: nil,
            preferredStyle: .actionSheet)
        for option in Self.copilotLanguages {
            let title = NSLocalizedString(option.key, comment: "")
            let action = UIAlertAction(title: title, style: .default) { [weak self] _ in
                SessionStore.shared.copilotLanguage = option.code
                self?.copilotLanguageButton.setTitle(self?.copilotLanguageTitle(), for: .normal)
            }
            sheet.addAction(action)
        }
        sheet.addAction(UIAlertAction(
            title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = copilotLanguageButton
            popover.sourceRect = copilotLanguageButton.bounds
        }
        present(sheet, animated: true)
    }

    @objc private func prepareTapped() {
        let prepare = PrepareViewController()
        prepare.onGoalConfirmed = { [weak self] in
            self?.renderGoalState()
        }
        let nav = UINavigationController(rootViewController: prepare)
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.largestUndimmedDetentIdentifier = nil
        }
        present(nav, animated: true)
    }

    @objc private func seeAllTapped() {
        tabBarController?.selectedIndex = 3 // History
    }

    @objc private func callTapped() {
        dismissDialKeyboard()
        guard outgoingCallUUID == nil else { return }
        startCall(to: dialed)
    }

    @objc private func dismissDialKeyboard() {
        view.endEditing(true)
    }

    @objc private func outgoingCallStateChanged(_ notification: Notification) {
        guard
            let uuid = notification.userInfo?["uuid"] as? UUID,
            uuid == outgoingCallUUID,
            let rawState = notification.userInfo?["state"] as? String,
            let state = CallManager.OutgoingCallState(rawValue: rawState)
        else { return }

        switch state {
        case .connecting:
            renderCallButtonConnecting()
        case .connected:
            break // The in-call screen immediately takes over.
        case .failed, .ended:
            outgoingCallUUID = nil
            renderCallButtonIdle()
            if state == .failed, presentedViewController == nil {
                let alert = UIAlertController(
                    title: NSLocalizedString("home.call_failed.title", comment: ""),
                    message: NSLocalizedString("home.call_failed.message", comment: ""),
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                present(alert, animated: true)
            }
        }
    }

    private func renderCallButtonConnecting() {
        callButton.isEnabled = false
        callButton.configuration?.showsActivityIndicator = true
        callButton.configuration?.image = nil
        callButton.configuration?.title = NSLocalizedString("home.connecting", comment: "")
        callButton.accessibilityIdentifier = "button-start-call-connecting"
    }

    private func renderCallButtonIdle() {
        callButton.isEnabled = true
        callButton.configuration?.showsActivityIndicator = false
        callButton.configuration?.image = UIImage(systemName: "phone.fill")
        callButton.configuration?.title = NSLocalizedString("home.call", comment: "")
        callButton.accessibilityIdentifier = "button-start-call"
    }

    private func startCall(to raw: String) {
        guard outgoingCallUUID == nil else { return }
        dismissDialKeyboard()
        let cleaned = raw.components(separatedBy: CharacterSet(charactersIn: " -()")).joined()
        // The backend only routes outbound dials to E.164 numbers (leading "+").
        guard cleaned.range(of: "^\\+[1-9]\\d{6,14}$", options: .regularExpression) != nil else {
            let alert = UIAlertController(
                title: NSLocalizedString("home.invalid_number.title", comment: ""),
                message: NSLocalizedString("home.invalid_number.message", comment: ""),
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
            present(alert, animated: true)
            return
        }
        renderCallButtonConnecting()
        outgoingCallUUID = CallManager.shared.startOutgoingCall(to: cleaned, mode: callMode)
    }
}

extension HomeViewController: UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}
