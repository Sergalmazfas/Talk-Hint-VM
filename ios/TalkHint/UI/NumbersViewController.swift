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
    }
    private let scopes: [CallProfileScope] = [.personal, .work, .shared]
    private var snapshot: CallProfilesSnapshot?
    private var loading = false
    private var connecting = false
    private var loadError: String?

    init() { super.init(style: .insetGrouped) }
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
            snapshot = try await APIClient.shared.callProfiles()
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
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch rows(in: indexPath.section)[indexPath.row] {
        case .cards(let scope):
            navigationController?.pushViewController(KnowledgeCardsViewController(profileScope: scope), animated: true)
        case .connect(let candidate):
            confirm(candidate)
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
                _ = try await APIClient.shared.connectWorkNumber(numberId: candidate.id)
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
