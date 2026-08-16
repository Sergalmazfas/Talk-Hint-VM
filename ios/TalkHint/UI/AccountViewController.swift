import UIKit

/// "Account" tab — shows who is signed in, their plan / subscription status
/// (read-only) and their active phone number, plus logout. The networking
/// foundation here (plan + numbers) is reused by later stages.
final class AccountViewController: UIViewController {
    var onLoggedOut: (() -> Void)?

    private let emailValue = UILabel()
    private let planValue = UILabel()
    private let statusValue = UILabel()
    private let numberValue = UILabel()
    private let logoutButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = NSLocalizedString("account.title", comment: "")
        view.backgroundColor = .systemGroupedBackground
        buildUI()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        emailValue.text = SessionStore.shared.email ?? "—"
        reload()
    }

    private func buildUI() {
        let card = UIStackView(arrangedSubviews: [
            row(title: NSLocalizedString("account.signed_in_as", comment: ""), valueLabel: emailValue, testId: "email"),
            separator(),
            row(title: NSLocalizedString("account.plan", comment: ""), valueLabel: planValue, testId: "plan"),
            separator(),
            row(title: NSLocalizedString("account.subscription", comment: ""), valueLabel: statusValue, testId: "status"),
            separator(),
            row(title: NSLocalizedString("account.phone_number", comment: ""), valueLabel: numberValue, testId: "number"),
        ])
        card.axis = .vertical
        card.spacing = 0
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 12
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 4, right: 16)
        card.translatesAutoresizingMaskIntoConstraints = false

        logoutButton.setTitle(NSLocalizedString("account.log_out", comment: ""), for: .normal)
        logoutButton.setTitleColor(.systemRed, for: .normal)
        logoutButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        logoutButton.addTarget(self, action: #selector(logoutTapped), for: .touchUpInside)
        logoutButton.accessibilityIdentifier = "button-logout"
        logoutButton.translatesAutoresizingMaskIntoConstraints = false

        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false

        let outer = UIStackView(arrangedSubviews: [card, spinner, logoutButton])
        outer.axis = .vertical
        outer.spacing = 24
        outer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(outer)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            outer.topAnchor.constraint(equalTo: guide.topAnchor, constant: 24),
            outer.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            outer.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
        ])
    }

    private func row(title: String, valueLabel: UILabel, testId: String) -> UIView {
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .preferredFont(forTextStyle: .subheadline)
        titleLabel.textColor = .secondaryLabel

        valueLabel.text = "—"
        valueLabel.font = .preferredFont(forTextStyle: .body)
        valueLabel.textAlignment = .right
        valueLabel.numberOfLines = 0
        valueLabel.accessibilityIdentifier = "text-account-\(testId)"
        valueLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let row = UIStackView(arrangedSubviews: [titleLabel, valueLabel])
        row.axis = .horizontal
        row.spacing = 12
        row.alignment = .firstBaseline
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 14, left: 0, bottom: 14, right: 0)
        titleLabel.setContentHuggingPriority(.required, for: .horizontal)
        return row
    }

    private func separator() -> UIView {
        let line = UIView()
        line.backgroundColor = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        line.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale).isActive = true
        return line
    }

    private func reload() {
        spinner.startAnimating()
        Task { @MainActor in
            async let planResult = APIClient.shared.subscription()
            async let numbersResult = APIClient.shared.numbers()

            if let info = try? await planResult {
                planValue.text = info.plan.capitalized
                statusValue.text = info.hasStripeCustomer ? NSLocalizedString("account.status.active", comment: "") : NSLocalizedString("account.status.none", comment: "")
            } else {
                planValue.text = NSLocalizedString("account.unavailable", comment: "")
                statusValue.text = NSLocalizedString("account.unavailable", comment: "")
            }

            if let numbers = try? await numbersResult {
                let active = numbers.first(where: { $0.id == SessionStore.shared.activeNumberId }) ?? numbers.first
                if let active = active {
                    let label = active.name.isEmpty ? active.number : String(format: NSLocalizedString("account.number.label", comment: ""), active.name, active.number)
                    numberValue.text = numbers.count > 1 ? String(format: NSLocalizedString("account.number.more", comment: ""), label, numbers.count - 1) : label
                } else {
                    numberValue.text = NSLocalizedString("account.number.none", comment: "")
                }
            } else {
                numberValue.text = NSLocalizedString("account.unavailable", comment: "")
            }

            spinner.stopAnimating()
        }
    }

    @objc private func logoutTapped() {
        logoutButton.isEnabled = false
        Task {
            await PushManager.shared.unregisterCurrentToken()
            await APIClient.shared.logout()
            SessionStore.shared.clear()
            onLoggedOut?()
        }
    }
}
