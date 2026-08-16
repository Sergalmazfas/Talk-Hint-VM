import UIKit

/// "Settings" tab — lets the user choose how incoming calls are handled, set or
/// clear a forwarding number, and pick the language used for live hint
/// translations.
///
/// Persistence:
///   - Call mode  -> `POST /api/user/call-mode` (mirrored locally for display,
///                   since the backend exposes no GET for it).
///   - Forwarding -> `GET` / `POST /api/settings/forwarding`.
///   - Hint language is stored locally (`SessionStore`) and sent to the live
///     assistant over the `/ui` socket on each call; the backend has no
///     language-update route, so it cannot be persisted server-side.
final class SettingsViewController: UITableViewController {

    private enum Section: Int, CaseIterable {
        case callMode
        case features
        case forwarding
        case language
        case more
    }

    /// Screens that lost their tab in the three-tab redesign (Calls / Tutor /
    /// History) and are now reachable from Settings.
    private enum MoreRow: Int, CaseIterable {
        case numbers
        case assistant
        case account
    }

    private enum FeatureRow: Int, CaseIterable {
        case liveHints
        case translation
    }

    private enum ForwardingRow: Int, CaseIterable {
        case field
        case save
        case clear
    }

    private let callModes: [(id: String, title: String, subtitle: String)] = [
        ("live", "Live assistant", "AI listens and shows hints during the call"),
        ("forwarding", "Forward calls", "Send callers to your forwarding number"),
        ("training", "Training", "Practice calls with a simulated caller"),
    ]

    private let forwardingField = UITextField()

    // Per-user live-call toggles, mirrored locally for instant display. Default ON
    // to match the backend; refreshed from the server on appear.
    private var liveHintsEnabled = true
    private var translationEnabled = true

    init() {
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Settings"
        tableView.keyboardDismissMode = .interactive
        tableView.accessibilityIdentifier = "table-settings"
        configureForwardingField()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loadForwarding()
        loadFeatureSettings()
    }

    private func loadFeatureSettings() {
        Task { @MainActor in
            if let settings = try? await APIClient.shared.callFeatureSettings() {
                liveHintsEnabled = settings.liveHintsEnabled
                translationEnabled = settings.translationEnabled
                tableView.reloadSections(IndexSet(integer: Section.features.rawValue), with: .none)
            }
        }
    }

    private func configureForwardingField() {
        forwardingField.placeholder = "+1 555 123 4567"
        forwardingField.keyboardType = .phonePad
        forwardingField.font = .preferredFont(forTextStyle: .body)
        forwardingField.clearButtonMode = .whileEditing
        forwardingField.translatesAutoresizingMaskIntoConstraints = false
        forwardingField.accessibilityIdentifier = "input-forwarding-number"
    }

