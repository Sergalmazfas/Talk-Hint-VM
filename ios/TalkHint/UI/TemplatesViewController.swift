import UIKit

/// Lists the built-in prompt templates from the backend. Tapping a template
/// offers to save it as one of the user's own prompts (using the content for
/// their selected language).
final class TemplatesViewController: UITableViewController {

    private var templates: [APIClient.PromptTemplate] = []
    private let refresh = UIRefreshControl()

    init() {
        super.init(style: .insetGrouped)
        title = NSLocalizedString("templates.title", comment: "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-templates"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
        reload()
    }

    @objc private func reload() {
        Task {
            do {
                let loaded = try await APIClient.shared.templates()
                await MainActor.run {
                    self.templates = loaded
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

    // MARK: - Table data

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(templates.count, 1)
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var config = cell.defaultContentConfiguration()

        if templates.isEmpty {
            config.text = NSLocalizedString("templates.empty", comment: "")
            config.textProperties.color = .secondaryLabel
            cell.selectionStyle = .none
            cell.accessoryType = .none
            cell.accessibilityIdentifier = "cell-templates-empty"
            cell.contentConfiguration = config
            return cell
        }

        let template = templates[indexPath.row]
        config.text = template.name
        if !template.category.isEmpty {
            config.secondaryText = template.category
            config.secondaryTextProperties.color = .secondaryLabel
        }
        cell.selectionStyle = .default
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "cell-template-\(template.id)"
        cell.contentConfiguration = config
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !templates.isEmpty else { return }
        let template = templates[indexPath.row]

        let alert = UIAlertController(
            title: template.name,
            message: template.content(for: SessionStore.shared.language),
            preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: NSLocalizedString("templates.save_as_prompt", comment: ""), style: .default) { [weak self] _ in
            self?.saveAsPrompt(template)
        })
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        if let popover = alert.popoverPresentationController,
           let cell = tableView.cellForRow(at: indexPath) {
            popover.sourceView = cell
            popover.sourceRect = cell.bounds
        }
        present(alert, animated: true)
    }

    private func saveAsPrompt(_ template: APIClient.PromptTemplate) {
        let content = template.content(for: SessionStore.shared.language)
        Task {
            do {
                try await APIClient.shared.createPrompt(name: template.name, content: content)
                await MainActor.run {
                    let done = UIAlertController(title: NSLocalizedString("templates.saved.title", comment: ""),
                                                 message: String(format: NSLocalizedString("templates.saved.message", comment: ""), template.name),
                                                 preferredStyle: .alert)
                    done.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                    self.present(done, animated: true)
                }
            } catch {
                await MainActor.run { self.showError(error) }
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
