import UIKit

/// Settings — the simplified "Personal" configuration screen:
///
///   Language  → hint language picker
///   Live Call → Live Hints / Translation toggles
///   Phone     → the user's TalkHint number (opens number management)
///   Account   → account details / logout
///
/// Telephony-grade options (call handling modes, call forwarding) and the
/// assistant tools constructor were deliberately removed from Personal — they
/// belong to a future Business tier, not here.
///
/// Persistence:
///   - Live-call toggles -> `GET`/`POST` call feature settings API.
///   - Hint language is stored locally (`SessionStore`) and sent to the live
///     assistant over the `/ui` socket on each call; the backend has no
///     language-update route, so it cannot be persisted server-side.
final class SettingsViewController: UITableViewController {

    private enum Section: Int, CaseIterable {
        case language
        case features
        case phone
        case account
    }

    private enum FeatureRow: Int, CaseIterable {
        case liveHints
        case translation
    }

    // Per-user live-call toggles, mirrored locally for instant display. Default ON
    // to match the backend; refreshed from the server on appear.
    private var liveHintsEnabled = true
    private var translationEnabled = true

    /// The user's TalkHint number, shown in the Phone section once loaded.
    private var myNumber: String?

    init() {
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("settings.title", comment: "")
        tableView.accessibilityIdentifier = "table-settings"
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loadFeatureSettings()
        loadMyNumber()
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

    private func loadMyNumber() {
        Task { @MainActor in
            if let numbers = try? await APIClient.shared.numbers() {
                myNumber = numbers.first?.number
                tableView.reloadSections(IndexSet(integer: Section.phone.rawValue), with: .none)
            }
        }
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .language: return SessionStore.availableLanguages.count
        case .features: return FeatureRow.allCases.count
        case .phone: return 1
        case .account: return 1
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .language: return NSLocalizedString("settings.section.hint_language", comment: "")
        case .features: return NSLocalizedString("settings.section.live_call", comment: "")
        case .phone: return NSLocalizedString("settings.section.phone", comment: "")
        case .account: return NSLocalizedString("settings.section.account", comment: "")
        }
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .language:
            return NSLocalizedString("settings.footer.language", comment: "")
        case .features:
            return NSLocalizedString("settings.footer.features", comment: "")
        case .phone, .account:
            return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        switch Section(rawValue: indexPath.section)! {
        case .language:
            let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
            let lang = SessionStore.availableLanguages[indexPath.row]
            cell.textLabel?.text = lang.name
            cell.accessoryType = (SessionStore.shared.language == lang.code) ? .checkmark : .none
            cell.accessibilityIdentifier = "cell-language-\(lang.code)"
            return cell

        case .features:
            switch FeatureRow(rawValue: indexPath.row)! {
            case .liveHints:
                return featureCell(title: NSLocalizedString("settings.feature.live_hints", comment: ""),
                                   isOn: liveHintsEnabled,
                                   identifier: "switch-live-hints",
                                   action: #selector(liveHintsChanged(_:)))
            case .translation:
                return featureCell(title: NSLocalizedString("settings.feature.translation", comment: ""),
                                   isOn: translationEnabled,
                                   identifier: "switch-translation",
                                   action: #selector(translationChanged(_:)))
            }

        case .phone:
            let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
            cell.textLabel?.text = NSLocalizedString("settings.my_number", comment: "")
            cell.detailTextLabel?.text = myNumber ?? "—"
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.imageView?.image = UIImage(systemName: "phone")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-my-number"
            return cell

        case .account:
            let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
            cell.textLabel?.text = NSLocalizedString("settings.section.account", comment: "")
            cell.imageView?.image = UIImage(systemName: "person.crop.circle")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-account"
            return cell
        }
    }

    // MARK: - Selection

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch Section(rawValue: indexPath.section)! {
        case .language:
            let code = SessionStore.availableLanguages[indexPath.row].code
            SessionStore.shared.language = code
            tableView.reloadSections(IndexSet(integer: Section.language.rawValue), with: .none)
        case .features:
            break // handled by the UISwitch valueChanged action
        case .phone:
            navigationController?.pushViewController(NumbersViewController(), animated: true)
        case .account:
            let account = AccountViewController()
            account.onLoggedOut = {
                let scene = UIApplication.shared.connectedScenes.first
                (scene?.delegate as? SceneDelegate)?.showRoot(loggedIn: false)
            }
            navigationController?.pushViewController(account, animated: true)
        }
    }

    // MARK: - Feature toggles

    private func featureCell(title: String, isOn: Bool, identifier: String, action: Selector) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.selectionStyle = .none
        cell.textLabel?.text = title
        let toggle = UISwitch()
        toggle.isOn = isOn
        toggle.onTintColor = Theme.green
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
                showAlert(title: NSLocalizedString("settings.error.save", comment: ""), message: error.localizedDescription)
            }
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
