import UIKit

/// Lists the per-caller memories the assistant has saved for the signed-in user
/// (`GET /api/contacts`). Each row shows the phone number plus a short summary;
/// tapping opens an editor, and swipe-to-delete removes the memory entirely.
/// Mirrors the web `/app` "Contacts" screen.
final class ContactsViewController: UITableViewController {

    private var contacts: [APIClient.ContactMemoryItem] = []
    private var loaded = false

    init() {
        super.init(style: .insetGrouped)
        title = NSLocalizedString("contacts.title", comment: "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-contacts"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
        Task { @MainActor in
            do {
                contacts = try await APIClient.shared.contacts()
            } catch {
                contacts = []
            }
            loaded = true
            tableView.refreshControl?.endRefreshing()
            tableView.reloadData()
        }
    }

    // MARK: - Table data

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(contacts.count, loaded ? 1 : 0)
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        NSLocalizedString("contacts.footer", comment: "")
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var config = cell.defaultContentConfiguration()

        if contacts.isEmpty {
            config.text = NSLocalizedString("contacts.empty", comment: "")
            config.textProperties.color = .secondaryLabel
            cell.accessoryType = .none
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "cell-contacts-empty"
            cell.contentConfiguration = config
            return cell
        }

        let contact = contacts[indexPath.row]
        let trimmedName = contact.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        var detailParts: [String] = []
        if let name = trimmedName, !name.isEmpty {
            config.text = name
            detailParts.append(contact.phoneNumber)
        } else {
            config.text = contact.phoneNumber
        }
        if let importance = contact.importance?.trimmingCharacters(in: .whitespacesAndNewlines), !importance.isEmpty {
            detailParts.append(String(format: NSLocalizedString("contacts.importance_badge", comment: ""), importance))
        }
        if let summary = contact.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !summary.isEmpty {
            detailParts.append(summary)
        }
        config.secondaryText = detailParts.isEmpty ? NSLocalizedString("contacts.no_details", comment: "") : detailParts.joined(separator: " · ")
        config.secondaryTextProperties.numberOfLines = 2
        config.secondaryTextProperties.color = .secondaryLabel
        cell.accessoryType = .disclosureIndicator
        cell.selectionStyle = .default
        cell.accessibilityIdentifier = "cell-contact-\(contact.id)"
        cell.contentConfiguration = config
        return cell
    }

    // MARK: - Selection / delete

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !contacts.isEmpty else { return }
        let editor = ContactEditorViewController(contact: contacts[indexPath.row]) { [weak self] updated in
            guard let self = self else { return }
            if let idx = self.contacts.firstIndex(where: { $0.id == updated.id }) {
                self.contacts[idx] = updated
                self.tableView.reloadData()
            }
        }
        navigationController?.pushViewController(editor, animated: true)
    }

    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool {
        !contacts.isEmpty
    }

    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
        guard editingStyle == .delete, !contacts.isEmpty else { return }
        let contact = contacts[indexPath.row]
        let alert = UIAlertController(
            title: NSLocalizedString("contacts.delete.title", comment: ""),
            message: String(format: NSLocalizedString("contacts.delete.message", comment: ""), contact.phoneNumber),
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.delete", comment: ""), style: .destructive) { [weak self] _ in
            self?.performDelete(contact)
        })
        present(alert, animated: true)
    }

    private func performDelete(_ contact: APIClient.ContactMemoryItem) {
        Task { @MainActor in
            do {
                try await APIClient.shared.deleteContact(id: contact.id)
                contacts.removeAll { $0.id == contact.id }
                tableView.reloadData()
            } catch {
                let alert = UIAlertController(
                    title: NSLocalizedString("common.delete_failed", comment: ""),
                    message: error.localizedDescription,
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                present(alert, animated: true)
            }
        }
    }
}

/// Editor for a single contact memory: importance, summary and notes. Saves via
/// `PUT /api/contacts/:id` and calls back with the stored row so the list can
/// update in place. Mirrors the web "Edit contact" modal.
final class ContactEditorViewController: UIViewController {

    private let contact: APIClient.ContactMemoryItem
    private let onSave: (APIClient.ContactMemoryItem) -> Void

    private let nameField = UITextField()
    private let importanceField = UITextField()
    private let summaryView = UITextView()
    private let notesView = UITextView()

    init(contact: APIClient.ContactMemoryItem, onSave: @escaping (APIClient.ContactMemoryItem) -> Void) {
        self.contact = contact
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = contact.phoneNumber
        view.backgroundColor = .systemGroupedBackground

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .save, target: self, action: #selector(save))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-contact-save"

        let nameLabel = makeLabel(NSLocalizedString("contact_editor.name", comment: ""))
        nameField.text = contact.name
        nameField.placeholder = NSLocalizedString("contact_editor.name.placeholder", comment: "")
        nameField.borderStyle = .roundedRect
        nameField.backgroundColor = .secondarySystemGroupedBackground
        nameField.translatesAutoresizingMaskIntoConstraints = false
        nameField.accessibilityIdentifier = "input-contact-name"

        let importanceLabel = makeLabel(NSLocalizedString("contact_editor.importance", comment: ""))
        importanceField.text = contact.importance
        importanceField.placeholder = NSLocalizedString("contact_editor.importance.placeholder", comment: "")
        importanceField.borderStyle = .roundedRect
        importanceField.backgroundColor = .secondarySystemGroupedBackground
        importanceField.translatesAutoresizingMaskIntoConstraints = false
        importanceField.accessibilityIdentifier = "input-contact-importance"

        let summaryLabel = makeLabel(NSLocalizedString("contact_editor.summary", comment: ""))
        configureTextView(summaryView, text: contact.summary, identifier: "input-contact-summary")

        let notesLabel = makeLabel(NSLocalizedString("contact_editor.notes", comment: ""))
        configureTextView(notesView, text: contact.notes, identifier: "input-contact-notes")

        let stack = UIStackView(arrangedSubviews: [
            nameLabel, nameField,
            importanceLabel, importanceField,
            summaryLabel, summaryView,
            notesLabel, notesView,
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.setCustomSpacing(20, after: nameField)
        stack.setCustomSpacing(20, after: importanceField)
        stack.setCustomSpacing(20, after: summaryView)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            nameField.heightAnchor.constraint(equalToConstant: 44),
            importanceField.heightAnchor.constraint(equalToConstant: 44),
            summaryView.heightAnchor.constraint(equalToConstant: 120),
            notesView.heightAnchor.constraint(equalToConstant: 120),
        ])
    }

    private func makeLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .headline)
        return label
    }

    private func configureTextView(_ textView: UITextView, text: String?, identifier: String) {
        textView.text = text
        textView.font = .preferredFont(forTextStyle: .body)
        textView.backgroundColor = .secondarySystemGroupedBackground
        textView.layer.cornerRadius = 10
        textView.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.accessibilityIdentifier = identifier
    }

    @objc private func save() {
        navigationItem.rightBarButtonItem?.isEnabled = false
        let name = nameField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let importance = importanceField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let summary = summaryView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = notesView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { @MainActor in
            do {
                let updated = try await APIClient.shared.updateContact(
                    id: contact.id, name: name, summary: summary, notes: notes, importance: importance)
                onSave(updated)
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
