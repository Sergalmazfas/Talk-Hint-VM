import UIKit

/// A paginated server catalog; no hardcoded Katya entry or download-all.
final class SecretaryPersonalityPickerViewController: UITableViewController, UISearchResultsUpdating {
    var onSelected: ((String?, SecretaryPersonalityContent?) -> Void)?
    private var items: [SecretaryPersonalityItem] = []
    private var cursor: String?
    private var busy = false
    private var epoch = 0
    private let owner = SessionStore.shared.userId
    private let origin = AppConfig.baseURL.absoluteString
    private var requests: [UUID: Task<Void, Never>] = [:]
    private var suspended = false
    private var appeared = false
    private var needsReload = false
    private var pendingError: String?
    private let search = UISearchController(searchResultsController: nil)
    private func text(_ key: String) -> String { NSLocalizedString("secretary.personality." + key, comment: "") }
    private let api: APIClient
    init(api: APIClient = .shared) {
        self.api = api
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = text("character")
        search.searchResultsUpdater = self; search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = text("search")
        navigationItem.searchController = search; definesPresentationContext = true
        tableView.rowHeight = UITableView.automaticDimension; tableView.estimatedRowHeight = 72
        tableView.accessibilityIdentifier = "secretary-personality-catalog"
        load(reset: true)
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        suspended = false
        if needsReload { needsReload = false; load(reset: true) }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appeared = true
        if let message = pendingError { show(message) }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        appeared = false
        cancelPendingOperations()
    }
    func cancelPendingOperations() {
        needsReload = needsReload || busy
        suspended = true; epoch += 1; busy = false; pendingError = nil
        requests.values.forEach { $0.cancel() }
    }
    func finishPendingOperations() async {
        cancelPendingOperations()
        let pending = Array(requests.values)
        for task in pending { await task.value }
    }
    private func startRequest(_ action: @escaping @MainActor () async -> Void) {
        let id = UUID()
        requests[id] = Task { @MainActor [weak self] in
            guard !Task.isCancelled else { self?.requests[id] = nil; return }
            await action()
            self?.requests[id] = nil
        }
    }
    private func isCurrent(_ current: Int) -> Bool {
        !Task.isCancelled && !suspended && epoch == current &&
            SessionStore.shared.userId == owner && AppConfig.baseURL.absoluteString == origin
    }
    func updateSearchResults(for searchController: UISearchController) { load(reset: true) }
    private func load(reset: Bool) {
        guard !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        if !reset && busy { return }
        requests.values.forEach { $0.cancel() }
        epoch += 1; let current = epoch
        let query = search.searchBar.text ?? "", next = reset ? nil : cursor
        if reset { items = []; cursor = nil }
        busy = true; tableView.reloadData()
        startRequest { [weak self] in
            guard let self else { return }
            do {
                let page = try await self.api.secretaryPersonalityPage(search: query, cursor: next)
                guard self.isCurrent(current) else { return }
                self.items += page.items; self.cursor = page.nextCursor
                self.busy = false; self.tableView.reloadData()
            } catch {
                guard self.isCurrent(current) else { return }
                self.busy = false; self.tableView.reloadData(); self.show(error.localizedDescription)
            }
        }
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        1 + items.count + ((cursor != nil || busy) ? 1 : 0)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        if indexPath.row == 0 { cell.textLabel?.text = text("none"); cell.detailTextLabel?.text = text("legacy") }
        else if indexPath.row <= items.count {
            let item = items[indexPath.row - 1]
            cell.textLabel?.text = item.name; cell.detailTextLabel?.text = item.description
            cell.accessoryType = .disclosureIndicator
        } else { cell.textLabel?.text = text(busy ? "loading" : "more") }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !busy, !suspended, viewIfLoaded?.window != nil,
              SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        if indexPath.row == 0 {
            onSelected?(nil, nil); navigationController?.popViewController(animated: true); return
        }
        guard indexPath.row <= items.count else { load(reset: false); return }
        let item = items[indexPath.row - 1]
        let selectedEpoch = epoch
        busy = true; tableView.reloadData()
        startRequest { [weak self] in
            guard let self else { return }
            do {
                let detail = try await self.api.secretaryPersonalityDetails(id: item.id)
                guard self.isCurrent(selectedEpoch),
                      self.navigationController?.topViewController === self else { return }
                guard detail.personality.status == "available",
                      let version = detail.versions.first(where: { $0.version == detail.personality.currentVersion })
                else { throw APIError.decoding }
                self.onSelected?(item.id, version)
                self.navigationController?.popViewController(animated: true)
            } catch {
                guard self.isCurrent(selectedEpoch) else { return }
                self.busy = false; self.tableView.reloadData(); self.show(error.localizedDescription)
            }
        }
    }
    private func show(_ message: String) {
        guard !suspended, SessionStore.shared.userId == owner,
              AppConfig.baseURL.absoluteString == origin else { return }
        pendingError = message
        guard appeared, viewIfLoaded?.window != nil, navigationController?.topViewController === self,
              presentedViewController == nil, !isBeingDismissed else { return }
        pendingError = nil
        let alert = UIAlertController(title: text("error"), message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("ok"), style: .default)); present(alert, animated: true)
    }
}
