import UIKit

/// Read-only ChatGPT plans. No call, selection, confirmation or mutation callbacks.
@MainActor
final class PreparedHintPlansView: UIStackView {
    var loadPlans: () async throws -> PreparedHintPlansResponse = {
        try await APIClient.shared.preparedHintPlans()
    }
    private let content = UIStackView()
    private var task: Task<Void, Never>?
    private var timer: Timer?
    private var generation = 0
    private var snapshot: PreparedHintPlansResponse?
    private var clockOffset: TimeInterval = 0
    private var visibleIDs: [String] = []

    init() {
        super.init(frame: .zero)
        axis = .vertical
        spacing = 10
        accessibilityIdentifier = "prepare-saved-plans"
        addArrangedSubview(label("prepare.saved.title", style: .headline))
        let refresh = UIButton(type: .system)
        refresh.setTitle(NSLocalizedString("prepare.saved.refresh", comment: ""), for: .normal)
        refresh.accessibilityIdentifier = "button-prepare-saved-refresh"
        refresh.addTarget(self, action: #selector(refreshTapped), for: .touchUpInside)
        addArrangedSubview(refresh)
        content.axis = .vertical
        content.spacing = 12
        addArrangedSubview(content)
    }
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func label(_ key: String, style: UIFont.TextStyle = .body) -> UILabel {
        let view = UILabel()
        view.text = NSLocalizedString(key, comment: "")
        view.font = .preferredFont(forTextStyle: style)
        view.adjustsFontForContentSizeCategory = true
        view.numberOfLines = 0
        return view
    }
    private func clear() {
        content.arrangedSubviews.forEach { content.removeArrangedSubview($0); $0.removeFromSuperview() }
    }
    private func message(_ key: String) {
        clear()
        let text = label(key)
        text.accessibilityIdentifier = "text-prepare-saved-state"
        content.addArrangedSubview(text)
    }
    @objc private func refreshTapped() { refresh() }

    func refresh() {
        stopLoading()
        snapshot = nil
        visibleIDs = []
        message("prepare.saved.loading")
        let current = generation
        let loader = loadPlans
        task = Task { [weak self] in
            guard !Task.isCancelled, self?.generation == current else { return }
            do {
                let response = try await loader()
                guard let self, !Task.isCancelled, self.generation == current else { return }
                let parser = ISO8601DateFormatter()
                parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                self.clockOffset = (parser.date(from: response.serverTime) ?? Date()).timeIntervalSinceNow
                self.render(response, at: Date().addingTimeInterval(self.clockOffset))
                self.timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                    // UIKit timer is installed on the main actor's main run loop.
                    Task { @MainActor [weak self] in self?.expireVisiblePlans() }
                }
            } catch {
                guard let self, !Task.isCancelled, self.generation == current else { return }
                self.message("prepare.saved.error")
            }
        }
    }

    func stopLoading() {
        generation += 1
        task?.cancel()
        task = nil
        timer?.invalidate()
        timer = nil
    }

    private func expireVisiblePlans() {
        guard let snapshot else { return }
        let now = Date().addingTimeInterval(clockOffset)
        let ids = snapshot.plans.filter { $0.isUsable(at: now) }.map(\.id)
        if ids != visibleIDs { render(snapshot, at: now) }
    }

    /// Internal for offline XCTest fixtures. Server filters consumed/superseded plans.
    func render(_ response: PreparedHintPlansResponse, at now: Date) {
        snapshot = response
        let plans = response.plans.filter { $0.isUsable(at: now) }
        visibleIDs = plans.map(\.id)
        clear()
        guard !plans.isEmpty else { message("prepare.saved.empty"); return }
        for item in plans {
            let card = UIStackView()
            card.axis = .vertical
            card.spacing = 8
            card.isLayoutMarginsRelativeArrangement = true
            card.layoutMargins = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
            card.backgroundColor = .secondarySystemBackground
            card.layer.cornerRadius = 12
            card.accessibilityIdentifier = "prepare-saved-plan-\(item.id)"
            func add(_ key: String, _ text: String) {
                guard !text.isEmpty else { return }
                let field = label(key)
                field.text = "\(NSLocalizedString(key, comment: ""))\n\(text)"
                card.addArrangedSubview(field)
            }
            add("prepare.saved.goal", item.plan.goal)
            add("prepare.saved.target", item.plan.targetPhone ?? NSLocalizedString("prepare.saved.next_call", comment: ""))
            if let expiration = item.expiration {
                add("prepare.saved.expires", DateFormatter.localizedString(from: expiration, dateStyle: .medium, timeStyle: .short))
            }
            add("prepare.saved.facts", item.plan.ownerFacts.joined(separator: "\n"))
            add("prepare.saved.say_ask", item.plan.sayAsk.joined(separator: "\n"))
            add("prepare.saved.questions", item.plan.expectedQuestions.map {
                let answer = $0.answer.flatMap { $0.isEmpty ? nil : $0 } ?? NSLocalizedString("prepare.saved.unknown_answer", comment: "")
                return "\($0.q)\n\(answer)"
            }.joined(separator: "\n\n"))
            add("prepare.saved.unknowns", item.plan.unknowns.joined(separator: "\n"))
            add("prepare.saved.allowed", item.plan.disclosurePolicy.allowed.joined(separator: "\n"))
            add("prepare.saved.forbidden", item.plan.disclosurePolicy.forbidden.joined(separator: "\n"))
            card.addArrangedSubview(label("prepare.saved.automatic", style: .footnote))
            content.addArrangedSubview(card)
        }
    }
}
