import UIKit

struct ChatDocumentList: Decodable {
    struct Document: Decodable {
        let id: String
        let type_id: String?
        let status: String
        let error_code: String?
        let pinned: Bool
        let hidden_at: String?
        let file_deleted_at: String?
        let file_deletion_started_at: String?
        let closed_at: String?
    }
    struct Kind: Decodable { let id: String; let title: String }
    let documents: [Document]
    let types: [Kind]
    let nextOffset: Int?
}
struct ChatDocumentDetail: Decodable {
    struct Version: Decodable { let id: String; let created_at: String }
    struct File: Decodable { let id: String; let name: String; let status: String }
    let versions: [Version]
    let files: [File]
}
extension APIClient {
    func startChatDocuments(conversation: String, ids: [String], requestId: UUID) async throws -> ChatMessagePair {
        let data = try await request("/api/chat-v1/conversations/\(conversation)/documents", method: "POST",
            json: ["clientRequestId": requestId.uuidString.lowercased(), "attachmentIds": ids], authenticated: true)
        return try JSONDecoder().decode(ChatMessagePair.self, from: data)
    }
    func chatDocuments(conversation: String, offset: Int = 0) async throws -> ChatDocumentList {
        let data = try await request("/api/chat-v1/conversations/\(conversation)/documents", method: "GET",
            json: nil, authenticated: true, queryItems: [
                URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "includeHidden", value: "1")])
        return try JSONDecoder().decode(ChatDocumentList.self, from: data)
    }
    func chatDocumentDetail(conversation: String, document: String) async throws -> ChatDocumentDetail {
        let data = try await request("/api/chat-v1/conversations/\(conversation)/documents/\(document)", method: "GET",
            json: nil, authenticated: true)
        return try JSONDecoder().decode(ChatDocumentDetail.self, from: data)
    }
    func chatDocumentCommand(conversation: String, document: String, path: String, body: [String: Any]) async throws {
        _ = try await request("/api/chat-v1/conversations/\(conversation)/documents/\(document)/\(path)",
            method: "POST", json: body, authenticated: true)
    }
}

