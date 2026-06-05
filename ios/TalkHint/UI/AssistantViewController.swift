import UIKit

/// The "Assistant" tab. Lets the user pick a built-in mode, choose the hint
/// language, set a default call goal, and navigate to template/prompt
/// management. Mode, language and goal are persisted in `SessionStore` and
/// pushed to the live `/ui` socket on every call (see `CallHintStream`).
final class AssistantViewController: UITableViewController {

    private enum Section: Int, CaseIterable {
        case mode
        case language
        case goal
        case library
    }

    private let modes = SessionStore.availableModes
    private let languages = SessionStore.availableLanguages

    init() {
        super.init(style: .insetGrouped)
        title = "Assistant"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-assistant"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        tableView.reloadData()
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .mode: return modes.count
        case .language: return languages.count
        case .goal: return 1
        case .library: return 2
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .mode: return "Mode"
        case .language: return "Language"
        case .goal: return "Call goal"
        case .library: return "Prompts"
        }
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .goal: return "Applied to your next call to keep the assistant on track."
        default: return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.accessoryType = .none
        cell.accessoryView = nil
        var config = cell.defaultContentConfiguration()

        switch Section(rawValue: indexPath.section)! {
        case .mode:
            let mode = modes[indexPath.row]
            config.text = mode.name
            cell.accessoryType = (mode.id == SessionStore.shared.activeMode) ? .checkmark : .none
            cell.accessibilityIdentifier = "cell-mode-\(mode.id)"
        case .language:
            let language = languages[indexPath.row]
            config.text = language.name
            cell.accessoryType = (language.code == SessionStore.shared.language) ? .checkmark : .none
            cell.accessibilityIdentifier = "cell-language-\(language.code)"
        case .goal:
            let goal = SessionStore.shared.callGoal.trimmingCharacters(in: .whitespacesAndNewlines)
            config.text = goal.isEmpty ? "Set a call goal" : goal
            config.textProperties.color = goal.isEmpty ? .secondaryLabel : .label
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-goal"
        case .library:
            if indexPath.row == 0 {
                config.text = "Browse templates"
                cell.accessibilityIdentifier = "cell-templates"
            } else {
                config.text = "Manage my prompts"
                cell.accessibilityIdentifier = "cell-prompts"
            }
            cell.accessoryType = .disclosureIndicator
        }

        cell.contentConfiguration = config
        return cell
    }

    // MARK: - Selection

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch Section(rawValue: indexPath.section)! {
        case .mode:
            SessionStore.shared.activeMode = modes[indexPath.row].id
            tableView.reloadSections(IndexSet(integer: Section.mode.rawValue), with: .none)
        case .language:
            SessionStore.shared.language = languages[indexPath.row].code
            tableView.reloadSections(IndexSet(integer: Section.language.rawValue), with: .none)
        case .goal:
            promptForGoal()
        case .library:
            if indexPath.row == 0 {
                navigationController?.pushViewController(TemplatesViewController(), animated: true)
            } else {
                navigationController?.pushViewController(PromptsViewController(), animated: true)
            }
        }
    }

    private func promptForGoal() {
        let alert = UIAlertController(
            title: "Call goal",
            message: "What do you want to achieve on the call? (e.g. book a table)",
            preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = "Book a table for two"
            field.text = SessionStore.shared.callGoal
            field.accessibilityIdentifier = "input-goal"
        }
        alert.addAction(UIAlertAction(title: "Clear", style: .destructive) { [weak self] _ in
            SessionStore.shared.callGoal = ""
            self?.tableView.reloadSections(IndexSet(integer: Section.goal.rawValue), with: .none)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self] _ in
            let text = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            SessionStore.shared.callGoal = text
            self?.tableView.reloadSections(IndexSet(integer: Section.goal.rawValue), with: .none)
        })
        present(alert, animated: true)
    }
}
