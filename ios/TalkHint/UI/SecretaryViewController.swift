import UIKit

/// Secretary is an autonomous follow-up queue. Creating a task is a distinct,
/// explicitly confirmed flow and never starts the owner's live Hint call leg.
final class SecretaryViewController: UITableViewController {
    private var tasks: [APIClient.SecretaryTask] = []
    private var didLoadOnce = false
    private var openingTaskIDs = Set<String>()
    private let refresh = UIRefreshControl()
    private let notificationsButton = UIButton(type: .system)

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    init() {
        super.init(style: .insetGrouped)
        title = NSLocalizedString("secretary.title", comment: "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-secretary-tasks"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "secretary-task")
        refresh.addTarget(self, action: #selector(reloadTasks), for: .valueChanged)
        tableView.refreshControl = refresh

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            image: UIImage(systemName: "plus"), style: .plain,
            target: self, action: #selector(newTaskTapped))
        navigationItem.rightBarButtonItem?.accessibilityLabel =
            NSLocalizedString("secretary.new_task", comment: "")
        installNotificationPrompt()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshNotificationPrompt()
        reloadTasks()
    }

    private func installNotificationPrompt() {
        notificationsButton.setTitle(NSLocalizedString("secretary.notifications.enable", comment: ""), for: .normal)
        notificationsButton.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
        notificationsButton.contentHorizontalAlignment = .leading
        notificationsButton.addTarget(self, action: #selector(enableNotificationsTapped), for: .touchUpInside)
        notificationsButton.accessibilityIdentifier = "button-secretary-notifications"

        let header = UIView(frame: CGRect(x: 0, y: 0, width: tableView.bounds.width, height: 50))
        notificationsButton.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(notificationsButton)
        NSLayoutConstraint.activate([
            notificationsButton.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 18),
            notificationsButton.trailingAnchor.constraint(lessThanOrEqualTo: header.trailingAnchor, constant: -18),
            notificationsButton.topAnchor.constraint(equalTo: header.topAnchor, constant: 8),
            notificationsButton.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -8),
        ])
        tableView.tableHeaderView = header
    }

    private func refreshNotificationPrompt() {
        SecretaryAlertManager.shared.authorizationStatus { [weak self] status in
            guard let self else { return }
            let systemPermitted = status == .authorized || status == .provisional || status == .ephemeral
            let enabled = systemPermitted && SecretaryAlertManager.shared.isOptedIn
            self.tableView.tableHeaderView?.isHidden = enabled
            self.notificationsButton.isHidden = enabled
            self.notificationsButton.setTitle(
                status == .denied
                    ? NSLocalizedString("secretary.notifications.settings", comment: "")
                    : NSLocalizedString("secretary.notifications.enable", comment: ""),
                for: .normal)
        }
    }

    @objc private func enableNotificationsTapped() {
        SecretaryAlertManager.shared.requestFromSecretary { [weak self] granted in
            guard let self else { return }
            if granted {
                self.notificationsButton.isHidden = true
                self.tableView.tableHeaderView?.isHidden = true
            } else {
                let alert = UIAlertController(
                    title: NSLocalizedString("secretary.notifications.title", comment: ""),
                    message: NSLocalizedString("secretary.notifications.denied", comment: ""),
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
                alert.addAction(UIAlertAction(
                    title: NSLocalizedString("secretary.notifications.settings", comment: ""),
                    style: .default,
                    handler: { _ in
                        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                        UIApplication.shared.open(url)
                    }))
                self.present(alert, animated: true)
            }
        }
    }

    @objc private func reloadTasks() {
        Task {
            do {
                let loaded = try await APIClient.shared.secretaryTasks()
                await MainActor.run {
                    self.tasks = loaded.sorted {
                        ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast)
                    }
                    self.didLoadOnce = true
                    self.refresh.endRefreshing()
                    self.tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    self.didLoadOnce = true
                    self.refresh.endRefreshing()
                    self.tableView.reloadData()
                    self.showError(error)
                }
            }
        }
    }

    @objc private func newTaskTapped() {
        navigationController?.pushViewController(SecretaryTaskComposerViewController(), animated: true)
    }

