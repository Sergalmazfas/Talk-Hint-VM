import UIKit

@MainActor
final class ChatReminderEditor: UITableViewController {
    private let store: ChatDeviceAgendaProviding
    private let validOwner: () -> Bool
    private var draft: ChatReminderDraft
    private let titleField = UITextField()
    private let dueSwitch = UISwitch()
    private let completedSwitch = UISwitch()
    private let datePicker = UIDatePicker()
    private var finishing = false
    var onSaved: (() -> Void)?

    init(store: ChatDeviceAgendaProviding, draft: ChatReminderDraft, validOwner: @escaping () -> Bool) {
        self.store = store
        self.draft = draft
        self.validOwner = validOwner
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("agenda.reminder.edit", comment: "")
        tableView.accessibilityIdentifier = "agenda-reminder-editor"
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 64
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel,
            target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .save,
            target: self, action: #selector(save))
        titleField.text = draft.title
        titleField.placeholder = NSLocalizedString("agenda.title", comment: "")
        titleField.font = .preferredFont(forTextStyle: .body)
        titleField.adjustsFontForContentSizeCategory = true
        titleField.accessibilityIdentifier = "agenda-reminder-title"
        dueSwitch.isOn = draft.due != nil
        dueSwitch.addTarget(self, action: #selector(dueChanged), for: .valueChanged)
        completedSwitch.isOn = draft.completed
        datePicker.datePickerMode = .dateAndTime
        datePicker.preferredDatePickerStyle = .compact
        datePicker.date = draft.due ?? Date()
        datePicker.addTarget(self, action: #selector(dateChanged), for: .valueChanged)
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard validOwner() else { dismiss(animated: false); return }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { draft.id == nil ? 1 : 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? 4 : 1
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.selectionStyle = .none
        cell.textLabel?.numberOfLines = 0
        if indexPath.section == 1 {
            cell.textLabel?.text = NSLocalizedString("agenda.delete", comment: "")
            cell.textLabel?.textColor = .systemRed
            cell.selectionStyle = .default
            return cell
        }
        if indexPath.row == 0 {
            titleField.translatesAutoresizingMaskIntoConstraints = false
            cell.contentView.addSubview(titleField)
            let margins = cell.contentView.layoutMarginsGuide
            NSLayoutConstraint.activate([
                titleField.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
                titleField.trailingAnchor.constraint(equalTo: margins.trailingAnchor),
                titleField.topAnchor.constraint(equalTo: margins.topAnchor, constant: 8),
                titleField.bottomAnchor.constraint(equalTo: margins.bottomAnchor, constant: -8),
            ])
        } else if indexPath.row == 1 {
            cell.textLabel?.text = NSLocalizedString("agenda.due", comment: "")
            cell.accessoryView = dueSwitch
        } else if indexPath.row == 2 {
            let label = UILabel()
            label.text = NSLocalizedString("agenda.date", comment: "")
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
            label.numberOfLines = 0
            datePicker.accessibilityLabel = label.text
            let stack = UIStackView(arrangedSubviews: [label, datePicker])
            stack.axis = .vertical
            stack.spacing = 8
            stack.translatesAutoresizingMaskIntoConstraints = false
            datePicker.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            cell.contentView.addSubview(stack)
            let margins = cell.contentView.layoutMarginsGuide
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: margins.trailingAnchor),
                stack.topAnchor.constraint(equalTo: margins.topAnchor),
                stack.bottomAnchor.constraint(equalTo: margins.bottomAnchor),
            ])
            datePicker.isEnabled = dueSwitch.isOn
        } else {
            cell.textLabel?.text = NSLocalizedString("agenda.completed", comment: "")
            cell.accessoryView = completedSwitch
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.section == 1, validOwner(), !finishing, let id = draft.id else { return }
        let alert = UIAlertController(title: NSLocalizedString("agenda.delete.confirm", comment: ""),
            message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("agenda.delete", comment: ""), style: .destructive) { [weak self] _ in
            guard let self, self.validOwner(), !self.finishing else { return }
            self.finishing = true
            do {
                try self.store.deleteReminder(id)
                self.dismiss(animated: true, completion: self.onSaved)
            }
            catch { self.finishing = false; self.show(error) }
        })
        present(alert, animated: true)
    }
    @objc private func dueChanged() {
        draft.dueEdited = true
        datePicker.isEnabled = dueSwitch.isOn
    }
    @objc private func dateChanged() { draft.dueEdited = true }
    @objc private func cancel() {
        guard !finishing else { return }
        finishing = true
        dismiss(animated: true, completion: onSaved)
    }
    @objc private func save() {
        guard validOwner() else { dismiss(animated: false); return }
        guard !finishing else { return }
        draft.title = (titleField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.title.isEmpty else { show(ChatAgendaError.titleRequired); return }
        draft.due = dueSwitch.isOn ? datePicker.date : nil
        draft.completed = completedSwitch.isOn
        finishing = true
        do { try store.saveReminder(draft); dismiss(animated: true, completion: onSaved) }
        catch { finishing = false; show(error) }
    }
    private func show(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("agenda.error", comment: ""),
            message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
