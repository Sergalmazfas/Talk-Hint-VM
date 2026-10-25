import UIKit

/// Personality, owner/number assignment and explicit outgoing fact disclosure.
/// Provider/voice stays a separate setting; Save explicitly selects the Retell pilot.
final class SecretaryPersonalityViewController: UITableViewController {
    private var numbers: [SecretaryPersonalityContext.Number] = []
    private var setup: SecretaryOutgoingSetup?
    private var requestedNumberId: String?
    private var selectedId: String?
    private var selectedVersion: Int?
    private var character: SecretaryPersonalityContent?
    private var selectedCards = Set<String>()
    private var busy = false
    private var generation = 0
    private let owner = SessionStore.shared.userId
    private let origin = AppConfig.baseURL.absoluteString
    private var operations: [UUID: Task<Void, Never>] = [:]
    private var suspended = false
    private var appeared = false
    private var needsReload = false
    private var pendingNotice: (message: String, title: String?)?
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
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        suspended = false
        if needsReload {
            needsReload = false
            reload() // Read server truth; a cancelled PUT may already have saved.
        }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appeared = true
        showPendingNotice()
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        appeared = false
        cancelPendingOperations()
    }
    func cancelPendingOperations() {
        needsReload = needsReload || busy
        suspended = true
        generation += 1
        operations.values.forEach { $0.cancel() }
        busy = false
        pendingNotice = nil
    }
    /// Used by hosted tests to drain cancelled work before restoring shared state.
    func finishPendingOperations() async {
        cancelPendingOperations()
        let pending = Array(operations.values)
        for task in pending { await task.value }
    }
    private func startOperation(_ action: @escaping @MainActor () async -> Void) {
        let id = UUID()
        operations[id] = Task { @MainActor [weak self] in
            guard !Task.isCancelled else { self?.operations[id] = nil; return }
            await action()
            self?.operations[id] = nil
        }
    }
    private func isCurrent(_ epoch: Int) -> Bool {
        !Task.isCancelled && !suspended && epoch == generation &&
            SessionStore.shared.userId == owner && AppConfig.baseURL.absoluteString == origin
    }
    @objc private func reload() {
        guard !busy, !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        generation += 1
        let epoch = generation
        busy = true; tableView.reloadData()
        startOperation { [weak self] in
            guard let self else { return }
            do {
                let context = try await self.api.secretaryPersonalityContext()
                guard self.isCurrent(epoch) else { return }
                self.numbers = context.numbers
                let saved = self.requestedNumberId ?? SessionStore.shared.secretaryOutgoingNumberId
                if let saved, !context.numbers.contains(where: { $0.id == saved }) {
                    self.busy = false
                    self.setup = nil
                    self.tableView.reloadData()
                    self.error(self.text("line_stale"))
                } else if let number = context.numbers.first(where: { $0.id == saved })
                    ?? context.numbers.first(where: { $0.id == context.defaultOutgoing?.numberId })
                    ?? context.numbers.first {
                    await self.load(number.id)
                } else {
                    self.busy = false; self.setup = nil; self.tableView.reloadData()
                }
            } catch {
                guard self.isCurrent(epoch) else { return }
                self.busy = false; self.setup = nil; self.tableView.reloadData()
                self.error(error.localizedDescription)
            }
        }
    }
    @MainActor func load(_ numberId: String) async {
        guard !Task.isCancelled, !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        generation += 1
        let epoch = generation
        requestedNumberId = numberId
        busy = true; setup = nil; character = nil; selectedId = nil; selectedVersion = nil
        selectedCards = []; tableView.reloadData()
        do {
            let result = try await api.secretaryOutgoingSetup(numberId: numberId)
            guard isCurrent(epoch) else { return }
            setup = result
            selectedId = result.assignment?.personalityId
            selectedVersion = result.assignment?.version
            character = result.assignment?.snapshot
            selectedCards = Set(result.cardIds).intersection(Set(result.cards.map(\.id)))
            busy = false; tableView.reloadData()
        } catch {
            guard isCurrent(epoch) else { return }
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
            cell.textLabel?.text = NSLocalizedString("secretary.summary.retell", comment: "")
            cell.detailTextLabel?.text = setup.map {
                "Merritt · \($0.engine) · \($0.reasoning)\n\(AppConfig.baseURL.absoluteString)"
            } ?? (busy ? text("loading") : text("setup_unavailable"))
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
        guard !busy, !suspended, viewIfLoaded?.window != nil,
              presentedViewController == nil else { return }
        switch indexPath.section {
        case 1:
            let sheet = UIAlertController(title: text("line"), message: text("line_note"), preferredStyle: .actionSheet)
            for number in numbers {
                sheet.addAction(UIAlertAction(title: "\(text(number.type == "work" ? "work" : "personal")) · \(number.twilioNumber)", style: .default) { [weak self] _ in
                    self?.startOperation { [weak self] in
                        guard let self else { return }
                        await self.load(number.id)
                    }
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
        guard let setup, !busy, !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        generation += 1
        let epoch = generation
        busy = true; tableView.reloadData()
        let id = selectedId, version = selectedVersion, cardIds = selectedCards.sorted()
        startOperation { [weak self] in
            guard let self else { return }
            do {
                let result = try await self.api.saveSecretaryOutgoingSetup(
                    numberId: setup.numberId, personalityId: id, version: version, cardIds: cardIds)
                guard self.isCurrent(epoch) else { return }
                guard result.protocolVersion == 1, result.numberId == setup.numberId,
                      result.provider == "retell", !result.engine.isEmpty,
                      !result.reasoning.isEmpty else { throw APIError.decoding }
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
                guard self.isCurrent(epoch) else { return }
                self.busy = false; self.tableView.reloadData(); self.error(error.localizedDescription)
            }
        }
    }
    private func error(_ message: String, title: String? = nil) {
        guard !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        pendingNotice = (message, title)
        showPendingNotice()
    }
    private func showPendingNotice() {
        guard !suspended, appeared, viewIfLoaded?.window != nil,
              navigationController?.topViewController === self,
              presentedViewController == nil, !isBeingDismissed,
              SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin,
              let notice = pendingNotice else { return }
        pendingNotice = nil
        let alert = UIAlertController(title: notice.title ?? text("error"), message: notice.message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("ok"), style: .default))
        present(alert, animated: true)
    }
}
