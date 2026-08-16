import UIKit

/// Lists the user's saved prompts. The user can create, edit, delete, and pick
/// which prompt is active. "Active" is persisted server-side (`isActive`) and
/// mirrored locally in `SessionStore.activePromptId` for a quick checkmark.
final class PromptsViewController: UITableViewController {

    private var prompts: [APIClient.UserPrompt] = []
    private let refresh = UIRefreshControl()

    init() {
        super.init(style: .insetGrouped)
        title = NSLocalizedString("prompts.title", comment: "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-prompts"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .add, target: self, action: #selector(addTapped))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-add-prompt"
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
        Task {
            do {
                let loaded = try await APIClient.shared.prompts()
                await MainActor.run {
                    self.prompts = loaded
                    self.syncActiveSelection()
                    self.tableView.reloadData()
                    self.refresh.endRefreshing()
                }
            } catch {
                await MainActor.run {
                    self.refresh.endRefreshing()
                    self.showError(error)
                }
            }
        }
    }

    /// Keeps the local active-prompt pointer in step with the server's isActive
    /// flag (falls back to the locally remembered id when present in the list).
    private func syncActiveSelection() {
        if let serverActive = prompts.first(where: { $0.isActive }) {
            SessionStore.shared.activePromptId = serverActive.id
        } else if let local = SessionStore.shared.activePromptId,
                  !prompts.contains(where: { $0.id == local }) {
            SessionStore.shared.activePromptId = nil
        }
    }

    @objc private func addTapped() {
        let editor = PromptEditorViewController(prompt: nil)
        editor.onSaved = { [weak self] in self?.reload() }
        navigationController?.pushViewController(editor, animated: true)
    }

    // MARK: - Table data

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(prompts.count, 1)
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var config = cell.defaultContentConfiguration()

        if prompts.isEmpty {
            config.text = NSLocalizedString("prompts.empty", comment: "")
            config.textProperties.color = .secondaryLabel
            cell.accessoryType = .none
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "cell-prompts-empty"
            cell.contentConfiguration = config
            return cell
        }

        let prompt = prompts[indexPath.row]
        config.text = prompt.name
        config.secondaryText = prompt.content
        config.secondaryTextProperties.numberOfLines = 1
        config.secondaryTextProperties.color = .secondaryLabel
        cell.selectionStyle = .default
        cell.accessoryType = (prompt.id == SessionStore.shared.activePromptId) ? .checkmark : .detailButton
        cell.accessibilityIdentifier = "cell-prompt-\(prompt.id)"
        cell.contentConfiguration = config
        return cell
    }

    // MARK: - Selection / activation

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !prompts.isEmpty else { return }
        activate(prompts[indexPath.row])
    }

    override func tableView(_ tableView: UITableView, accessoryButtonTappedForRowWith indexPath: IndexPath) {
        guard !prompts.isEmpty else { return }
        let editor = PromptEditorViewController(prompt: prompts[indexPath.row])
        editor.onSaved = { [weak self] in self?.reload() }
        navigationController?.pushViewController(editor, animated: true)
    }

    private func activate(_ prompt: APIClient.UserPrompt) {
        let previousId = SessionStore.shared.activePromptId
        guard previousId != prompt.id else { return }
        SessionStore.shared.activePromptId = prompt.id
        tableView.reloadData()

        Task {
            do {
                try await APIClient.shared.updatePrompt(id: prompt.id, isActive: true)
                if let previousId = previousId, previousId != prompt.id {
                    try? await APIClient.shared.updatePrompt(id: previousId, isActive: false)
                }
                await MainActor.run { self.reload() }
            } catch {
                await MainActor.run {
                    SessionStore.shared.activePromptId = previousId
                    self.tableView.reloadData()
                    self.showError(error)
                }
            }
        }
    }

    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath)
    -> UISwipeActionsConfiguration? {
        guard !prompts.isEmpty else { return nil }
        let prompt = prompts[indexPath.row]
        let delete = UIContextualAction(style: .destructive, title: NSLocalizedString("common.delete", comment: "")) { [weak self] _, _, done in
            self?.delete(prompt, completion: done)
        }
        return UISwipeActionsConfiguration(actions: [delete])
    }

    /// Edit is also offered as a leading swipe so the active prompt (whose
    /// accessory is a checkmark, not the detail button) can still be edited.
    override func tableView(_ tableView: UITableView,
                            leadingSwipeActionsConfigurationForRowAt indexPath: IndexPath)
    -> UISwipeActionsConfiguration? {
        guard !prompts.isEmpty else { return nil }
        let prompt = prompts[indexPath.row]
        let edit = UIContextualAction(style: .normal, title: NSLocalizedString("common.edit", comment: "")) { [weak self] _, _, done in
            guard let self = self else { done(false); return }
            let editor = PromptEditorViewController(prompt: prompt)
            editor.onSaved = { [weak self] in self?.reload() }
            self.navigationController?.pushViewController(editor, animated: true)
            done(true)
        }
        edit.backgroundColor = .systemBlue
        return UISwipeActionsConfiguration(actions: [edit])
    }

    private func delete(_ prompt: APIClient.UserPrompt, completion: @escaping (Bool) -> Void) {
        Task {
            do {
                try await APIClient.shared.deletePrompt(id: prompt.id)
                await MainActor.run {
                    if SessionStore.shared.activePromptId == prompt.id {
                        SessionStore.shared.activePromptId = nil
                    }
                    completion(true)
                    self.reload()
                }
            } catch {
                await MainActor.run {
                    completion(false)
                    self.showError(error)
                }
            }
        }
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("common.error.title", comment: ""),
                                      message: error.localizedDescription,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