    /// Called by an alert-push deep link after selecting the Secretary tab.
    /// The server list is the sole source of report content.
    func openTask(id: String) {
        if let detail = navigationController?.topViewController as? SecretaryTaskDetailViewController,
           detail.taskID == id { return }
        guard openingTaskIDs.insert(id).inserted else { return }
        if navigationController?.topViewController !== self {
            navigationController?.popToRootViewController(animated: false)
        }
        Task {
            do {
                let loaded = try await APIClient.shared.secretaryTasks()
                await MainActor.run {
                    self.openingTaskIDs.remove(id)
                    self.tasks = loaded
                    self.tableView.reloadData()
                    guard let task = loaded.first(where: { $0.id == id }) else {
                        self.showTaskNotFound()
                        return
                    }
                    self.navigationController?.pushViewController(
                        SecretaryTaskDetailViewController(task: task), animated: true)
                }
            } catch {
                await MainActor.run {
                    self.openingTaskIDs.remove(id)
                    self.showError(error)
                }
            }
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(tasks.count, 1)
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "secretary-task", for: indexPath)
        var content = cell.defaultContentConfiguration()
        guard !tasks.isEmpty else {
            content.text = didLoadOnce
                ? NSLocalizedString("secretary.empty.title", comment: "")
                : NSLocalizedString("common.loading", comment: "")
            content.secondaryText = didLoadOnce ? NSLocalizedString("secretary.empty.message", comment: "") : nil
            content.textProperties.color = .secondaryLabel
            cell.accessoryType = .none
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "cell-secretary-empty"
            cell.contentConfiguration = content
            return cell
        }

        let task = tasks[indexPath.row]
        content.text = task.instruction
        content.secondaryText = [
            Self.statusTitle(task.status),
            task.phoneNumber,
            task.createdAt.map(Self.dateFormatter.string(from:)),
        ].compactMap { $0 }.joined(separator: " · ")
        content.secondaryTextProperties.color = .secondaryLabel
        content.secondaryTextProperties.numberOfLines = 2
        cell.accessoryType = .disclosureIndicator
        cell.selectionStyle = .default
        cell.accessibilityIdentifier = "cell-secretary-task-\(task.id)"
        cell.contentConfiguration = content
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard tasks.indices.contains(indexPath.row) else { return }
        navigationController?.pushViewController(
            SecretaryTaskDetailViewController(task: tasks[indexPath.row]), animated: true)
    }

    private func showTaskNotFound() {
        let alert = UIAlertController(
            title: NSLocalizedString("common.error", comment: ""),
            message: NSLocalizedString("secretary.task.not_found", comment: ""),
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""),
                                      message: error.localizedDescription,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }

