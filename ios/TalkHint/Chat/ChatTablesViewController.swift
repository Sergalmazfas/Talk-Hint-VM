import UIKit

@MainActor
final class ChatTablesViewController: UITableViewController, UISearchBarDelegate {
    private let api: APIClient
    private let conversationId: String
    private let valid: () -> Bool
    private var books: [ChatTableBook] = []
    private let search = UISearchBar()
    private var nextOffset: Int?
    private var loadTask: Task<Void, Never>?
    private var exportTask: Task<Void, Never>?
    private var generation = UUID()
    private var attempts = ChatTableExportAttempts()
    private var exportedFiles: [URL] = []
    private var busy = false
    init(api: APIClient, conversationId: String, valid: @escaping () -> Bool) {
        self.api = api; self.conversationId = conversationId; self.valid = valid
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("chat.tables.title", comment: "")
        search.delegate = self
        search.placeholder = NSLocalizedString("chat.tables.search", comment: "")
        search.sizeToFit(); tableView.tableHeaderView = search
        tableView.accessibilityIdentifier = "chat-tables-list"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(refresh))
        refresh()
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Sharing presents a sheet; do not delete its file before it has read it.
        if isBeingDismissed || navigationController?.isBeingDismissed == true {
            generation = UUID(); loadTask?.cancel(); exportTask?.cancel()
        }
    }
    deinit { exportedFiles.forEach { try? FileManager.default.removeItem(at: $0.deletingLastPathComponent()) } }
    @objc private func close() {
        generation = UUID(); loadTask?.cancel(); exportTask?.cancel()
        dismiss(animated: true)
    }
    @objc private func refresh() { load(more: false) }
    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { load(more: false) }
    private func load(more: Bool) {
        loadTask?.cancel()
        let epoch = UUID(); generation = epoch
        let query = search.text ?? "", offset = more ? (nextOffset ?? 0) : 0
        loadTask = Task {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                let page = try await api.chatTables(search: query, offset: offset)
                guard valid(), !Task.isCancelled, generation == epoch else { return }
                books = more ? books + page.books : page.books
                nextOffset = page.more ? page.nextOffset : nil
                tableView.backgroundView = nil
                if books.isEmpty {
                    let label = UILabel(); label.textAlignment = .center
                    label.text = NSLocalizedString("chat.tables.empty", comment: "")
                    tableView.backgroundView = label
                }
                tableView.reloadData()
            } catch {
                guard !Task.isCancelled, generation == epoch, valid() else { return }
                showError(error)
            }
        }
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        books.count + (nextOffset == nil ? 0 : 1)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        if indexPath.row == books.count { cell.textLabel?.text = NSLocalizedString("chat.tables.more", comment: "") }
        else {
            let book = books[indexPath.row]
            cell.textLabel?.text = book.name
            cell.detailTextLabel?.text = "\(book.scope) · r\(book.revision)"
            cell.accessoryType = .disclosureIndicator
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.row == books.count { load(more: true); return }
        let book = books[indexPath.row]
        let menu = UIAlertController(title: book.name, message: nil, preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: NSLocalizedString("chat.tables.share", comment: ""), style: .default) { [weak self] _ in self?.export(book) })
        menu.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        menu.popoverPresentationController?.sourceView = tableView.cellForRow(at: indexPath)
        present(menu, animated: true)
    }
    private func export(_ book: ChatTableBook) {
        guard valid(), !busy else { return }
        busy = true; title = NSLocalizedString("chat.tables.exporting", comment: "")
        let key = "\(book.id):\(book.revision)"
        let requestId = attempts.request(for: key)
        exportTask = Task {
            defer { busy = false; title = NSLocalizedString("chat.tables.title", comment: "") }
            do {
                let jobId: String
                if let known = attempts.job(for: key) { jobId = known }
                else {
                    let receipt = try await api.chatExportTable(book, conversationId: conversationId, requestId: requestId)
                    jobId = receipt.jobId; attempts.remember(job: jobId, for: key)
                }
                for _ in 0..<120 {
                    try Task.checkCancellation()
                    guard valid() else { throw CancellationError() }
                    let job = try await api.chatTableJob(jobId)
                    if job.status == "complete" {
                        guard job.result?.revision == book.revision, let path = job.result?.downloadUrl else { throw APIError.decoding }
                        let data = try await api.chatBinary(path)
                        try Task.checkCancellation()
                        guard valid() else { throw CancellationError() }
                        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                        let url = directory.appendingPathComponent(ChatTableExportAttempts.filename(book.name))
                        try data.write(to: url, options: .atomic); exportedFiles.append(url)
                        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                        share.popoverPresentationController?.sourceView = view
                        share.popoverPresentationController?.sourceRect = view.bounds
                        present(share, animated: true)
                        return
                    }
                    guard ["queued", "running"].contains(job.status) else {
                        attempts.observed(status: job.status, for: key)
                        throw APIError.http(409, job.error_code ?? (job.status == "purged" ? "TABLE_PURGED" : "TABLE_EXPORT_FAILED"))
                    }
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                }
                throw APIError.http(202, "TABLE_EXPORT_NOT_READY")
            } catch {
                if !(error is CancellationError), valid() {
                    showError(error, retry: { [weak self] in self?.export(book) })
                }
            }
        }
    }
    private func showError(_ error: Error, retry: (() -> Void)? = nil) {
        let alert = UIAlertController(title: NSLocalizedString("chat.tables.title", comment: ""),
                                      message: ChatFeatureErrors.message(error, feature: .tables), preferredStyle: .alert)
        if let retry {
            alert.addAction(UIAlertAction(title: NSLocalizedString("chat.tables.retry", comment: ""), style: .default) { _ in retry() })
        }
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
