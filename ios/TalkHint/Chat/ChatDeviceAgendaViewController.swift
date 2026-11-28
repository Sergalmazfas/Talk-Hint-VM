import UIKit
import EventKit
import EventKitUI

@MainActor
final class ChatDeviceAgendaViewController: UITableViewController, EKEventEditViewDelegate, EKEventViewDelegate, UIAdaptivePresentationControllerDelegate {
    private let kind: ChatAgendaKind
    private let store: ChatDeviceAgendaProviding
    private let api: APIClient
    private let validOwner: () -> Bool
    private let dayPicker = UIDatePicker()
    private var rows: [ChatAgendaItem] = []
    private var assignments: [APIClient.SecretaryTask] = []
    private var deviceError: String?
    private var assignmentError: String?
    private var deviceLoaded = false
    private var assignmentsLoaded = false
    private var operation: Task<Void, Never>?
    private var requesting = false
    private var revision = 0
    private var active = false

    init(kind: ChatAgendaKind, store: ChatDeviceAgendaProviding? = nil,
         api: APIClient, validOwner: @escaping () -> Bool) {
        self.kind = kind
        self.store = store ?? ChatDeviceAgendaStore()
        self.api = api
        self.validOwner = validOwner
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { operation?.cancel() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString(kind == .calendar ? "chat.calendar" : "chat.tasks", comment: "")
        tableView.accessibilityIdentifier = kind == .calendar ? "agenda-calendar" : "agenda-tasks"
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 72
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add,
            target: self, action: #selector(addItem))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "agenda-add"
        refreshControl = UIRefreshControl()
        refreshControl?.addTarget(self, action: #selector(reload), for: .valueChanged)
        if kind == .calendar {
            dayPicker.datePickerMode = .date
            dayPicker.preferredDatePickerStyle = .compact
            dayPicker.accessibilityLabel = NSLocalizedString("agenda.date", comment: "")
            dayPicker.addTarget(self, action: #selector(reload), for: .valueChanged)
            let header = UIView(frame: CGRect(x: 0, y: 0, width: 320, height: 60))
            dayPicker.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(dayPicker)
            NSLayoutConstraint.activate([
                dayPicker.centerXAnchor.constraint(equalTo: header.centerXAnchor),
                dayPicker.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            ])
            tableView.tableHeaderView = header
        }
        NotificationCenter.default.addObserver(self, selector: #selector(reload),
            name: .EKEventStoreChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        active = true
        reload()
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        active = false
        operation?.cancel()
    }
    private func clearForInvalidOwner() {
        operation?.cancel()
        rows = []
        assignments = []
        deviceError = nil
        assignmentError = nil
        refreshControl?.endRefreshing()
        tableView.reloadData()
        navigationItem.rightBarButtonItem?.isEnabled = false
    }
    @objc private func becameActive() {
        if !validOwner() {
            presentedViewController?.dismiss(animated: false)
            clearForInvalidOwner()
        } else { reload() }
    }
    @objc private func reload() {
        guard isViewLoaded, active else { return }
        guard validOwner() else { clearForInvalidOwner(); return }
        // Store notifications while the native editor is active must not replace
        // its selected occurrence. Reload after the editor is dismissed.
        guard presentedViewController == nil, !requesting else { return }
        operation?.cancel()
        revision += 1
        let version = revision
        rows = []
        assignments = []
        deviceLoaded = false
        assignmentsLoaded = false
        deviceError = nil
        assignmentError = nil
        navigationItem.rightBarButtonItem?.isEnabled = store.access(kind) == .allowed
        tableView.reloadData()
        operation = Task { [weak self] in
            guard let self, !Task.isCancelled, self.validOwner(), self.revision == version else { return }
            await self.loadDevice(version: version)
            guard !Task.isCancelled, self.validOwner(), self.revision == version else { return }
            // Permission denial for Reminders never hides already-owned assignments.
            if self.kind == .reminders {
                do {
                    let loaded = try await self.api.secretaryTasks()
                    guard !Task.isCancelled, self.validOwner(), self.revision == version else { return }
                    self.assignments = loaded
                } catch {
                    guard !Task.isCancelled, self.validOwner(), self.revision == version else { return }
                    self.assignmentError = NSLocalizedString("agenda.assignments.error", comment: "")
                }
                self.assignmentsLoaded = true
            }
            guard self.validOwner(), self.revision == version else { return }
            self.refreshControl?.endRefreshing()
            self.tableView.reloadData()
        }
    }
    private func loadDevice(version: Int) async {
        guard !Task.isCancelled, validOwner(), revision == version else { return }
        guard store.access(kind) == .allowed else {
            deviceLoaded = true
            return // No implicit OS permission prompt.
        }
        do {
            let loaded = try await store.items(kind, on: dayPicker.date)
            guard !Task.isCancelled, validOwner(), revision == version else { return }
            rows = loaded
        } catch {
            guard !Task.isCancelled, validOwner(), revision == version else { return }
            deviceError = NSLocalizedString("agenda.error", comment: "")
        }
        deviceLoaded = true
        tableView.reloadData()
    }
    override func numberOfSections(in tableView: UITableView) -> Int {
        guard validOwner() else { return 0 }
        return kind == .calendar ? 1 : 2
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        NSLocalizedString(section == 1 ? "agenda.assignments" :
            (kind == .calendar ? "agenda.events" : "agenda.reminders"), comment: "")
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        NSLocalizedString(section == 1 ? "agenda.assignments.note" : "agenda.privacy", comment: "")
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        guard validOwner() else { return 0 }
        if section == 1 { return max(1, assignments.count) }
        guard store.access(kind) == .allowed, deviceError == nil else { return 1 }
        return max(1, rows.count)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.numberOfLines = 0
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        guard validOwner() else { return cell }
        if indexPath.section == 1 {
            guard !assignments.isEmpty else {
                cell.textLabel?.text = assignmentError ?? NSLocalizedString(
                    assignmentsLoaded ? "agenda.assignments.empty" : "agenda.loading", comment: "")
                cell.accessibilityIdentifier = assignmentError == nil ? "agenda-assignments-state" : "agenda-assignments-retry"
                return cell
            }
            let task = assignments[indexPath.row]
            cell.textLabel?.text = task.instruction
            cell.detailTextLabel?.text = [task.phoneNumber, task.status, task.summary].compactMap { $0 }.joined(separator: "\n")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "agenda-assignment-\(task.id)"
            return cell
        }
        let access = store.access(kind)
        guard access == .allowed else {
            let key = access == .denied ? "agenda.openSettings" :
                      (access == .restricted ? "agenda.access.restricted" : "agenda.allow")
            cell.textLabel?.text = NSLocalizedString(key, comment: "")
            cell.detailTextLabel?.text = NSLocalizedString(kind == .calendar ?
                "agenda.calendar.permission" : "agenda.reminders.permission", comment: "")
            cell.accessibilityIdentifier = "agenda-permission"
            return cell
        }
        if let error = deviceError {
            cell.textLabel?.text = error
            cell.detailTextLabel?.text = NSLocalizedString("agenda.retry", comment: "")
            cell.accessibilityIdentifier = "agenda-retry"
        } else if rows.isEmpty {
            cell.textLabel?.text = NSLocalizedString(deviceLoaded ? "agenda.empty" : "agenda.loading", comment: "")
            cell.selectionStyle = .none
        } else {
            let row = rows[indexPath.row]
            cell.textLabel?.text = row.title
            let date = row.date.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .short) }
            cell.detailTextLabel?.text = [date, row.subtitle, row.completed ? NSLocalizedString("agenda.completed", comment: "") : nil]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "agenda-item-\(indexPath.row)"
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard validOwner(), !requesting else { return }
        if indexPath.section == 1 {
            if assignments.isEmpty { if assignmentError != nil { reload() }; return }
            navigationController?.pushViewController(SecretaryTaskDetailViewController(task: assignments[indexPath.row]), animated: true)
            return
        }
        if store.access(kind) != .allowed { requestPermission(); return }
        if deviceError != nil { reload(); return }
        guard rows.indices.contains(indexPath.row) else { return }
        let row = rows[indexPath.row]
        do {
            if kind == .calendar { try openEvent(row.id) }
            else if row.editable { try openReminder(store.reminder(row.id)) }
            else { throw ChatAgendaError.unavailable }
        } catch { show(error) }
    }
    private func requestPermission() {
        guard validOwner() else { return }
        if store.access(kind) == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            return
        }
        guard store.access(kind) != .restricted else { return }
        operation?.cancel()
        requesting = true
        operation = Task { [weak self] in
            guard let self else { return }
            guard !Task.isCancelled, self.validOwner(), self.active else { self.requesting = false; return }
            do {
                _ = try await self.store.requestAccess(self.kind)
                self.requesting = false
                guard self.validOwner(), !Task.isCancelled else { self.clearForInvalidOwner(); return }
                self.reload()
            } catch {
                self.requesting = false
                guard self.validOwner(), !Task.isCancelled else { self.clearForInvalidOwner(); return }
                self.show(error)
                self.tableView.reloadData()
            }
        }
    }
    @objc private func addItem() {
        guard validOwner(), store.access(kind) == .allowed, presentedViewController == nil else { return }
        do {
            if kind == .calendar { try openEvent(nil) }
            else { try openReminder(.init(id: nil, title: "", due: nil, completed: false)) }
        } catch { show(error) }
    }
    private func openReminder(_ draft: ChatReminderDraft) throws {
        let editor = ChatReminderEditor(store: store, draft: draft, validOwner: validOwner)
        editor.onSaved = { [weak self] in self?.reload() }
        let navigation = ChatNavigationController(chat: editor)
        navigation.setNavigationBarHidden(false, animated: false)
        // This modal is an editor, not a chat root whose bar should be hidden.
        navigation.delegate = nil
        present(navigation, animated: true)
        navigation.presentationController?.delegate = self
    }
    private func openEvent(_ id: String?) throws {
        guard let real = store as? ChatDeviceAgendaStore else { throw ChatAgendaError.unavailable }
        let event = try id.map { try real.event($0) } ?? real.newEvent(on: dayPicker.date)
        if !event.calendar.allowsContentModifications {
            let viewer = EKEventViewController()
            viewer.event = event
            viewer.allowsEditing = false
            viewer.allowsCalendarPreview = false
            viewer.delegate = self
            let navigation = UINavigationController(rootViewController: viewer)
            present(navigation, animated: true)
            navigation.presentationController?.delegate = self
        } else {
            let editor = EKEventEditViewController()
            editor.eventStore = real.eventStore
            editor.event = event
            editor.editViewDelegate = self
            present(editor, animated: true)
            editor.presentationController?.delegate = self
        }
    }
    func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true) { [weak self] in self?.reload() }
    }
    func eventViewController(_ controller: EKEventViewController, didCompleteWith action: EKEventViewAction) {
        controller.navigationController?.dismiss(animated: true) { [weak self] in self?.reload() }
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { reload() }
    private func show(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("agenda.error", comment: ""),
            message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}
