import UIKit

/// Lists numbers from the unassigned pool. Tapping one asks for a friendly name
/// and claims it for the user; on success the new number becomes the active line
/// and we return to the Numbers tab (which refreshes on appear).
final class AvailableNumbersViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {

    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private let spinner = UIActivityIndicatorView(style: .large)
    private let messageLabel = UILabel()
    private var available: [APIClient.AvailablePhoneNumber] = []
    private var isAssigning = false

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Add a Number"
        view.backgroundColor = .systemGroupedBackground
        setupTable()
        setupOverlays()
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
        messageLabel.accessibilityIdentifier = "text-available-empty"
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

    private func reload() {
        spinner.startAnimating()
        messageLabel.isHidden = true
        Task { @MainActor in
            defer { spinner.stopAnimating() }
            do {
                available = try await APIClient.shared.availableNumbers()
                tableView.reloadData()
                if available.isEmpty {
                    messageLabel.text = "No numbers available right now.\nPlease try again later."
                    messageLabel.isHidden = false
                }
            } catch {
                available = []
                tableView.reloadData()
                messageLabel.text = "Couldn't load available numbers.\nPlease try again later."
                messageLabel.isHidden = false
            }
        }
    }

    // MARK: - UITableViewDataSource / Delegate

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        available.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        let item = available[indexPath.row]
        var config = cell.defaultContentConfiguration()
        config.text = item.number
        config.secondaryText = item.country.isEmpty ? nil : item.country
        cell.contentConfiguration = config
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "cell-available-\(item.id)"
        return cell
    }

    func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        available.isEmpty ? nil : "Pick a number, then give it a friendly name."
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        promptForName(item: available[indexPath.row])
    }

    private func promptForName(item: APIClient.AvailablePhoneNumber) {
        let alert = UIAlertController(
            title: "Name this number", message: item.number, preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = "e.g. Work, Personal"
            field.text = "My Number"
            field.autocapitalizationType = .words
            field.clearButtonMode = .whileEditing
            field.accessibilityIdentifier = "input-number-name"
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Assign", style: .default) { [weak self, weak alert] _ in
            let raw = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let name = raw.isEmpty ? "My Number" : raw
            self?.assign(item: item, name: name)
        })
        present(alert, animated: true)
    }

    private func assign(item: APIClient.AvailablePhoneNumber, name: String) {
        guard !isAssigning else { return }
        isAssigning = true
        spinner.startAnimating()
        view.isUserInteractionEnabled = false
        Task { @MainActor in
            defer {
                isAssigning = false
                spinner.stopAnimating()
                view.isUserInteractionEnabled = true
            }
            do {
                let newId = try await APIClient.shared.assignNumber(numberId: item.id, name: name)
                SessionStore.shared.activeNumberId = newId
                navigationController?.popViewController(animated: true)
            } catch {
                presentError(error)
            }
        }
    }

    private func presentError(_ error: Error) {
        // Prefer the backend's user-facing wording (e.g. "Please subscribe to get
        // a phone number." / "Basic plan allows only 1 number.") over the generic
        // "Server error 400:" prefix.
        var message = error.localizedDescription
        if case let APIError.http(_, serverMessage) = error, !serverMessage.isEmpty {
            message = serverMessage
        }
        let alert = UIAlertController(
            title: "Couldn't add number",
            message: message,
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
