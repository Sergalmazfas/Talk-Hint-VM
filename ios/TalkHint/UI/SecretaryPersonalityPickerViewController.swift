import UIKit

/// A paginated server catalog; no hardcoded Katya entry or download-all.
final class SecretaryPersonalityPickerViewController: UITableViewController, UISearchResultsUpdating {
    var onSelected: ((String?, SecretaryPersonalityContent?) -> Void)?
    private var items: [SecretaryPersonalityItem] = []
    private var cursor: String?
    private var busy = false
    private var epoch = 0
    private let search = UISearchController(searchResultsController: nil)
    private func text(_ key: String) -> String { NSLocalizedString("secretary.personality." + key, comment: "") }
    init() { super.init(style: .insetGrouped) }
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
    func updateSearchResults(for searchController: UISearchController) { load(reset: true) }
    private func load(reset: Bool) {
        if !reset && busy { return }
        epoch += 1; let current = epoch
        let query = search.searchBar.text ?? "", next = reset ? nil : cursor
        if reset { items = []; cursor = nil }
        busy = true; tableView.reloadData()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let page = try await APIClient.shared.secretaryPersonalityPage(search: query, cursor: next)
                guard self.epoch == current else { return }
                self.items += page.items; self.cursor = page.nextCursor
                self.busy = false; self.tableView.reloadData()
            } catch {
                guard self.epoch == current else { return }
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
        guard !busy else { return }
        if indexPath.row == 0 {
            onSelected?(nil, nil); navigationController?.popViewController(animated: true); return
        }
        guard indexPath.row <= items.count else { load(reset: false); return }
        let item = items[indexPath.row - 1]
        let selectedEpoch = epoch
        busy = true; tableView.reloadData()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let detail = try await APIClient.shared.secretaryPersonalityDetails(id: item.id)
                guard self.epoch == selectedEpoch, self.navigationController != nil else { return }
                guard detail.personality.status == "available",
                      let version = detail.versions.first(where: { $0.version == detail.personality.currentVersion })
                else { throw APIError.decoding }
                self.onSelected?(item.id, version)
                self.navigationController?.popViewController(animated: true)
            } catch { self.busy = false; self.tableView.reloadData(); self.show(error.localizedDescription) }
        }
    }
    private func show(_ message: String) {
        let alert = UIAlertController(title: text("error"), message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("ok"), style: .default)); present(alert, animated: true)
    }
}