/// Uses existing memory cards for Save/Cancel. This screen never confirms memory.
@MainActor
final class ChatDocumentsViewController: UITableViewController {
    private let api: APIClient
    private let conversation: String
    private let validOwner: () -> Bool
    private let download: (String) -> Void
    private var documents: [ChatDocumentList.Document] = []
    private var kinds: [ChatDocumentList.Kind] = []
    private var nextOffset: Int?
    private var busy = false
    private var task: Task<Void, Never>?
    init(api: APIClient, conversation: String, validOwner: @escaping () -> Bool, download: @escaping (String) -> Void) {
        self.api = api; self.conversation = conversation; self.validOwner = validOwner; self.download = download
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = Self.tr("title")
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
        refreshControl = UIRefreshControl()
        refreshControl?.addTarget(self, action: #selector(refresh), for: .valueChanged)
        reload()
    }
    deinit { task?.cancel() }
    private static func tr(_ key: String) -> String { NSLocalizedString("chat.documents.\(key)", comment: "") }
    @objc private func close() { dismiss(animated: true) }
    @objc private func refresh() { reload() }
    private func reload(offset: Int = 0) {
        guard validOwner(), !busy else { return }
        busy = true
        task = Task {
            defer { busy = false; refreshControl?.endRefreshing() }
            do {
                let page = try await api.chatDocuments(conversation: conversation, offset: offset)
                guard validOwner(), !Task.isCancelled else { return }
                documents = offset == 0 ? page.documents : documents + page.documents
                kinds = page.types; nextOffset = page.nextOffset
                tableView.reloadData()
            } catch { if validOwner(), !Task.isCancelled { showError() } }
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 1 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        documents.count + (nextOffset == nil ? 0 : 1)
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        Self.tr(documents.isEmpty ? "empty" : "footer")
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        if indexPath.row == documents.count {
            cell.textLabel?.text = Self.tr("more"); return cell
        }
        let d = documents[indexPath.row]
        cell.textLabel?.text = kinds.first(where: { $0.id == d.type_id })?.title ?? Self.tr("unknown")
        var state = d.hidden_at == nil ? d.status : "hidden"
        if d.file_deletion_started_at != nil { state = "deleting" }
        if d.file_deleted_at != nil { state = d.hidden_at == nil ? "originalDeleted" : "hiddenDeleted" }
        cell.detailTextLabel?.text = Self.tr("status.\(state)") + (d.pinned ? " · " + Self.tr("pinned") : "")
            + (d.closed_at != nil ? " · " + Self.tr("closed") : "")
            + (d.error_code.map { "\n\($0)" } ?? "")
        cell.detailTextLabel?.numberOfLines = 0
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard validOwner(), !busy else { return }
        if indexPath.row == documents.count { if let offset = nextOffset { reload(offset: offset) }; return }
        let d = documents[indexPath.row]
        let menu = UIAlertController(title: Self.tr("title"), message: Self.tr("footer"), preferredStyle: .actionSheet)
        func action(_ title: String, destructive: Bool = false, _ run: @escaping () -> Void) {
            menu.addAction(UIAlertAction(title: Self.tr(title), style: destructive ? .destructive : .default) { _ in run() })
        }
        if d.hidden_at != nil {
            if d.file_deleted_at == nil { action("restore") { [weak self] in self?.command(d, operation: "restore") } }
        } else {
            if ["pending", "saved"].contains(d.status) {
                action("proposal") { [weak self] in self?.perform(d, path: "proposal", body: [:]) }
            }
            if d.status == "needs_type" {
                for kind in kinds {
                    menu.addAction(UIAlertAction(title: kind.title, style: .default) { [weak self] _ in
                        self?.perform(d, path: "type", body: ["typeId": kind.id])
                    })
                }
            }
            if d.file_deleted_at == nil && d.file_deletion_started_at == nil {
                action("download") { [weak self] in self?.downloadOriginal(d) }
                action(d.pinned ? "unpin" : "pin") { [weak self] in self?.command(d, operation: d.pinned ? "unpin" : "pin") }
            }
            action("close") { [weak self] in self?.command(d, operation: "close") }
            action("history") { [weak self] in self?.showHistory(d) }
            action("forget", destructive: true) { [weak self] in self?.confirmForget(d) }
        }
        menu.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.cancel", comment: ""), style: .cancel))
        menu.popoverPresentationController?.sourceView = tableView.cellForRow(at: indexPath)
        present(menu, animated: true)
    }
    private func command(_ d: ChatDocumentList.Document, operation: String) {
        perform(d, path: "control", body: ["operation": operation])
    }
    private func perform(_ d: ChatDocumentList.Document, path: String, body: [String: Any]) {
        guard validOwner(), !busy else { return }; busy = true
        task = Task {
            do {
                try await api.chatDocumentCommand(conversation: conversation, document: d.id, path: path, body: body)
                guard validOwner(), !Task.isCancelled else { busy = false; return }
                busy = false; reload()
            } catch { busy = false; if validOwner(), !Task.isCancelled { showError() } }
        }
    }
    private func confirmForget(_ d: ChatDocumentList.Document) {
        let alert = UIAlertController(title: Self.tr("forget"), message: Self.tr("forgetNotice"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: Self.tr("forget"), style: .destructive) { [weak self] _ in self?.command(d, operation: "forget") })
        alert.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.cancel", comment: ""), style: .cancel))
        present(alert, animated: true)
    }
    private func downloadOriginal(_ d: ChatDocumentList.Document) {
        guard validOwner(), !busy else { return }; busy = true
        task = Task {
            defer { busy = false }
            do {
                let detail = try await api.chatDocumentDetail(conversation: conversation, document: d.id)
                guard validOwner(), !Task.isCancelled, let file = detail.files.first(where: { $0.status == "ready" }) else { return }
                let open = download, ownerStillValid = validOwner
                dismiss(animated: true) {
                    guard ownerStillValid() else { return }; open(file.id)
                }
            } catch { if validOwner(), !Task.isCancelled { showError() } }
        }
    }
    private func showHistory(_ d: ChatDocumentList.Document) {
        guard validOwner(), !busy else { return }; busy = true
        task = Task {
            defer { busy = false }
            do {
                let detail = try await api.chatDocumentDetail(conversation: conversation, document: d.id)
                guard validOwner(), !Task.isCancelled else { return }
                let menu = UIAlertController(title: Self.tr("history"), message: Self.tr("rollbackNotice"), preferredStyle: .actionSheet)
                for version in detail.versions {
                    menu.addAction(UIAlertAction(title: version.created_at, style: .default) { [weak self] _ in
                        self?.perform(d, path: "rollback", body: ["versionId": version.id])
                    })
                }
                menu.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.cancel", comment: ""), style: .cancel))
                menu.popoverPresentationController?.sourceView = tableView
                present(menu, animated: true)
            } catch { if validOwner(), !Task.isCancelled { showError() } }
        }
    }
    private func showError() {
        let alert = UIAlertController(title: Self.tr("error"), message: Self.tr("noRetry"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
