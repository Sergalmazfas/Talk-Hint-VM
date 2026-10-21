import UIKit

/// "Numbers" tab — lists the user's assigned phone numbers, shows which one is
/// active (a local selection, since the backend has no active-number field), lets
/// the user switch the active number, and opens the available pool to claim a new
/// one. The active selection is shared with the Account tab via `SessionStore`.
final class NumbersViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {

    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private let spinner = UIActivityIndicatorView(style: .large)
    private let messageLabel = UILabel()
    private var numbers: [APIClient.PhoneNumberItem] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("numbers.title", comment: "")
        view.backgroundColor = .systemGroupedBackground

        let addButton = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addTapped))
        addButton.accessibilityIdentifier = "button-add-number"
        navigationItem.rightBarButtonItem = addButton

        setupTable()
        setupOverlays()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    private func setupTable() {
        tableView.dataSource = self
        tableView.delegate = self
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        tableView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tableView)
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
    }

    private func setupOverlays() {
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        messageLabel.textColor = .secondaryLabel
        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.isHidden = true
        messageLabel.accessibilityIdentifier = "text-numbers-empty"
        messageLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(messageLabel)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            messageLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            messageLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func reload() {
        if !(tableView.refreshControl?.isRefreshing ?? false) {
            spinner.startAnimating()
        }
        messageLabel.isHidden = true
        Task { @MainActor in
            defer {
                spinner.stopAnimating()
                tableView.refreshControl?.endRefreshing()
            }
            do {
                numbers = try await APIClient.shared.numbers()
                // Default the active selection to the first number when nothing
                // valid is selected yet.
                if numbers.first(where: { $0.id == SessionStore.shared.activeNumberId }) == nil {
                    SessionStore.shared.activeNumberId = numbers.first?.id
                }
                tableView.reloadData()
                if numbers.isEmpty {
                    messageLabel.text = NSLocalizedString("numbers.empty", comment: "")
                    messageLabel.isHidden = false
                }
            } catch {
                numbers = []
                tableView.reloadData()
                messageLabel.text = NSLocalizedString("numbers.load_error", comment: "")
                messageLabel.isHidden = false
            }
        }
    }

    @objc private func addTapped() {
        navigationController?.pushViewController(AvailableNumbersViewController(), animated: true)
    }

    // MARK: - UITableViewDataSource / Delegate

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        numbers.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        let item = numbers[indexPath.row]
        var config = cell.defaultContentConfiguration()
        config.text = item.name.isEmpty ? NSLocalizedString("numbers.default_name", comment: "") : item.name
        config.secondaryText = item.number
        cell.contentConfiguration = config
        cell.accessoryType = (item.id == SessionStore.shared.activeNumberId) ? .checkmark : .none
        cell.accessibilityIdentifier = "cell-number-\(item.id)"
        return cell
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        numbers.isEmpty ? nil : NSLocalizedString("numbers.section.header", comment: "")
    }

    func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        numbers.count > 1 ? NSLocalizedString("numbers.section.footer", comment: "") : nil
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        SessionStore.shared.activeNumberId = numbers[indexPath.row].id
        tableView.reloadData()
    }
}

