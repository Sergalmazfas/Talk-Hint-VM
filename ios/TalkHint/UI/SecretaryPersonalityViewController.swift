import UIKit

/// Personality, owner/number assignment and explicit outgoing fact disclosure.
/// Provider/voice stays a separate setting; Save explicitly selects the Retell pilot.
final class SecretaryPersonalityViewController: UITableViewController {
    private var numbers: [SecretaryPersonalityContext.Number] = []
    private var setup: SecretaryOutgoingSetup?
    private var selectedId: String?
    private var selectedVersion: Int?
    private var character: SecretaryPersonalityContent?
    private var selectedCards = Set<String>()
    private var busy = false
    private var generation = 0
    private let owner = SessionStore.shared.userId
    private func text(_ key: String) -> String { NSLocalizedString("secretary.personality." + key, comment: "") }

    private let api: APIClient
    init(api: APIClient = .shared) {
        self.api = api
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = text("title")
        tableView.accessibilityIdentifier = "secretary-personality-settings"
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 64
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: text("reload"), style: .plain, target: self, action: #selector(reload))
        reload()
    }
    @objc private func reload() {
        guard !busy, SessionStore.shared.userId == owner else { return }
        generation += 1
        let epoch = generation
        busy = true; tableView.reloadData()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let context = try await self.api.secretaryPersonalityContext()
                guard epoch == self.generation, SessionStore.shared.userId == self.owner else { return }
                self.numbers = context.numbers
                let saved = SessionStore.shared.secretaryOutgoingNumberId
                if let number = context.numbers.first(where: { $0.id == saved }) ?? context.numbers.first {
                    await self.load(number.id)
                } else {
                    self.busy = false; self.setup = nil; self.tableView.reloadData()
                }
            } catch {
                guard epoch == self.generation else { return }
                self.busy = false; self.setup = nil; self.tableView.reloadData()
                self.error(self.text("dev_required") + "\n\n" + error.localizedDescription)
            }
        }
    }
    @MainActor func load(_ numberId: String) async {
        generation += 1
        let epoch = generation
        busy = true; setup = nil; character = nil; selectedId = nil; selectedVersion = nil
        selectedCards = []; tableView.reloadData()
        do {
            let result = try await api.secretaryOutgoingSetup(numberId: numberId)
            guard epoch == generation, SessionStore.shared.userId == owner else { return }
            setup = result
            selectedId = result.assignment?.personalityId
            selectedVersion = result.assignment?.version
            character = result.assignment?.snapshot
            selectedCards = Set(result.cardIds).intersection(Set(result.cards.map(\.id)))
            busy = false; tableView.reloadData()
        } catch {
            guard epoch == generation else { return }
            busy = false; tableView.reloadData(); self.error(error.localizedDescription)
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 6 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 4 ? max(1, setup?.cards.count ?? 0) : 1
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        text(["connection", "line", "character", "description", "cards", "apply"][section])
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0 { return text("dev_required") }
        if section == 1 { return text("line_note") }
        if section == 4 { return text("cards_note") }
        if section == 5 { return text("save_note") }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        switch indexPath.section {
        case 0:
            cell.textLabel?.text = "Retell + TalkHint Engine"
            cell.detailTextLabel?.text = "Merritt · \(setup?.engine ?? "gpt-6.1-sol") · \(setup?.reasoning ?? "medium")\n\(AppConfig.baseURL.absoluteString)"
            cell.selectionStyle = .none
        case 1:
            cell.textLabel?.text = setup?.fromNumber ?? (busy ? text("loading") : text("no_numbers"))
            cell.detailTextLabel?.text = setup.map { text($0.scope) }
            cell.accessoryType = .disclosureIndicator; cell.accessibilityIdentifier = "secretary-personality-number"
        case 2:
            cell.textLabel?.text = character?.name ?? text("none")
            cell.detailTextLabel?.text = character.map { "\($0.description)\n\(text("version")) \($0.version)" }
            cell.accessoryType = .disclosureIndicator; cell.accessibilityIdentifier = "secretary-personality-character"
        case 3:
            cell.textLabel?.text = character?.rules ?? text("legacy")
            if let character {
                let guidance = setup?.scope == "work" ? character.modeGuidance.work : character.modeGuidance.personal
                cell.detailTextLabel?.text = ([guidance] + character.examples).joined(separator: "\n\n")
            }
            cell.selectionStyle = .none
        case 4:
            if let cards = setup?.cards, !cards.isEmpty {
                let card = cards[indexPath.row]
                cell.textLabel?.text = card.title; cell.detailTextLabel?.text = card.description
                cell.accessoryType = selectedCards.contains(card.id) ? .checkmark : .none
                cell.accessibilityIdentifier = "secretary-personality-card-\(card.id)"
            } else { cell.textLabel?.text = text("no_cards"); cell.selectionStyle = .none }
        default:
            cell.textLabel?.text = busy ? text("loading") : text("save")
            cell.textLabel?.textColor = busy || setup == nil ? .secondaryLabel : .systemGreen
            cell.accessibilityIdentifier = "secretary-personality-save"
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !busy else { return }
        switch indexPath.section {
        case 1:
            let sheet = UIAlertController(title: text("line"), message: text("line_note"), preferredStyle: .actionSheet)
            for number in numbers {
                sheet.addAction(UIAlertAction(title: "\(text(number.type == "work" ? "work" : "personal")) · \(number.twilioNumber)", style: .default) { [weak self] _ in
                    Task { @MainActor [weak self] in await self?.load(number.id) }
                })
            }
            sheet.addAction(UIAlertAction(title: text("cancel"), style: .cancel))
            sheet.popoverPresentationController?.sourceView = tableView
            sheet.popoverPresentationController?.sourceRect = tableView.rectForRow(at: indexPath)
            present(sheet, animated: true)
        case 2:
            guard setup != nil else { return }
            let picker = SecretaryPersonalityPickerViewController(api: api)
            picker.onSelected = { [weak self] id, content in
                guard let self else { return }
                self.selectedId = id; self.selectedVersion = content?.version; self.character = content
                self.tableView.reloadData()
            }
            navigationController?.pushViewController(picker, animated: true)
        case 4:
            guard let cards = setup?.cards, !cards.isEmpty else { return }
            let id = cards[indexPath.row].id
            if selectedCards.contains(id) { selectedCards.remove(id) }
            else if selectedCards.count < 8 { selectedCards.insert(id) }
            else { error(text("cards_limit")) }
            tableView.reloadRows(at: [indexPath], with: .none)
        case 5: save()
        default: break
        }
    }
    private func save() {
        guard let setup, !busy else { return }
        busy = true; tableView.reloadData()
        let id = selectedId, version = selectedVersion, cardIds = selectedCards.sorted()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await self.api.saveSecretaryOutgoingSetup(
                    numberId: setup.numberId, personalityId: id, version: version, cardIds: cardIds)
                guard SessionStore.shared.userId == self.owner else { return }
                guard result.protocolVersion == 1, result.numberId == setup.numberId,
                      result.provider == "retell" else { throw APIError.decoding }
                if var draft = SessionStore.shared.pendingSecretaryCall, !draft.requestAttempted {
                    draft.secretaryNumberId = result.numberId
                    draft.secretaryBackendOrigin = AppConfig.baseURL.absoluteString
                    draft.voiceProvider = .retell
                    guard SessionStore.shared.savePendingSecretaryCall(draft) else { throw APIError.decoding }
                }
                SessionStore.shared.secretaryOutgoingNumberId = result.numberId
                SessionStore.shared.secretaryVoiceProvider = .retell
                self.setup = result; self.busy = false; self.tableView.reloadData()
                self.error(self.text("saved"), title: self.text("title"))
            } catch {
                self.busy = false; self.tableView.reloadData(); self.error(error.localizedDescription)
            }
        }
    }
    private func error(_ message: String, title: String? = nil) {
        let alert = UIAlertController(title: title ?? text("error"), message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("ok"), style: .default))
        present(alert, animated: true)
    }
}