    fileprivate static func statusTitle(_ status: String) -> String {
        switch status.lowercased().replacingOccurrences(of: "-", with: "_") {
        case "queued", "pending": return NSLocalizedString("secretary.status.queued", comment: "")
        case "starting", "ringing", "calling": return NSLocalizedString("secretary.status.calling", comment: "")
        case "connected", "finalizing", "in_progress":
            return NSLocalizedString("secretary.status.in_progress", comment: "")
        case "completed": return NSLocalizedString("secretary.status.completed", comment: "")
        case "needs_action", "requires_action", "action_required", "follow_up", "needs_follow_up":
            return NSLocalizedString("secretary.status.needs_action", comment: "")
        case "no_answer", "not_reached":
            return NSLocalizedString("secretary.status.no_answer", comment: "")
        case "busy": return NSLocalizedString("secretary.status.busy", comment: "")
        case "failed": return NSLocalizedString("secretary.status.failed", comment: "")
        case "cancelled", "canceled": return NSLocalizedString("secretary.status.cancelled", comment: "")
        case "unknown": return NSLocalizedString("secretary.status.unknown", comment: "")
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    fileprivate static func canCancel(_ status: String) -> Bool {
        ["queued", "pending"].contains(status.lowercased())
    }

    fileprivate static func canRetry(_ task: APIClient.SecretaryTask) -> Bool {
        let status = task.status.lowercased().replacingOccurrences(of: "-", with: "_")
        let outcome = (task.outcome ?? "").lowercased().replacingOccurrences(of: "-", with: "_")
        return ["failed", "no_answer", "busy"].contains(status) ||
            (status == "completed" && outcome == "needs_follow_up")
    }
}

private final class SecretaryTaskComposerViewController: UIViewController, UITextViewDelegate {
    private let phoneField = UITextField()
    private let instructionView = UITextView()
    private let continueButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("secretary.new_task", comment: "")
        view.backgroundColor = .systemBackground
        buildForm()
    }

    private func buildForm() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        let content = UIStackView()
        content.axis = .vertical
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 22),
            content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            content.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
        ])

        let intro = UILabel()
        intro.text = NSLocalizedString("secretary.new_task.intro", comment: "")
        intro.numberOfLines = 0
        intro.font = .preferredFont(forTextStyle: .body)
        content.addArrangedSubview(intro)

        let numberLabel = sectionLabel("secretary.phone.label")
        content.addArrangedSubview(numberLabel)
        phoneField.borderStyle = .roundedRect
        phoneField.keyboardType = .phonePad
        phoneField.textContentType = .telephoneNumber
        phoneField.placeholder = NSLocalizedString("secretary.phone.placeholder", comment: "")
        phoneField.accessibilityIdentifier = "field-secretary-phone"
        content.addArrangedSubview(phoneField)

        content.addArrangedSubview(sectionLabel("secretary.instruction.label"))
        instructionView.font = .preferredFont(forTextStyle: .body)
        instructionView.backgroundColor = .secondarySystemBackground
        instructionView.layer.cornerRadius = 12
        instructionView.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        instructionView.delegate = self
        instructionView.text = NSLocalizedString("secretary.instruction.placeholder", comment: "")
        instructionView.textColor = .placeholderText
        instructionView.heightAnchor.constraint(greaterThanOrEqualToConstant: 140).isActive = true
        instructionView.accessibilityIdentifier = "field-secretary-instruction"
        content.addArrangedSubview(instructionView)

        continueButton.setTitle(NSLocalizedString("secretary.prepare_task", comment: ""), for: .normal)
        continueButton.setTitleColor(.white, for: .normal)
        continueButton.backgroundColor = Theme.purple
        continueButton.layer.cornerRadius = 22
        continueButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        continueButton.addTarget(self, action: #selector(continueTapped), for: .touchUpInside)
        continueButton.accessibilityIdentifier = "button-secretary-prepare"
        content.addArrangedSubview(continueButton)

        let note = UILabel()
        note.text = NSLocalizedString("secretary.confirmation.note", comment: "")
        note.font = .preferredFont(forTextStyle: .footnote)
        note.textColor = .secondaryLabel
        note.numberOfLines = 0
        content.addArrangedSubview(note)
    }

    private func sectionLabel(_ key: String) -> UILabel {
        let label = UILabel()
        label.text = NSLocalizedString(key, comment: "")
        label.font = .preferredFont(forTextStyle: .headline)
        return label
    }

    @objc private func continueTapped() {
        view.endEditing(true)
        let phone = SecretaryPhoneNumber.normalized(phoneField.text ?? "")
        let typedInstruction = instructionView.text ?? ""
        let instruction = typedInstruction == NSLocalizedString("secretary.instruction.placeholder", comment: "")
            ? "" : typedInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let phone else {
            showError(NSLocalizedString("secretary.phone.invalid", comment: ""))
            return
        }
        guard !instruction.isEmpty else {
            showError(NSLocalizedString("secretary.instruction.required", comment: ""))
            return
        }
        let prepare = PrepareViewController(mode: .secretary, initialMessage: instruction)
        prepare.onSecretaryTaskConfirmed = { [weak self] (confirmedInstruction: String, confirmationToken: String) in
            guard let self else { return }
            self.navigationController?.pushViewController(
                SecretaryTaskReviewViewController(
                    phoneNumber: phone, instruction: confirmedInstruction, confirmationToken: confirmationToken),
                animated: true)
        }
        navigationController?.pushViewController(prepare, animated: true)
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""),
                                      message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
        if textView.text == NSLocalizedString("secretary.instruction.placeholder", comment: "") {
            textView.text = ""
            textView.textColor = .label
        }
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            textView.text = NSLocalizedString("secretary.instruction.placeholder", comment: "")
            textView.textColor = .placeholderText
        }
    }

}

