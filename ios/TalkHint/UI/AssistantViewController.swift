import UIKit

/// The "Assistant" tab. Lets the user pick a built-in mode, choose the hint
/// language, set a default call goal, and navigate to template/prompt
/// management. Mode, language and goal are persisted in `SessionStore` and
/// pushed to the live `/ui` socket on every call (see `CallHintStream`).
final class AssistantViewController: UITableViewController {

    private enum Section: Int, CaseIterable {
        case tutor
        case mode
        case language
        case goal
        case context
        case contacts
        case cards
        case library
    }

    private let modes = SessionStore.availableModes
    private let languages = SessionStore.availableLanguages

    init() {
        super.init(style: .insetGrouped)
        title = NSLocalizedString("assistant.title", comment: "")
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
        refreshUserContext()
    }

    /// Pulls the latest "My Context" from the backend so the row reflects what
    /// is actually injected into calls (and stays in sync across devices).
    private func refreshUserContext() {
        Task { @MainActor in
            if let context = try? await APIClient.shared.userContext() {
                SessionStore.shared.userContext = context
                tableView.reloadSections(IndexSet(integer: Section.context.rawValue), with: .none)
            }
        }
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .tutor: return 1
        case .mode: return modes.count
        case .language: return languages.count
        case .goal: return 1
        case .context: return 1
        case .contacts: return 1
        case .cards: return 1
        case .library: return 2
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .tutor: return NSLocalizedString("assistant.section.tutor", comment: "")
        case .mode: return NSLocalizedString("assistant.section.mode", comment: "")
        case .language: return NSLocalizedString("assistant.section.language", comment: "")
        case .goal: return NSLocalizedString("assistant.section.goal", comment: "")
        case .context: return NSLocalizedString("assistant.section.context", comment: "")
        case .contacts: return NSLocalizedString("assistant.section.contacts", comment: "")
        case .cards: return NSLocalizedString("assistant.section.cards", comment: "")
        case .library: return NSLocalizedString("assistant.section.prompts", comment: "")
        }
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .tutor: return NSLocalizedString("assistant.footer.tutor", comment: "")
        case .goal: return NSLocalizedString("assistant.footer.goal", comment: "")
        case .context: return NSLocalizedString("assistant.footer.context", comment: "")
        case .contacts: return NSLocalizedString("assistant.footer.contacts", comment: "")
        case .cards: return NSLocalizedString("assistant.footer.cards", comment: "")
        default: return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.accessoryType = .none
        cell.accessoryView = nil
        var config = cell.defaultContentConfiguration()

        switch Section(rawValue: indexPath.section)! {
        case .tutor:
            config.text = NSLocalizedString("assistant.tutor.name", comment: "")
            config.secondaryText = NSLocalizedString("assistant.tutor.subtitle", comment: "")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-tutor"
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
            config.text = goal.isEmpty ? NSLocalizedString("assistant.goal.set", comment: "") : goal
            config.textProperties.color = goal.isEmpty ? .secondaryLabel : .label
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-goal"
        case .context:
            let context = SessionStore.shared.userContext.trimmingCharacters(in: .whitespacesAndNewlines)
            config.text = context.isEmpty ? NSLocalizedString("assistant.context.set", comment: "") : context
            config.textProperties.color = context.isEmpty ? .secondaryLabel : .label
            config.textProperties.numberOfLines = 3
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-context"
        case .contacts:
            config.text = NSLocalizedString("assistant.manage_contacts", comment: "")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-contacts"
        case .cards:
            config.text = NSLocalizedString("assistant.manage_cards", comment: "")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "cell-cards"
        case .library:
            if indexPath.row == 0 {
                config.text = NSLocalizedString("assistant.browse_templates", comment: "")
                cell.accessibilityIdentifier = "cell-templates"
            } else {
                config.text = NSLocalizedString("assistant.manage_prompts", comment: "")
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
        case .tutor:
            navigationController?.pushViewController(TutorViewController(), animated: true)
        case .mode:
            SessionStore.shared.activeMode = modes[indexPath.row].id
            tableView.reloadSections(IndexSet(integer: Section.mode.rawValue), with: .none)
        case .language:
            SessionStore.shared.language = languages[indexPath.row].code
            tableView.reloadSections(IndexSet(integer: Section.language.rawValue), with: .none)
        case .goal:
            promptForGoal()
        case .context:
            let editor = ContextEditorViewController()
            navigationController?.pushViewController(editor, animated: true)
        case .contacts:
            navigationController?.pushViewController(ContactsViewController(), animated: true)
        case .cards:
            navigationController?.pushViewController(KnowledgeCardsViewController(), animated: true)
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
            title: NSLocalizedString("assistant.goal.prompt.title", comment: ""),
            message: NSLocalizedString("assistant.goal.prompt.message", comment: ""),
            preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = NSLocalizedString("assistant.goal.prompt.placeholder", comment: "")
            field.text = SessionStore.shared.callGoal
            field.accessibilityIdentifier = "input-goal"
        }
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.clear", comment: ""), style: .destructive) { [weak self] _ in
            SessionStore.shared.callGoal = ""
            self?.tableView.reloadSections(IndexSet(integer: Section.goal.rawValue), with: .none)
        })
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.save", comment: ""), style: .default) { [weak self] _ in
            let text = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            SessionStore.shared.callGoal = text
            self?.tableView.reloadSections(IndexSet(integer: Section.goal.rawValue), with: .none)
        })
        present(alert, animated: true)
    }
}

