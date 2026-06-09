import UIKit

/// Lists the signed-in user's static-context cards (`GET /api/cards`), grouped
/// into Projects and Company / Services. Tapping a row opens the editor; tapping
/// the "+" adds a new card; swipe-to-delete removes one. Mirrors the web `/app`
/// "Static Context" screen.
final class KnowledgeCardsViewController: UITableViewController {

    private let groups: [(type: String, title: String)] = [
        ("project", "Projects"),
        ("company", "Company / Services"),
    ]

    private var cards: [APIClient.KnowledgeCardItem] = []
    private var loaded = false

    init() {
        super.init(style: .insetGrouped)
        title = "Static Context"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-cards"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .add, target: self, action: #selector(addTapped))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-card-add"
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
        Task { @MainActor in
            do {
                cards = try await APIClient.shared.knowledgeCards()
            } catch {
                cards = []
            }
            loaded = true
            tableView.refreshControl?.endRefreshing()
            tableView.reloadData()
        }
    }

    private func cards(for type: String) -> [APIClient.KnowledgeCardItem] {
        cards.filter { $0.cardType == type }
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        groups.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        let count = cards(for: groups[section].type).count
        return max(count, loaded ? 1 : 0)
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        groups[section].title
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == groups.count - 1
            ? "Short facts the assistant always knows on every call. The highest-priority cards are used first."
            : nil
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var config = cell.defaultContentConfiguration()
        let group = cards(for: groups[indexPath.section].type)

        if group.isEmpty {
            config.text = "No cards yet"
            config.textProperties.color = .secondaryLabel
            cell.accessoryType = .none
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "cell-cards-empty-\(groups[indexPath.section].type)"
            cell.contentConfiguration = config
            return cell
        }

        let card = group[indexPath.row]
        config.text = card.title
        config.secondaryText = card.body
        config.secondaryTextProperties.numberOfLines = 2
        config.secondaryTextProperties.color = .secondaryLabel
        cell.accessoryType = .disclosureIndicator
        cell.selectionStyle = .default
        cell.accessibilityIdentifier = "cell-card-\(card.id)"
        cell.contentConfiguration = config
        return cell
    }

    // MARK: - Selection / add / delete

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let group = cards(for: groups[indexPath.section].type)
        guard !group.isEmpty else { return }
        let editor = KnowledgeCardEditorViewController(card: group[indexPath.row]) { [weak self] in
            self?.reload()
        }
        navigationController?.pushViewController(editor, animated: true)
    }

    @objc private func addTapped() {
        let editor = KnowledgeCardEditorViewController(card: nil) { [weak self] in
            self?.reload()
        }
        navigationController?.pushViewController(editor, animated: true)
    }

    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool {
        !cards(for: groups[indexPath.section].type).isEmpty
    }

    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
        let group = cards(for: groups[indexPath.section].type)
        guard editingStyle == .delete, !group.isEmpty else { return }
        let card = group[indexPath.row]
        let alert = UIAlertController(
            title: "Delete card",
            message: "Delete \"\(card.title)\"? This can't be undone.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
            self?.performDelete(card)
        })
        present(alert, animated: true)
    }

    private func performDelete(_ card: APIClient.KnowledgeCardItem) {
        Task { @MainActor in
            do {
                try await APIClient.shared.deleteCard(id: card.id)
                cards.removeAll { $0.id == card.id }
                tableView.reloadData()
            } catch {
                let alert = UIAlertController(
                    title: "Couldn't delete",
                    message: error.localizedDescription,
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                present(alert, animated: true)
            }
        }
    }
}

/// Editor for a single knowledge card: type, title, details and priority. Saves
/// via `POST /api/cards` (new) or `PUT /api/cards/:id` (existing) and calls back
/// so the list can refresh. Mirrors the web "Edit card" modal.
final class KnowledgeCardEditorViewController: UIViewController {

    private let card: APIClient.KnowledgeCardItem?
    private let onSave: () -> Void

    private let typeControl = UISegmentedControl(items: ["Project", "Company / Service"])
    private let titleField = UITextField()
    private let bodyView = UITextView()
    private let sortField = UITextField()

    init(card: APIClient.KnowledgeCardItem?, onSave: @escaping () -> Void) {
        self.card = card
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = card == nil ? "New card" : "Edit card"
        view.backgroundColor = .systemGroupedBackground

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .save, target: self, action: #selector(save))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-card-save"

        typeControl.selectedSegmentIndex = (card?.cardType == "company") ? 1 : 0
        typeControl.translatesAutoresizingMaskIntoConstraints = false
        typeControl.accessibilityIdentifier = "segment-card-type"

        let titleLabel = makeLabel("Title")
        titleField.text = card?.title
        titleField.placeholder = "e.g. E-commerce site for Acme"
        titleField.borderStyle = .roundedRect
        titleField.backgroundColor = .secondarySystemGroupedBackground
        titleField.translatesAutoresizingMaskIntoConstraints = false
        titleField.accessibilityIdentifier = "input-card-title"

        let bodyLabel = makeLabel("Details")
        bodyView.text = card?.body
        bodyView.font = .preferredFont(forTextStyle: .body)
        bodyView.backgroundColor = .secondarySystemGroupedBackground
        bodyView.layer.cornerRadius = 10
        bodyView.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        bodyView.translatesAutoresizingMaskIntoConstraints = false
        bodyView.accessibilityIdentifier = "input-card-body"

        let sortLabel = makeLabel("Priority (lower shows first)")
        sortField.text = String(card?.sortOrder ?? 0)
        sortField.placeholder = "0"
        sortField.keyboardType = .numberPad
        sortField.borderStyle = .roundedRect
        sortField.backgroundColor = .secondarySystemGroupedBackground
        sortField.translatesAutoresizingMaskIntoConstraints = false
        sortField.accessibilityIdentifier = "input-card-sort-order"

        let stack = UIStackView(arrangedSubviews: [
            typeControl,
            titleLabel, titleField,
            bodyLabel, bodyView,
            sortLabel, sortField,
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.setCustomSpacing(20, after: typeControl)
        stack.setCustomSpacing(20, after: titleField)
        stack.setCustomSpacing(20, after: bodyView)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            titleField.heightAnchor.constraint(equalToConstant: 44),
            sortField.heightAnchor.constraint(equalToConstant: 44),
            bodyView.heightAnchor.constraint(equalToConstant: 160),
        ])
    }

    private func makeLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .headline)
        return label
    }

    @objc private func save() {
        let cardType = typeControl.selectedSegmentIndex == 1 ? "company" : "project"
        let title = titleField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let body = bodyView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let sortOrder = Int(sortField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") ?? 0

        guard !title.isEmpty else { return showError("Title is required") }
        guard !body.isEmpty else { return showError("Details are required") }

        navigationItem.rightBarButtonItem?.isEnabled = false
        Task { @MainActor in
            do {
                if let card = card {
                    _ = try await APIClient.shared.updateCard(
                        id: card.id, cardType: cardType, title: title, body: body, sortOrder: sortOrder)
                } else {
                    _ = try await APIClient.shared.createCard(
                        cardType: cardType, title: title, body: body, sortOrder: sortOrder)
                }
                onSave()
                navigationController?.popViewController(animated: true)
            } catch {
                navigationItem.rightBarButtonItem?.isEnabled = true
                showError(error.localizedDescription)
            }
        }
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Couldn't save", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