private final class SecretaryTaskReviewViewController: UIViewController {
    private let phoneNumber: String
    private let instruction: String
    private let confirmationToken: String
    private let phoneField = UITextField()
    private let startButton = UIButton(type: .system)
    private let activity = UIActivityIndicatorView(style: .medium)

    init(phoneNumber: String, instruction: String, confirmationToken: String) {
        self.phoneNumber = phoneNumber
        self.instruction = instruction
        self.confirmationToken = confirmationToken
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("secretary.review.title", comment: "")
        view.backgroundColor = .systemBackground
        buildReview()
    }

    private func buildReview() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
        ])

        let intro = UILabel()
        intro.text = NSLocalizedString("secretary.review.intro", comment: "")
        intro.font = .preferredFont(forTextStyle: .body)
        intro.textColor = .secondaryLabel
        intro.numberOfLines = 0
        stack.addArrangedSubview(intro)
        stack.addArrangedSubview(sectionLabel("secretary.phone.label"))
        phoneField.borderStyle = .roundedRect
        phoneField.keyboardType = .phonePad
        phoneField.textContentType = .telephoneNumber
        phoneField.text = phoneNumber
        phoneField.accessibilityIdentifier = "field-secretary-review-phone"
        stack.addArrangedSubview(phoneField)
        stack.addArrangedSubview(sectionLabel("secretary.instruction.label"))

        let instructionCard = UILabel()
        instructionCard.text = instruction
        instructionCard.font = .preferredFont(forTextStyle: .body)
        instructionCard.numberOfLines = 0
        instructionCard.backgroundColor = Theme.purpleBg
        instructionCard.layer.cornerRadius = 14
        instructionCard.layer.masksToBounds = true
        stack.addArrangedSubview(instructionCard)

        let noStart = UILabel()
        noStart.text = NSLocalizedString("secretary.review.no_start", comment: "")
        noStart.font = .preferredFont(forTextStyle: .footnote)
        noStart.textColor = .secondaryLabel
        noStart.numberOfLines = 0
        stack.addArrangedSubview(noStart)

        let buttonRow = UIStackView(arrangedSubviews: [startButton, activity])
        buttonRow.axis = .horizontal
        buttonRow.spacing = 12
        buttonRow.alignment = .center
        startButton.setTitle(NSLocalizedString("secretary.start_call", comment: ""), for: .normal)
        startButton.setTitleColor(.white, for: .normal)
        startButton.backgroundColor = Theme.green
        startButton.layer.cornerRadius = 22
        startButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        startButton.addTarget(self, action: #selector(startTapped), for: .touchUpInside)
        startButton.accessibilityIdentifier = "button-secretary-start"
        stack.addArrangedSubview(buttonRow)
    }

    private func sectionLabel(_ key: String) -> UILabel {
        let label = UILabel()
        label.text = NSLocalizedString(key, comment: "")
        label.font = .preferredFont(forTextStyle: .headline)
        return label
    }

    @objc private func startTapped() {
        view.endEditing(true)
        guard !confirmationToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            showError(NSLocalizedString("secretary.prepare.token_missing", comment: ""))
            return
        }
        guard let number = SecretaryPhoneNumber.normalized(phoneField.text ?? "") else {
            showError(NSLocalizedString("secretary.phone.invalid", comment: ""))
            return
        }
        startButton.isEnabled = false
        activity.startAnimating()
        Task {
            do {
                _ = try await APIClient.shared.createSecretaryTask(
                    phoneNumber: number, instruction: instruction, confirmationToken: confirmationToken,
                    voiceProvider: SessionStore.shared.voiceProvider)
                await MainActor.run {
                    self.activity.stopAnimating()
                    self.navigationController?.popToRootViewController(animated: true)
                }
            } catch {
                await MainActor.run {
                    self.activity.stopAnimating()
                    self.startButton.isEnabled = true
                    self.showError(error.localizedDescription)
                }
            }
        }
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""),
                                      message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }

}

