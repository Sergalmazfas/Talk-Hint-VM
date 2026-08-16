import UIKit

/// "Numbers" tab — lists the user's assigned phone numbers, shows which one is
/// active (a local selection, since the backend has no active-number field), lets
/// the user switch the active number, and opens the available pool to claim a new
/// one. The active selection is shared with the Account tab via `SessionStore`.
final class NumbersViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {

    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private let spinner = UIActivityIndicatorView(style: .large)
    private let messageLabel = UILabel()
    private var numbers: [APIClient.PhoneNumberItem] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("numbers.title", comment: "")
        view.backgroundColor = .systemGroupedBackground

        let addButton = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addTapped))
        addButton.accessibilityIdentifier = "button-add-number"
        navigationItem.rightBarButtonItem = addButton

        setupTable()
        setupOverlays()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    private func setupTable() {
        tableView.dataSource = self
        tableView.delegate = self
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        tableView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tableView)
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
    }

    private func setupOverlays() {
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)

        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        messageLabel.textColor = .secondaryLabel
        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.isHidden = true
        messageLabel.accessibilityIdentifier = "text-numbers-empty"
        messageLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(messageLabel)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            messageLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            messageLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func reload() {
        if !(tableView.refreshControl?.isRefreshing ?? false) {
            spinner.startAnimating()
        }
        messageLabel.isHidden = true
        Task { @MainActor in
            defer {
                spinner.stopAnimating()
                tableView.refreshControl?.endRefreshing()
            }
            do {
                numbers = try await APIClient.shared.numbers()
                // Default the active selection to the first number when nothing
                // valid is selected yet.
                if numbers.first(where: { $0.id == SessionStore.shared.activeNumberId }) == nil {
                    SessionStore.shared.activeNumberId = numbers.first?.id
                }
                tableView.reloadData()
                if numbers.isEmpty {
                    messageLabel.text = NSLocalizedString("numbers.empty", comment: "")
                    messageLabel.isHidden = false
                }
            } catch {
                numbers = []
                tableView.reloadData()
                messageLabel.text = NSLocalizedString("numbers.load_error", comment: "")
                messageLabel.isHidden = false
            }
        }
    }

    @objc private func addTapped() {
        navigationController?.pushViewController(AvailableNumbersViewController(), animated: true)
    }

    // MARK: - UITableViewDataSource / Delegate

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        numbers.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        let item = numbers[indexPath.row]
        var config = cell.defaultContentConfiguration()
        config.text = item.name.isEmpty ? NSLocalizedString("numbers.default_name", comment: "") : item.name
        config.secondaryText = item.number
        cell.contentConfiguration = config
        cell.accessoryType = (item.id == SessionStore.shared.activeNumberId) ? .checkmark : .none
        cell.accessibilityIdentifier = "cell-number-\(item.id)"
        return cell
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        numbers.isEmpty ? nil : NSLocalizedString("numbers.section.header", comment: "")
    }

    func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        numbers.count > 1 ? NSLocalizedString("numbers.section.footer", comment: "") : nil
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        SessionStore.shared.activeNumberId = numbers[indexPath.row].id
        tableView.reloadData()
    }
}
