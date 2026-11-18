import UIKit

/// Passive until an explicit button tap. No appearance/poll/voice callback saves memory.
@MainActor
final class ChatMemoryCardView: UIView {
    private let action: ChatMemoryAction
    private let pending: Bool
    private let stateLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private var expiryTask: Task<Void, Never>?

    init(action: ChatMemoryAction, pending: Bool, onSave: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.action = action; self.pending = pending
        super.init(frame: .zero)
        accessibilityIdentifier = "chat.memory.card"
        backgroundColor = .secondarySystemBackground
        layer.cornerRadius = 16
        layer.borderWidth = 1
        layer.borderColor = UIColor.systemTeal.withAlphaComponent(0.4).cgColor
        let stack = UIStackView()
        stack.axis = .vertical; stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14),
        ])
        func label(_ text: String, _ style: UIFont.TextStyle = .subheadline) -> UILabel {
            let v = UILabel(); v.text = text; v.numberOfLines = 0
            v.font = .preferredFont(forTextStyle: style); v.adjustsFontForContentSizeCategory = true
            return v
        }
        stack.addArrangedSubview(label(Self.tr("title"), .headline))
        stateLabel.numberOfLines = 0
        stateLabel.font = .preferredFont(forTextStyle: .subheadline)
        stateLabel.adjustsFontForContentSizeCategory = true
        stateLabel.accessibilityIdentifier = "chat.memory.state"
        stack.addArrangedSubview(stateLabel)
        for patch in action.patches {
            let title = patch.kind == "profile" ? Self.tr("profile") : Self.tr("card")
            stack.addArrangedSubview(label(title, .headline))
            for (key, snapshot) in [("before", patch.before), ("after", patch.after)] {
                var header = Self.tr(key)
                if let scope = snapshot.content?["profileScope"]?.string {
                    header += " · " + Self.scope(scope)
                }
                if let status = snapshot.state["status"]?.string, ["deleted", "inactive"].contains(status) {
                    header += " · " + Self.tr(status)
                }
                stack.addArrangedSubview(label(header, .caption1))
                let text = label(snapshot.displayText)
                if patch.after.state["documentOnly"] == .bool(true) {
                    let attributed = NSMutableAttributedString(string: snapshot.displayText)
                    var location = 0
                    for line in snapshot.displayText.components(separatedBy: "\n") {
                        let length = (line as NSString).length
                        if line.hasPrefix("⚠") {
                            attributed.addAttribute(.foregroundColor, value: UIColor.systemOrange,
                                range: NSRange(location: location, length: length))
                        }
                        location += length + 1
                    }
                    text.attributedText = attributed
                }
                text.accessibilityIdentifier = "chat.memory.\(key)"
                stack.addArrangedSubview(text)
            }
            let state = patch.after.state
            let source = state["source"]
            let kind = source?["kind"]?.string ?? "unknown"
            let sourceDate = source?["date"]?.string
            let date = sourceDate.flatMap(ChatMemoryAction.date)
            let formatter = DateFormatter(); formatter.dateStyle = .medium; formatter.timeStyle = .short
            let dateText = date.map { formatter.string(from: $0) } ?? Self.tr("unknown")
            let sourceText = ["user", "chat", "call", "user_form", "document"].contains(kind) ? Self.tr("source.\(kind)") : Self.tr("unknown")
            stack.addArrangedSubview(label("\(Self.tr("source")): \(sourceText) · \(dateText)", .caption1))
            let certainty = state["certainty"]?.string ?? "unknown"
            stack.addArrangedSubview(label(Self.tr(["confirmed", "assumed"].contains(certainty) ? certainty : "unknown"), .caption1))
            if let quote = source?["quote"]?.string, !quote.isEmpty {
                stack.addArrangedSubview(label("«\(quote)»", .caption1))
            }
            if case .array(let missing)? = state["missingFields"], !missing.isEmpty {
                stack.addArrangedSubview(label("\(Self.tr("missing")): \(missing.map(\.displayText).joined(separator: ", "))", .caption1))
            }
        }
        let buttons = UIStackView(arrangedSubviews: [saveButton, cancelButton])
        buttons.axis = .vertical; buttons.spacing = 8
        saveButton.setTitle(Self.tr("save"), for: .normal)
        cancelButton.setTitle(Self.tr("cancel"), for: .normal)
        for (button, name) in [(saveButton, "save"), (cancelButton, "cancel")] {
            button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.titleLabel?.numberOfLines = 0
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
            button.accessibilityIdentifier = "chat.memory.\(name)"
        }
        saveButton.addAction(UIAction { [weak self] _ in
            guard self?.canTap == true else { self?.refreshStatus(); return }; onSave()
        }, for: .touchUpInside)
        cancelButton.addAction(UIAction { [weak self] _ in
            guard self?.canTap == true else { self?.refreshStatus(); return }; onCancel()
        }, for: .touchUpInside)
        stack.addArrangedSubview(buttons)
        refreshStatus()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private var canTap: Bool { !pending && action.canDecide() }
    private static func tr(_ key: String) -> String { NSLocalizedString("chat.memory.\(key)", comment: "") }
    private static func scope(_ key: String) -> String {
        ["personal", "work", "shared"].contains(key) ? tr(key) : tr("unknown")
    }
    private func refreshStatus() {
        let status = action.effectiveStatus()
        let key = ["proposed", "saved", "cancelled", "expired", "stale"].contains(status) ? status : "unavailable"
        stateLabel.text = Self.tr(pending ? "pending" : key)
        saveButton.isEnabled = canTap; cancelButton.isEnabled = canTap
        saveButton.isHidden = !["proposed", "expired"].contains(status)
        cancelButton.isHidden = saveButton.isHidden
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        scheduleExpiry()
    }
    private func scheduleExpiry() {
        expiryTask?.cancel(); expiryTask = nil
        refreshStatus()
        guard window != nil, action.canDecide(), let deadline = ChatMemoryAction.date(action.expiresAt) else { return }
        let delay = min(86400, max(0.01, deadline.timeIntervalSinceNow))
        expiryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.scheduleExpiry()
        }
    }
    deinit { expiryTask?.cancel() }
}