private enum SecretaryPhoneNumber {
    /// Mirrors the backend's NANP E.164 check: +1 followed by ten digits, with
    /// a 2–9 first digit in the area code.
    static func normalized(_ value: String) -> String? {
        let number = value.filter { character in
            guard let ascii = character.asciiValue else { return false }
            return ascii == 43 || (48...57).contains(ascii)
        }
        guard number.range(of: #"^\+1[2-9]\d{9}$"#, options: .regularExpression) != nil else {
            return nil
        }
        return number
    }
}

private final class SecretaryTaskDetailViewController: UIViewController {
    private var task: APIClient.SecretaryTask
    var taskID: String { task.id }
    private let cancelButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private let actionActivity = UIActivityIndicatorView(style: .medium)

    init(task: APIClient.SecretaryTask) {
        self.task = task
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("secretary.report.title", comment: "")
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = task.callId == nil ? nil : UIBarButtonItem(
            title: NSLocalizedString("secretary.transcript.history", comment: ""),
            style: .plain, target: self, action: #selector(openHistoryTranscript))
        render()
    }

    private func render() {
        view.subviews.forEach { $0.removeFromSuperview() }
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
        ])

        let verdict = UILabel()
        verdict.text = verdictTitle()
        verdict.font = .preferredFont(forTextStyle: .title2).withTraits(.traitBold)
        verdict.numberOfLines = 0
        verdict.accessibilityIdentifier = "label-secretary-verdict"
        stack.addArrangedSubview(verdict)

        let status = UILabel()
        status.text = SecretaryViewController.statusTitle(task.status)
        status.font = .preferredFont(forTextStyle: .subheadline)
        status.textColor = Theme.purple
        stack.addArrangedSubview(status)

        if let summary = nonEmpty(task.summary) {
            stack.addArrangedSubview(sectionLabel("secretary.report.summary"))
            stack.addArrangedSubview(bodyLabel(summary))
        }

        stack.addArrangedSubview(sectionLabel("secretary.instruction.label"))
        stack.addArrangedSubview(bodyLabel(task.instruction))
        stack.addArrangedSubview(sectionLabel("secretary.phone.label"))
        stack.addArrangedSubview(bodyLabel(task.phoneNumber))

        if !task.verifiedFacts.isEmpty {
            stack.addArrangedSubview(sectionLabel("secretary.report.facts"))
            stack.addArrangedSubview(bodyLabel(task.verifiedFacts.map { "• \($0)" }.joined(separator: "\n")))
        }
        if let nextStep = nonEmpty(task.nextStep) {
            stack.addArrangedSubview(sectionLabel("secretary.report.next_step"))
            stack.addArrangedSubview(bodyLabel(nextStep))
        }
        if let transcript = nonEmpty(task.transcript) {
            stack.addArrangedSubview(sectionLabel("secretary.report.transcript"))
            let transcriptView = UITextView()
            transcriptView.text = transcript
            transcriptView.font = .preferredFont(forTextStyle: .callout)
            transcriptView.textColor = .secondaryLabel
            transcriptView.backgroundColor = .secondarySystemBackground
            transcriptView.layer.cornerRadius = 12
            transcriptView.isEditable = false
            transcriptView.isScrollEnabled = false
            transcriptView.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
            transcriptView.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true
            stack.addArrangedSubview(transcriptView)
        }

