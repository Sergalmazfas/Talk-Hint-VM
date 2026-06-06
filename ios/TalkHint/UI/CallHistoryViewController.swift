import UIKit

/// History tab: lists the signed-in user's past calls (newest first). Tapping a
/// row opens the full transcript. Data comes from `/api/calls`, filtered to the
/// current user and sorted client-side in `APIClient.calls()`.
final class CallHistoryViewController: UITableViewController {

    private var calls: [APIClient.CallRecord] = []
    /// The user's own Twilio numbers, used to show the *other* party per call.
    private var ownNumbers: Set<String> = []
    private let refresh = UIRefreshControl()
    private var didLoadOnce = false

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    init() {
        super.init(style: .insetGrouped)
        title = "History"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-call-history"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.refreshControl = refresh
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
        Task {
            do {
                async let callsTask = APIClient.shared.calls()
                async let numbersTask = APIClient.shared.numbers()
                let loadedCalls = try await callsTask
                // Numbers are best-effort: used only to label the other party.
                let loadedNumbers = (try? await numbersTask) ?? []
                await MainActor.run {
                    self.calls = loadedCalls
                    self.ownNumbers = Set(loadedNumbers.map { $0.number })
                    self.didLoadOnce = true
                    self.tableView.reloadData()
                    self.refresh.endRefreshing()
                }
            } catch {
                await MainActor.run {
                    self.didLoadOnce = true
                    self.refresh.endRefreshing()
                    self.showError(error)
                }
            }
        }
    }

    /// The number of the party the user spoke with: whichever side is not one of
    /// the user's own numbers. Falls back to the caller (`fromNumber`).
    private func otherParty(_ call: APIClient.CallRecord) -> String {
        if ownNumbers.contains(call.fromNumber), !call.toNumber.isEmpty {
            return call.toNumber
        }
        if ownNumbers.contains(call.toNumber), !call.fromNumber.isEmpty {
            return call.fromNumber
        }
        return call.fromNumber.isEmpty ? call.toNumber : call.fromNumber
    }

    private func subtitle(_ call: APIClient.CallRecord) -> String {
        let status = call.status.isEmpty ? "" : call.status.capitalized
        let time = call.startedAt.map { Self.dateFormatter.string(from: $0) } ?? ""
        let direction = directionLabel(call)
        return [direction, status, time].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func isOutgoing(_ call: APIClient.CallRecord) -> Bool {
        call.direction?.lowercased() == "outgoing"
    }

    private func directionLabel(_ call: APIClient.CallRecord) -> String {
        guard let dir = call.direction?.lowercased(), !dir.isEmpty else { return "" }
        return isOutgoing(call) ? "Outgoing" : "Incoming"
    }

    private func directionImage(_ call: APIClient.CallRecord) -> UIImage? {
        guard let dir = call.direction?.lowercased(), !dir.isEmpty else { return nil }
        let name = isOutgoing(call) ? "arrow.up.right" : "arrow.down.left"
        return UIImage(systemName: name)
    }

    // MARK: - Table data

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(calls.count, 1)
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        var config = cell.defaultContentConfiguration()

        if calls.isEmpty {
            config.text = didLoadOnce ? "No calls yet" : "Loading…"
            config.textProperties.color = .secondaryLabel
            cell.accessoryType = .none
            cell.selectionStyle = .none
            cell.accessibilityIdentifier = "cell-history-empty"
            cell.contentConfiguration = config
            return cell
        }

        let call = calls[indexPath.row]
        let party = otherParty(call)
        config.text = party.isEmpty ? "Unknown" : party
        config.secondaryText = subtitle(call)
        config.secondaryTextProperties.color = .secondaryLabel
        if let image = directionImage(call) {
            config.image = image
            config.imageProperties.tintColor = isOutgoing(call) ? .systemBlue : .systemGreen
        }
        cell.selectionStyle = .default
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "cell-call-\(call.id)"
        cell.contentConfiguration = config
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !calls.isEmpty else { return }
        let call = calls[indexPath.row]
        let detail = CallDetailViewController(call: call, otherParty: otherParty(call))
        navigationController?.pushViewController(detail, animated: true)
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: "Something went wrong",
                                      message: error.localizedDescription,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