/// Full-screen editor for the user's "My Context". Provides a multi-line text
/// view, three quick-start templates, and a Save button that persists to the
/// backend (`POST /api/user/context`) and mirrors the value into SessionStore.
final class ContextEditorViewController: UIViewController {

    /// Quick-start templates mirrored from the web `/app` UI.
    private static let templates: [(title: String, body: String)] = [
        (NSLocalizedString("context_editor.template.cdl.title", comment: ""), NSLocalizedString("context_editor.template.cdl.body", comment: "")),
        (NSLocalizedString("context_editor.template.massage.title", comment: ""), NSLocalizedString("context_editor.template.massage.body", comment: "")),
        (NSLocalizedString("context_editor.template.universal.title", comment: ""), NSLocalizedString("context_editor.template.universal.body", comment: "")),
    ]

    /// Mirrors the backend `MAX_USER_CONTEXT_LENGTH` so the UI fails fast.
    private static let maxLength = 4000

    private let textView = UITextView()
    private let placeholderLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("context_editor.title", comment: "")
        view.backgroundColor = .systemGroupedBackground

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .save, target: self, action: #selector(save))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-context-save"

        let templateStack = UIStackView()
        templateStack.axis = .horizontal
        templateStack.distribution = .fillEqually
        templateStack.spacing = 8
        templateStack.translatesAutoresizingMaskIntoConstraints = false
        for (index, template) in Self.templates.enumerated() {
            let button = UIButton(type: .system)
            button.setTitle(template.title, for: .normal)
            button.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
            button.backgroundColor = .secondarySystemGroupedBackground
            button.layer.cornerRadius = 8
            button.tag = index
            button.accessibilityIdentifier = "button-context-template-\(index)"
            button.addTarget(self, action: #selector(applyTemplate(_:)), for: .touchUpInside)
            templateStack.addArrangedSubview(button)
        }

        textView.font = .preferredFont(forTextStyle: .body)
        textView.backgroundColor = .secondarySystemGroupedBackground
        textView.layer.cornerRadius = 10
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.accessibilityIdentifier = "input-context"
        textView.delegate = self
        textView.text = SessionStore.shared.userContext

        placeholderLabel.text = NSLocalizedString("context_editor.placeholder", comment: "")
        placeholderLabel.font = .preferredFont(forTextStyle: .body)
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.numberOfLines = 0
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        placeholderLabel.isHidden = !textView.text.isEmpty

        view.addSubview(templateStack)
        view.addSubview(textView)
        textView.addSubview(placeholderLabel)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            templateStack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            templateStack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            templateStack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            templateStack.heightAnchor.constraint(equalToConstant: 40),

            textView.topAnchor.constraint(equalTo: templateStack.bottomAnchor, constant: 16),
            textView.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            textView.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            textView.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),

            placeholderLabel.topAnchor.constraint(equalTo: textView.topAnchor, constant: 12),
            placeholderLabel.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 16),
            placeholderLabel.trailingAnchor.constraint(equalTo: textView.trailingAnchor, constant: -16),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        textView.becomeFirstResponder()
    }

    @objc private func applyTemplate(_ sender: UIButton) {
        let template = Self.templates[sender.tag]
        textView.text = template.body
        placeholderLabel.isHidden = true
    }

    @objc private func save() {
        let text = String(textView.text.prefix(Self.maxLength))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        navigationItem.rightBarButtonItem?.isEnabled = false
        Task { @MainActor in
            do {
                let stored = try await APIClient.shared.setUserContext(text)
                SessionStore.shared.userContext = stored
                navigationController?.popViewController(animated: true)
            } catch {
                navigationItem.rightBarButtonItem?.isEnabled = true
                let alert = UIAlertController(
                    title: NSLocalizedString("common.save_failed", comment: ""),
                    message: error.localizedDescription,
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                present(alert, animated: true)
            }
        }
    }
}

extension ContextEditorViewController: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) {
        placeholderLabel.isHidden = !textView.text.isEmpty
        if textView.text.count > Self.maxLength {
            textView.text = String(textView.text.prefix(Self.maxLength))
        }
    }
}