        let actionRow = UIStackView(arrangedSubviews: [cancelButton, retryButton, actionActivity])
        actionRow.axis = .vertical
        actionRow.spacing = 10
        cancelButton.isHidden = !SecretaryViewController.canCancel(task.status)
        retryButton.isHidden = !SecretaryViewController.canRetry(task)
        styleActionButton(cancelButton, titleKey: "secretary.cancel")
        styleActionButton(retryButton, titleKey: "secretary.call_again")
        cancelButton.removeTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        retryButton.removeTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        cancelButton.accessibilityIdentifier = "button-secretary-cancel"
        retryButton.accessibilityIdentifier = "button-secretary-retry"
        actionRow.isHidden = cancelButton.isHidden && retryButton.isHidden && !actionActivity.isAnimating
        stack.addArrangedSubview(actionRow)
    }

    private func verdictTitle() -> String {
        switch (task.outcome ?? "").lowercased().replacingOccurrences(of: "-", with: "_") {
        case "resolved", "issue_resolved", "solved":
            return NSLocalizedString("secretary.outcome.resolved", comment: "")
        case "needs_action", "requires_action", "action_required", "follow_up",
             "needs_follow_up", "callback_requested":
            return NSLocalizedString("secretary.outcome.needs_action", comment: "")
        case "no_answer", "not_reached", "unreachable":
            return NSLocalizedString("secretary.outcome.not_reached", comment: "")
        case "failed":
            return NSLocalizedString("secretary.outcome.failed", comment: "")
        case "unknown":
            return NSLocalizedString("secretary.outcome.unknown", comment: "")
        default:
            return nonEmpty(task.summary) ?? NSLocalizedString("secretary.outcome.pending", comment: "")
        }
    }

    private func sectionLabel(_ key: String) -> UILabel {
        let label = UILabel()
        label.text = NSLocalizedString(key, comment: "")
        label.font = .preferredFont(forTextStyle: .headline)
        return label
    }

    private func bodyLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.numberOfLines = 0
        return label
    }

    private func styleActionButton(_ button: UIButton, titleKey: String) {
        button.setTitle(NSLocalizedString(titleKey, comment: ""), for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.backgroundColor = Theme.purple
        button.layer.cornerRadius = 20
        if !button.constraints.contains(where: { $0.firstAttribute == .height }) {
            button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        }
    }

    private func nonEmpty(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    @objc private func cancelTapped() {
        confirmAction(key: "secretary.cancel.confirm") { [weak self] in
            guard let self else { return }
            self.performTaskAction { try await APIClient.shared.cancelSecretaryTask(id: self.task.id) }
        }
    }

    @objc private func retryTapped() {
        confirmAction(key: "secretary.retry.confirm") { [weak self] in
            guard let self else { return }
            self.performTaskAction { try await APIClient.shared.retrySecretaryTask(id: self.task.id) }
        }
    }

    private func confirmAction(key: String, action: @escaping () -> Void) {
        let alert = UIAlertController(
            title: NSLocalizedString(key + ".title", comment: ""),
            message: NSLocalizedString(key + ".message", comment: ""),
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(
            title: NSLocalizedString(key + ".confirm", comment: ""), style: .default,
            handler: { _ in action() }))
        present(alert, animated: true)
    }

    private func performTaskAction(_ request: @escaping () async throws -> APIClient.SecretaryTask) {
        cancelButton.isEnabled = false
        retryButton.isEnabled = false
        actionActivity.startAnimating()
        Task {
            do {
                let updated = try await request()
                await MainActor.run {
                    self.task = updated
                    self.actionActivity.stopAnimating()
                    self.navigationItem.rightBarButtonItem = updated.callId == nil ? nil : UIBarButtonItem(
                        title: NSLocalizedString("secretary.transcript.history", comment: ""),
                        style: .plain, target: self, action: #selector(self.openHistoryTranscript))
                    self.render()
                }
            } catch {
                await MainActor.run {
                    self.actionActivity.stopAnimating()
                    self.cancelButton.isEnabled = true
                    self.retryButton.isEnabled = true
                    self.showError(error)
                }
            }
        }
    }

    @objc private func openHistoryTranscript() {
        guard let callId = task.callId,
              let tabs = tabBarController,
              tabs.viewControllers?.indices.contains(4) == true,
              let navigation = tabs.viewControllers?[4] as? UINavigationController,
              let history = navigation.viewControllers.first as? CallHistoryViewController else { return }
        tabs.selectedIndex = 4
        navigation.popToRootViewController(animated: false)
        history.openCallTranscript(identifier: callId)
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""),
                                      message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }
}

private extension UIFont {
    func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
        UIFont(descriptor: fontDescriptor.withSymbolicTraits(traits) ?? fontDescriptor, size: pointSize)
    }
}