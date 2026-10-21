import UIKit

/// Native entry to the existing owner-scoped profiles API. Loading this screen
/// never assigns a number, buys one, changes the active line or starts a call.
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
            // Do not display old ownership as if it had just been verified.
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
            // Read-only recovery even after a lost response: never auto-repeat POST.
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