    private func loadForwarding() {
        Task { @MainActor in
            if let phone = try? await APIClient.shared.forwardingPhone() {
                forwardingField.text = phone
            }
        }
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .callMode: return callModes.count
        case .features: return FeatureRow.allCases.count
        case .forwarding: return ForwardingRow.allCases.count
        case .language: return SessionStore.availableLanguages.count
        case .more: return MoreRow.allCases.count
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .callMode: return "Call handling"
        case .features: return "Live call assistant"
        case .forwarding: return "Call forwarding"
        case .language: return "Hint language"
        case .more: return "More"
        }
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .callMode:
            return "Choose what happens when someone calls your TalkHint number."
        case .features:
            return "Live Hints shows AI reply suggestions during a call. Translation translates the live conversation and hints into your hint language. Transcription, saved transcripts, and call summaries always stay on."
        case .forwarding:
            return "Callers are sent here when call handling is set to Forward calls. Also used for SMS call alerts."
        case .language:
            return "Language used for translations and hints during live calls."
        case .more:
            return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        switch Section(rawValue: indexPath.section)! {
        case .callMode:
            let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
            let mode = callModes[indexPath.row]
            cell.textLabel?.text = mode.title
            cell.detailTextLabel?.text = mode.subtitle
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.detailTextLabel?.numberOfLines = 0
            cell.accessoryType = (SessionStore.shared.callMode == mode.id) ? .checkmark : .none
            cell.accessibilityIdentifier = "cell-callmode-\(mode.id)"
            return cell

        case .features:
            switch FeatureRow(rawValue: indexPath.row)! {
            case .liveHints:
                return featureCell(title: "Enable Live Hints",
                                   isOn: liveHintsEnabled,
                                   identifier: "switch-live-hints",
                                   action: #selector(liveHintsChanged(_:)))
            case .translation:
                return featureCell(title: "Enable Translation",
                                   isOn: translationEnabled,
                                   identifier: "switch-translation",
                                   action: #selector(translationChanged(_:)))
            }

        case .forwarding:
            switch ForwardingRow(rawValue: indexPath.row)! {
            case .field:
                let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
                cell.selectionStyle = .none
                cell.contentView.addSubview(forwardingField)
                NSLayoutConstraint.activate([
                    forwardingField.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
                    forwardingField.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                    forwardingField.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 8),
                    forwardingField.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -8),
                ])
                return cell
            case .save:
                let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
                cell.textLabel?.text = "Save forwarding number"
                cell.textLabel?.textColor = view.tintColor
                cell.accessibilityIdentifier = "button-save-forwarding"
                return cell
            case .clear:
                let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
                cell.textLabel?.text = "Clear forwarding number"
                cell.textLabel?.textColor = .systemRed
                cell.accessibilityIdentifier = "button-clear-forwarding"
                return cell
            }

        case .language:
            let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
            let lang = SessionStore.availableLanguages[indexPath.row]
            cell.textLabel?.text = lang.name
            cell.accessoryType = (SessionStore.shared.language == lang.code) ? .checkmark : .none
            cell.accessibilityIdentifier = "cell-language-\(lang.code)"
            return cell

        case .more:
            let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
            cell.accessoryType = .disclosureIndicator
            switch MoreRow(rawValue: indexPath.row)! {
            case .numbers:
                cell.textLabel?.text = "Phone numbers"
                cell.imageView?.image = UIImage(systemName: "number")
                cell.accessibilityIdentifier = "cell-more-numbers"
            case .assistant:
                cell.textLabel?.text = "Assistant tools"
                cell.imageView?.image = UIImage(systemName: "wand.and.stars")
                cell.accessibilityIdentifier = "cell-more-assistant"
            case .account:
                cell.textLabel?.text = "Account"
                cell.imageView?.image = UIImage(systemName: "person.crop.circle")
                cell.accessibilityIdentifier = "cell-more-account"
            }
            return cell
        }
    }

    // MARK: - Selection

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch Section(rawValue: indexPath.section)! {
        case .callMode:
            selectCallMode(callModes[indexPath.row].id)
        case .features:
            break // handled by the UISwitch valueChanged action
        case .forwarding:
            switch ForwardingRow(rawValue: indexPath.row)! {
            case .field: break
            case .save: saveForwarding()
            case .clear: clearForwarding()
            }
        case .language:
            let code = SessionStore.availableLanguages[indexPath.row].code
            SessionStore.shared.language = code
            tableView.reloadSections(IndexSet(integer: Section.language.rawValue), with: .none)
        case .more:
            switch MoreRow(rawValue: indexPath.row)! {
            case .numbers:
                navigationController?.pushViewController(NumbersViewController(), animated: true)
            case .assistant:
                navigationController?.pushViewController(AssistantViewController(), animated: true)
            case .account:
                let account = AccountViewController()
                account.onLoggedOut = {
                    let scene = UIApplication.shared.connectedScenes.first
                    (scene?.delegate as? SceneDelegate)?.showRoot(loggedIn: false)
                }
                navigationController?.pushViewController(account, animated: true)
            }
        }
    }

    private func selectCallMode(_ mode: String) {
        let previous = SessionStore.shared.callMode
        guard mode != previous else { return }

        SessionStore.shared.callMode = mode
        tableView.reloadSections(IndexSet(integer: Section.callMode.rawValue), with: .none)

        Task { @MainActor in
            do {
                try await APIClient.shared.setCallMode(mode)
            } catch {
                SessionStore.shared.callMode = previous
                tableView.reloadSections(IndexSet(integer: Section.callMode.rawValue), with: .none)
                showAlert(title: "Could not change call handling", message: error.localizedDescription)
            }
        }
    }

    // MARK: - Feature toggles

    private func featureCell(title: String, isOn: Bool, identifier: String, action: Selector) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.selectionStyle = .none
        cell.textLabel?.text = title
        let toggle = UISwitch()
        toggle.isOn = isOn
        toggle.accessibilityIdentifier = identifier
        toggle.addTarget(self, action: action, for: .valueChanged)
        cell.accessoryView = toggle
        return cell
    }

    @objc private func liveHintsChanged(_ sender: UISwitch) {
        updateFeature(liveHints: sender.isOn, sender: sender, previous: liveHintsEnabled) {
            self.liveHintsEnabled = sender.isOn
        }
    }

    @objc private func translationChanged(_ sender: UISwitch) {
        updateFeature(translation: sender.isOn, sender: sender, previous: translationEnabled) {
            self.translationEnabled = sender.isOn
        }
    }

    /// Persists a single toggle, reverting the switch on failure.
    private func updateFeature(liveHints: Bool? = nil, translation: Bool? = nil, sender: UISwitch, previous: Bool, apply: @escaping () -> Void) {
        apply()
        Task { @MainActor in
            do {
                let saved = try await APIClient.shared.setCallFeatureSettings(liveHintsEnabled: liveHints, translationEnabled: translation)
                liveHintsEnabled = saved.liveHintsEnabled
                translationEnabled = saved.translationEnabled
                sender.setOn(liveHints ?? translation ?? sender.isOn, animated: false)
            } catch {
                sender.setOn(previous, animated: true)
                if liveHints != nil { liveHintsEnabled = previous } else { translationEnabled = previous }
                showAlert(title: "Could not save", message: error.localizedDescription)
            }
        }
    }

    private func saveForwarding() {
        view.endEditing(true)
        let raw = forwardingField.text ?? ""
        guard let normalized = normalizedPhone(raw) else {
            showAlert(title: "Invalid number",
                      message: "Use international format, for example +15551234567.")
            return
        }
        Task { @MainActor in
            do {
                let saved = try await APIClient.shared.setForwardingPhone(normalized.isEmpty ? nil : normalized)
                forwardingField.text = saved
                showAlert(title: "Saved",
                          message: normalized.isEmpty ? "Forwarding number cleared." : "Forwarding number saved.")
            } catch {
                showAlert(title: "Could not save", message: error.localizedDescription)
            }
        }
    }

    private func clearForwarding() {
        view.endEditing(true)
        Task { @MainActor in
            do {
                _ = try await APIClient.shared.setForwardingPhone(nil)
                forwardingField.text = ""
                showAlert(title: "Cleared", message: "Forwarding number removed.")
            } catch {
                showAlert(title: "Could not clear", message: error.localizedDescription)
            }
        }
    }

    /// Returns the cleaned E.164-ish number, "" to signal a clear, or nil if the
    /// input is non-empty but invalid. Mirrors the backend's validation/normalize.
    private func normalizedPhone(_ raw: String) -> String? {
        let cleaned = raw.components(separatedBy: CharacterSet(charactersIn: " -()")).joined()
        if cleaned.isEmpty { return "" }
        if cleaned.range(of: "^\\+?[1-9]\\d{6,14}$", options: .regularExpression) != nil {
            return cleaned
        }
        return nil
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