/// Native profile setup. Kept in this existing target source so older generated
/// Xcode projects can compile Settings without first adding a new source file.
/// Loading this screen never assigns a number or starts a call.
final class CallProfilesViewController: UITableViewController {
    private enum Row {
        case number(CallProfileNumber)
        case missing
        case cards(CallProfileScope)
        case connect(CallProfilesSnapshot.RecommendedNumber)
        case incoming
    }
    private let scopes: [CallProfileScope] = [.personal, .work, .shared]
    private var snapshot: CallProfilesSnapshot?
    private var loading = false
    private var connecting = false
    private var loadError: String?
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("profiles.title", comment: "")
        tableView.accessibilityIdentifier = "table-call-profiles"
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 72
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: NSLocalizedString("profiles.retry", comment: ""), style: .plain,
            target: self, action: #selector(reload))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-refresh-profiles"
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
        guard !loading, !connecting else { return }
        Task { @MainActor in await loadProfiles() }
    }

    @MainActor private func loadProfiles() async {
        guard !loading else { return }
        loading = true
        navigationItem.rightBarButtonItem?.isEnabled = false
        defer {
            loading = false
            navigationItem.rightBarButtonItem?.isEnabled = true
            tableView.refreshControl?.endRefreshing()
            tableView.reloadData()
        }
        do {
            snapshot = try await api.callProfiles()
            loadError = nil
        } catch {
            snapshot = nil
            loadError = error.localizedDescription
        }
    }

    private func rows(in section: Int) -> [Row] {
        let scope = scopes[section]
        if scope == .shared { return [.cards(.shared)] }
        let numbers = snapshot?.profile(scope)?.numbers ?? []
        var result: [Row] = numbers.isEmpty ? [.missing] : numbers.map { .number($0) }
        if scope == .work, numbers.isEmpty, let candidate = snapshot?.recommendedWorkNumber,
           candidate.available { result.append(.connect(candidate)) }
        result.append(.cards(scope))
        if scope == .work { result.append(.incoming) }
        return result
    }

    override func numberOfSections(in tableView: UITableView) -> Int { scopes.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        rows(in: section).count
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        scopes[section].localizedName
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0, let loadError = loadError { return loadError }
        if section == 1 { return NSLocalizedString("profiles.work_footer", comment: "") }
        if section == 2 { return NSLocalizedString("profiles.shared_footer", comment: "") }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        switch rows(in: indexPath.section)[indexPath.row] {
        case .number(let number):
            cell.textLabel?.text = number.phoneNumber
            cell.detailTextLabel?.text = number.name
            cell.imageView?.image = UIImage(systemName: "phone")
            cell.accessibilityIdentifier = "profile-number-\(scopes[indexPath.section].rawValue)"
        case .missing:
            let key = loadError != nil ? "profiles.load_failed" : (snapshot == nil ? "common.loading" : "profiles.not_connected")
            cell.textLabel?.text = NSLocalizedString(key, comment: "")
            cell.textLabel?.textColor = .secondaryLabel
            cell.accessibilityIdentifier = "profile-number-missing-\(scopes[indexPath.section].rawValue)"
        case .cards(let scope):
            cell.textLabel?.text = NSLocalizedString("profiles.cards", comment: "")
            cell.detailTextLabel?.text = String(format: NSLocalizedString("profiles.cards_title", comment: ""), scope.localizedName)
            cell.imageView?.image = UIImage(systemName: "rectangle.stack")
            cell.accessoryType = .disclosureIndicator
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "profile-cards-\(scope.rawValue)"
        case .connect(let candidate):
            cell.textLabel?.text = NSLocalizedString(connecting ? "common.loading" : "profiles.connect", comment: "")
            cell.textLabel?.textColor = .systemBlue
            cell.detailTextLabel?.text = candidate.phoneNumber
            cell.selectionStyle = connecting ? .none : .default
            cell.accessibilityIdentifier = "button-connect-work-number"
        case .incoming:
            cell.textLabel?.text = NSLocalizedString("incoming.title", comment: "")
            cell.imageView?.image = UIImage(systemName: "phone.badge.waveform")
            cell.accessoryType = .disclosureIndicator
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "cell-incoming-secretary"
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch rows(in: indexPath.section)[indexPath.row] {
        case .cards(let scope):
            navigationController?.pushViewController(KnowledgeCardsViewController(profileScope: scope, api: api), animated: true)
        case .connect(let candidate):
            confirm(candidate)
        case .incoming:
            navigationController?.pushViewController(IncomingSecretaryViewController(), animated: true)
        default: break
        }
    }

    private func confirm(_ candidate: CallProfilesSnapshot.RecommendedNumber) {
        guard !connecting, !loading, presentedViewController == nil else { return }
        var message = String(format: NSLocalizedString("profiles.confirm_message", comment: ""), candidate.phoneNumber)
        if candidate.existingBindingMove == true {
            message += "\n\n" + NSLocalizedString("profiles.move_notice", comment: "")
        }
        let alert = UIAlertController(title: NSLocalizedString("profiles.confirm_title", comment: ""),
                                      message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("profiles.confirm", comment: ""), style: .default) { [weak self] _ in
            self?.connect(candidate)
        })
        present(alert, animated: true)
    }

    private func connect(_ candidate: CallProfilesSnapshot.RecommendedNumber) {
        guard !connecting else { return }
        connecting = true
        tableView.reloadData()
        Task { @MainActor in
            var failure: String?
            do {
                _ = try await api.connectWorkNumber(numberId: candidate.id)
            } catch { failure = error.localizedDescription }
            // Read-only recovery: never automatically repeat a POST.
            await loadProfiles()
            connecting = false
            tableView.reloadData()
            if let failure = failure {
                let alert = UIAlertController(title: NSLocalizedString("profiles.connection_error", comment: ""),
                                              message: failure, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                present(alert, animated: true)
            }
        }
    }
}

