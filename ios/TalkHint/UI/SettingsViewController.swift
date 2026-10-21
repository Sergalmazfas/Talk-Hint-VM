import UIKit

/// Settings — the simplified "Personal" configuration screen:
///
///   Language  → hint language picker
///   Live Call → Live Hints / Translation toggles
///   Phone     → the user's TalkHint number (opens number management)
///   Account   → account details / logout
///
/// Personal/work context lives in this app. AI answering and forwarding are
/// still deliberately not enabled by profile setup.
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
        case translator
        case secretary
        case phone
        case account
    }

    private enum FeatureRow: Int, CaseIterable {
        case liveHints
        case translation
    }

    private enum TranslatorRow: Int, CaseIterable {
        case voice
        case playback
        case provider
    }

    // Per-user live-call toggles, mirrored locally for instant display. Default ON
    // to match the backend; refreshed from the server on appear.
    private var liveHintsEnabled = true
    private var translationEnabled = true

    /// The user's TalkHint number, shown in the Phone section once loaded.
    private var myNumber: String?
    private var workNumber: String?
    private var profilesLoaded = false
    private var profilesLoadFailed = false

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
            do {
                let profiles = try await APIClient.shared.callProfiles()
                myNumber = profiles.profile(.personal)?.numbers.first?.phoneNumber
                workNumber = profiles.profile(.work)?.numbers.first?.phoneNumber
                profilesLoaded = true
                profilesLoadFailed = false
            } catch {
                profilesLoadFailed = true
                if let numbers = try? await APIClient.shared.numbers() {
                    myNumber = numbers.first?.number
                }
            }
            tableView.reloadSections(IndexSet(integer: Section.phone.rawValue), with: .none)
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
        case .translator: return TranslatorRow.allCases.count
        case .secretary: return 1
        case .phone: return 3
        case .account: return 1
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .language: return NSLocalizedString("settings.section.hint_language", comment: "")
        case .features: return NSLocalizedString("settings.section.live_call", comment: "")
        case .translator: return NSLocalizedString("settings.section.translator", comment: "")
        case .secretary: return NSLocalizedString("settings.section.secretary", comment: "")
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
        case .translator:
            return NSLocalizedString("settings.footer.voice_provider", comment: "")
        case .secretary:
            return NSLocalizedString("settings.secretary.footer", comment: "")
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

        case .translator:
            let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
            cell.selectionStyle = .none
            switch TranslatorRow(rawValue: indexPath.row)! {
            case .voice:
                cell.textLabel?.text = NSLocalizedString("settings.translator.my_voice", comment: "")
                let control = UISegmentedControl(items: [
                    NSLocalizedString("settings.translator.voice.male", comment: ""),
                    NSLocalizedString("settings.translator.voice.female", comment: ""),
                ])
                control.selectedSegmentIndex = SessionStore.shared.translatorVoice == .male ? 0 : 1
                control.accessibilityIdentifier = "segmented-translator-voice"
                control.addTarget(self, action: #selector(translatorVoiceChanged(_:)), for: .valueChanged)
                cell.accessoryView = control
            case .playback:
                cell.textLabel?.text = NSLocalizedString("settings.translator.playback", comment: "")
                let control = UISegmentedControl(items: [
                    NSLocalizedString("settings.translator.playback.voice", comment: ""),
                    NSLocalizedString("settings.translator.playback.text", comment: ""),
                ])
                control.selectedSegmentIndex = SessionStore.shared.translatorPlayback == .voice ? 0 : 1
                control.accessibilityIdentifier = "segmented-translator-playback"
                control.addTarget(self, action: #selector(translatorPlaybackChanged(_:)), for: .valueChanged)
                cell.accessoryView = control
            case .provider:
                cell.textLabel?.text = NSLocalizedString("settings.voice_provider.title", comment: "")
                let control = UISegmentedControl(items: [
                    NSLocalizedString("settings.voice_provider.elevenlabs", comment: ""),
                    NSLocalizedString("settings.voice_provider.cartesia", comment: ""),
                ])
                control.selectedSegmentIndex = SessionStore.shared.voiceProvider == .elevenlabs ? 0 : 1
                control.accessibilityIdentifier = "segmented-voice-provider"
                control.addTarget(self, action: #selector(voiceProviderChanged(_:)), for: .valueChanged)
                cell.accessoryView = control
            }
            return cell

        case .secretary:
            let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
            let provider = SessionStore.shared.secretaryVoiceProvider
            cell.textLabel?.text = provider == .openai
                ? NSLocalizedString("settings.secretary.openai", comment: "")
                : provider.displayName
            cell.textLabel?.numberOfLines = 0
            cell.detailTextLabel?.text = NSLocalizedString(
                provider == .openai ? "settings.secretary.openai.detail" : "settings.secretary.clone.detail",
                comment: "")
            cell.detailTextLabel?.numberOfLines = 0
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-secretary-voice-provider"
            return cell

        case .phone:
            let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
            if indexPath.row == 0 {
                cell.textLabel?.text = NSLocalizedString("profiles.personal_number", comment: "")
                cell.detailTextLabel?.text = myNumber ?? "—"
                cell.imageView?.image = UIImage(systemName: "phone")
                cell.accessibilityIdentifier = "cell-my-number"
            } else if indexPath.row == 1 {
                cell.textLabel?.text = NSLocalizedString("profiles.work_number", comment: "")
                let stateKey = profilesLoadFailed ? "profiles.load_failed" :
                    (profilesLoaded ? "profiles.not_connected" : "common.loading")
                cell.detailTextLabel?.text = profilesLoadFailed ? NSLocalizedString(stateKey, comment: "") :
                    (workNumber ?? NSLocalizedString(stateKey, comment: ""))
                cell.imageView?.image = UIImage(systemName: "briefcase")
                cell.accessibilityIdentifier = "cell-work-number"
            } else {
                cell.textLabel?.text = NSLocalizedString("profiles.cards_entry", comment: "")
                cell.textLabel?.numberOfLines = 0
                cell.imageView?.image = UIImage(systemName: "rectangle.stack")
                cell.accessibilityIdentifier = "cell-call-profiles"
            }
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.accessoryType = .disclosureIndicator
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
        case .translator:
            break // handled by the segmented control
        case .secretary:
            selectSecretaryProvider(at: indexPath)
        case .phone:
            if indexPath.row == 0 {
                navigationController?.pushViewController(NumbersViewController(), animated: true)
            } else {
                navigationController?.pushViewController(CallProfilesViewController(), animated: true)
            }
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

    private func selectSecretaryProvider(at indexPath: IndexPath) {
        let sheet = UIAlertController(
            title: NSLocalizedString("settings.secretary.choose", comment: ""),
            message: nil, preferredStyle: .actionSheet)
        for provider in SecretaryVoiceProviderPreference.allCases {
            let title = provider == .openai
                ? NSLocalizedString("settings.secretary.openai", comment: "")
                : provider.displayName
            sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in
                SessionStore.shared.secretaryVoiceProvider = provider
                self?.tableView.reloadSections(IndexSet(integer: Section.secretary.rawValue), with: .none)
            })
        }
        sheet.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = tableView
            popover.sourceRect = tableView.rectForRow(at: indexPath)
        }
        present(sheet, animated: true)
    }

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

    @objc private func translatorVoiceChanged(_ sender: UISegmentedControl) {
        SessionStore.shared.translatorVoice = sender.selectedSegmentIndex == 0 ? .male : .female
    }

    @objc private func translatorPlaybackChanged(_ sender: UISegmentedControl) {
        SessionStore.shared.translatorPlayback = sender.selectedSegmentIndex == 0 ? .voice : .text
    }

    @objc private func voiceProviderChanged(_ sender: UISegmentedControl) {
        SessionStore.shared.voiceProvider = sender.selectedSegmentIndex == 1 ? .cartesia : .elevenlabs
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
