import UIKit

/// Shows the full transcript and metadata for a single past call. The list
/// already provides a `CallRecord`; on load we re-fetch by id to get the freshest
/// transcript (the list payload may be trimmed).
final class CallDetailViewController: UITableViewController {

    private var call: APIClient.CallRecord
    private let otherParty: String
    private var loadingTranscript = true

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    init(call: APIClient.CallRecord, otherParty: String) {
        self.call = call
        self.otherParty = otherParty
        super.init(style: .insetGrouped)
        let name = call.contactName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name, !name.isEmpty {
            title = name
        } else {
            title = otherParty.isEmpty ? NSLocalizedString("call_detail.title.call", comment: "") : otherParty
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.accessibilityIdentifier = "table-call-detail"
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        loadTranscript()
    }

    private func loadTranscript() {
        Task {
            do {
                let fresh = try await APIClient.shared.call(id: call.id)
                await MainActor.run {
                    self.call = fresh
                    self.loadingTranscript = false
                    self.tableView.reloadData()
                }
            } catch {
                // Fall back to the record handed in from the list.
                await MainActor.run {
                    self.loadingTranscript = false
                    self.tableView.reloadData()
                }
            }
        }
    }

    // MARK: - Sections

    private enum Section: Int, CaseIterable {
        case details
        case transcript
    }

    private struct DetailRow { let key: String; let label: String; let value: String }

    private var detailRows: [DetailRow] {
        var rows: [DetailRow] = []
        let name = call.contactName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name, !name.isEmpty {
            rows.append(DetailRow(key: "with", label: NSLocalizedString("call_detail.field.with", comment: ""), value: name))
            if !otherParty.isEmpty {
                rows.append(DetailRow(key: "number", label: NSLocalizedString("call_detail.field.number", comment: ""), value: otherParty))
            }
        } else {
            rows.append(DetailRow(key: "with", label: NSLocalizedString("call_detail.field.with", comment: ""), value: otherParty.isEmpty ? NSLocalizedString("call_detail.value.unknown", comment: "") : otherParty))
        }
        if !call.status.isEmpty {
            rows.append(DetailRow(key: "status", label: NSLocalizedString("call_detail.field.status", comment: ""), value: call.status.capitalized))
        }
        if let started = call.startedAt {
            rows.append(DetailRow(key: "started", label: NSLocalizedString("call_detail.field.started", comment: ""), value: Self.dateFormatter.string(from: started)))
        }
        if let ended = call.endedAt {
            rows.append(DetailRow(key: "ended", label: NSLocalizedString("call_detail.field.ended", comment: ""), value: Self.dateFormatter.string(from: ended)))
        }
        return rows
    }

    // MARK: - Table data

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section) {
        case .details: return NSLocalizedString("call_detail.section.details", comment: "")
        case .transcript: return nil // custom header with a copy button
        case .none: return nil
        }
    }

    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        guard Section(rawValue: section) == .transcript else { return nil }
        let container = UIView()

        let label = UILabel()
        label.text = NSLocalizedString("call_detail.transcript.header", comment: "")
        label.font = .preferredFont(forTextStyle: .footnote)
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false

        let copyButton = UIButton(type: .system)
        copyButton.setImage(UIImage(systemName: "doc.on.doc"), for: .normal)
        copyButton.accessibilityIdentifier = "button-copy-transcript"
        copyButton.accessibilityLabel = NSLocalizedString("call_detail.copy_transcript", comment: "")
        copyButton.addTarget(self, action: #selector(copyTranscriptTapped(_:)), for: .touchUpInside)
        copyButton.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(label)
        container.addSubview(copyButton)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.layoutMarginsGuide.leadingAnchor),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -6),
            copyButton.trailingAnchor.constraint(equalTo: container.layoutMarginsGuide.trailingAnchor),
            copyButton.centerYAnchor.constraint(equalTo: label.centerYAnchor),
            copyButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            copyButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 32),
            container.heightAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])
        return container
    }

    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        Section(rawValue: section) == .transcript ? 44 : UITableView.automaticDimension
    }

    private var copyableTranscript: String? {
        guard !loadingTranscript else { return nil }
        let text = call.transcript?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    @objc private func copyTranscriptTapped(_ sender: UIButton) {
        guard let text = copyableTranscript else { return }
        UIPasteboard.general.string = text
        // Brief visual confirmation: swap to a checkmark, then back.
        sender.setImage(UIImage(systemName: "checkmark"), for: .normal)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak sender] in
            sender?.setImage(UIImage(systemName: "doc.on.doc"), for: .normal)
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section) {
        case .details: return detailRows.count
        case .transcript: return 1
        case .none: return 0
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.selectionStyle = .none

        switch Section(rawValue: indexPath.section) {
        case .details:
            var config = cell.valueCellConfiguration()
            let row = detailRows[indexPath.row]
            config.text = row.label
            config.secondaryText = row.value
            cell.accessibilityIdentifier = "text-detail-\(row.key)"
            cell.contentConfiguration = config

        case .transcript:
            var config = cell.defaultContentConfiguration()
            let transcript = call.transcript?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if loadingTranscript {
                config.text = NSLocalizedString("common.loading", comment: "")
                config.textProperties.color = .secondaryLabel
            } else if transcript.isEmpty {
                config.text = NSLocalizedString("call_detail.no_transcript", comment: "")
                config.textProperties.color = .secondaryLabel
            } else {
                config.text = transcript
                config.textProperties.numberOfLines = 0
            }
            cell.accessibilityIdentifier = "text-transcript"
            cell.contentConfiguration = config

        case .none:
            break
        }
        return cell
    }

    // MARK: - Long-press copy on the transcript cell

    override func tableView(_ tableView: UITableView, shouldShowMenuForRowAt indexPath: IndexPath) -> Bool {
        Section(rawValue: indexPath.section) == .transcript && copyableTranscript != nil
    }

    override func tableView(_ tableView: UITableView, canPerformAction action: Selector, forRowAt indexPath: IndexPath, withSender sender: Any?) -> Bool {
        Section(rawValue: indexPath.section) == .transcript && action == #selector(copy(_:))
    }

    override func tableView(_ tableView: UITableView, performAction action: Selector, forRowAt indexPath: IndexPath, withSender sender: Any?) {
        if action == #selector(copy(_:)), let text = copyableTranscript {
            UIPasteboard.general.string = text
        }
    }
}

private extension UITableViewCell {
    /// A value-style content configuration (label left, value right) that falls
    /// back gracefully across iOS versions.
    func valueCellConfiguration() -> UIListContentConfiguration {
        var config = UIListContentConfiguration.valueCell()
        config.secondaryTextProperties.color = .secondaryLabel
        return config
    }
}