/// Kept in an already included target file for compatibility with older Xcode projects.
final class IncomingSecretaryViewController: UITableViewController {
    private var snapshot: APIClient.IncomingSnapshot?
    private var draft: APIClient.IncomingSettings?
    private var loading = false
    private let zone = UITextField(), opens = UITextField(), closes = UITextField(), travel = UITextField()
    private func l(_ key: String) -> String { NSLocalizedString("incoming." + key, comment: "") }
    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = l("title")
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 64
        tableView.accessibilityIdentifier = "table-incoming-secretary"
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(barButtonSystemItem: .save, target: self, action: #selector(save)),
            UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))]
        refreshControl = UIRefreshControl()
        refreshControl?.addTarget(self, action: #selector(reload), for: .valueChanged)
        for field in [zone, opens, closes, travel] {
            field.borderStyle = .roundedRect
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
            field.textAlignment = .right
            field.frame.size = CGSize(width: 180, height: 36)
        }
        zone.placeholder = "America/New_York"
        travel.keyboardType = .numberPad
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); reload() }
    @objc private func reload() {
        guard !loading else { return }; loading = true
        Task { @MainActor in
            defer { loading = false; refreshControl?.endRefreshing(); tableView.reloadData() }
            do {
                let result = try await APIClient.shared.incomingSecretary()
                snapshot = result
                if draft == nil || !result.settings.contains(where: { $0.numberId == draft?.numberId }) {
                    draft = result.settings.first
                    fillFields()
                }
                tableView.backgroundView = nil
            } catch { showError(error) }
        }
    }
    private func fillFields() {
        zone.text = draft?.timeZone; opens.text = draft?.business.opens
        closes.text = draft?.business.closes; travel.text = draft.map { String($0.business.travelMinutes) }
    }
    @objc private func save() {
        guard !loading, var value = draft else { return }
        value.timeZone = zone.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        value.business.opens = opens.text ?? ""; value.business.closes = closes.text ?? ""
        guard let minutes = Int(travel.text ?? "") else { return }
        value.business.travelMinutes = minutes
        loading = true
        navigationItem.rightBarButtonItems?.forEach { $0.isEnabled = false }
        Task { @MainActor in
            defer { loading = false; navigationItem.rightBarButtonItems?.forEach { $0.isEnabled = true } }
            do {
                try await APIClient.shared.saveIncomingSettings(value)
                draft = value
                let alert = UIAlertController(title: l("saved"), message: l("gate_notice"), preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                present(alert, animated: true)
            } catch { showError(error) }
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 5 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        if section == 0 { return 1 }
        if section == 1 { return 3 }
        if section == 2 { return draft == nil ? 0 : 10 }
        if section == 3 { return (snapshot?.cards.count ?? 0) + 1 }
        return max(1, snapshot?.requests.count ?? 0)
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        l(["mode", "settings", "hours", "cards", "requests"][section])
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0 { return l("gate_notice") }
        if section == 2 { return l("future_notice") }
        if section == 3 { return l("cards_notice") }
        if section == 4 { return l("request_notice") }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        switch indexPath.section {
        case 0:
            cell.textLabel?.text = snapshot?.runtimeEnabled == true ? l("runtime_ready") : l("gate_off")
            cell.detailTextLabel?.text = snapshot.map { "\($0.model) · \($0.voice) · EN / RU / ES" }
        case 1:
            if indexPath.row == 0 {
                cell.textLabel?.text = snapshot?.numbers.first(where: { $0.id == draft?.numberId })?.phoneNumber ?? l("no_number")
                cell.accessoryType = .disclosureIndicator
            } else if indexPath.row == 1 {
                cell.textLabel?.text = l("enabled")
                let control = UISwitch(); control.isOn = draft?.enabled ?? false
                control.isEnabled = draft != nil
                control.addTarget(self, action: #selector(toggleEnabled(_:)), for: .valueChanged)
                control.accessibilityIdentifier = "switch-incoming-intent"
                cell.accessoryView = control
            } else { cell.textLabel?.text = l("timezone"); cell.accessoryView = zone }
        case 2:
            if indexPath.row < 7 {
                let day = indexPath.row
                cell.textLabel?.text = DateFormatter().weekdaySymbols[day]
                let control = UISwitch(); control.tag = day; control.isOn = draft?.business.days.contains(day) ?? false
                control.addTarget(self, action: #selector(toggleDay(_:)), for: .valueChanged)
                cell.accessoryView = control
            } else {
                let fields = [opens, closes, travel], keys = ["opens", "closes", "travel"]
                cell.textLabel?.text = l(keys[indexPath.row - 7]); cell.accessoryView = fields[indexPath.row - 7]
            }
        case 3:
            if let cards = snapshot?.cards, indexPath.row < cards.count {
                let card = cards[indexPath.row]
                cell.textLabel?.text = card.title; cell.detailTextLabel?.text = card.body
                cell.accessoryType = draft?.cardIds.contains(card.id) == true ? .checkmark : .none
                cell.accessibilityIdentifier = "incoming-permission-\(card.id)"
            } else {
                cell.textLabel?.text = l("template"); cell.textLabel?.textColor = .systemBlue
                cell.accessibilityIdentifier = "button-incoming-template"
            }
            cell.selectionStyle = .default
        default:
            if let requests = snapshot?.requests, indexPath.row < requests.count {
                let r = requests[indexPath.row]
                cell.textLabel?.text = r.fields.name ?? r.fields.phone ?? r.id
                cell.detailTextLabel?.text = "\(l(r.status)) · \(r.fields.language ?? "—") · \(r.updatedAt)"
                cell.accessoryType = .disclosureIndicator; cell.selectionStyle = .default
            } else { cell.textLabel?.text = l("empty") }
        }
        return cell
    }
    @objc private func toggleEnabled(_ control: UISwitch) { draft?.enabled = control.isOn }
    @objc private func toggleDay(_ control: UISwitch) {
        guard var days = draft?.business.days else { return }
        days.removeAll { $0 == control.tag }; if control.isOn { days.append(control.tag) }
        draft?.business.days = days.sorted()
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard let snapshot = snapshot else { return }
        if indexPath.section == 1 && indexPath.row == 0 {
            let alert = UIAlertController(title: l("settings"), message: nil, preferredStyle: .alert)
            for number in snapshot.numbers {
                alert.addAction(UIAlertAction(title: number.phoneNumber, style: .default) { [weak self] _ in
                    self?.draft = snapshot.settings.first { $0.numberId == number.id }
                    self?.fillFields(); self?.tableView.reloadData()
                })
            }
            alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
            present(alert, animated: true)
        }
        if indexPath.section == 3 {
            if indexPath.row < snapshot.cards.count {
                let id = snapshot.cards[indexPath.row].id
                if draft?.cardIds.contains(id) == true { draft?.cardIds.removeAll { $0 == id } }
                else { draft?.cardIds.append(id) }
                tableView.reloadRows(at: [indexPath], with: .none)
            } else {
                let editor = KnowledgeCardEditorViewController(card: nil, profileScope: .work, templateBody: snapshot.templateText) { [weak self] in self?.reload() }
                navigationController?.pushViewController(editor, animated: true)
            }
        }
        if indexPath.section == 4 && indexPath.row < snapshot.requests.count {
            let r = snapshot.requests[indexPath.row], f = r.fields
            let rows: [(String,String?)] = [("name",f.name),("phone",f.phone),("address",f.address),
                ("date",f.localDate),("time",f.localTime),("duration",f.durationMinutes.map { String($0) }),
                ("timezone",r.timeZone),("language",f.language),("notes",f.notes)]
            var text = "\(l(r.status))\n\(r.outcome)\n\n"
            text += rows.map { "\(l($0.0)): \($0.1 ?? "—")" }.joined(separator: "\n")
            let labels = ["localDate":"date", "localTime":"time", "durationMinutes":"duration",
                          "callbackConfirmed":"callback_confirmed", "reviewed":"reviewed", "businessTimezone":"timezone"]
            text += "\n\n\(l("missing")): \(r.missing.map { l(labels[$0] ?? $0) }.joined(separator: ", "))"
            text += "\n\(l("notification")): \(l("notification_" + (r.notificationStatus ?? "pending")))"
            text += "\n\n" + r.turns.map { "\(l($0.role)) [\($0.language ?? "—")]: \($0.text)" }.joined(separator: "\n\n")
            let detail = UIViewController(); detail.title = l("requests")
            let body = UITextView(); body.text = text; body.isEditable = false
            body.font = .preferredFont(forTextStyle: .body); body.backgroundColor = .systemBackground
            detail.view = body
            navigationController?.pushViewController(detail, animated: true)
        }
    }
    private func showError(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""), message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
