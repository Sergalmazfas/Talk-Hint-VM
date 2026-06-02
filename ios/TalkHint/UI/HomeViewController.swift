import UIKit

final class HomeViewController: UIViewController {
    var onLoggedOut: (() -> Void)?

    private let statusLabel = UILabel()
    private let emailLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "TalkHint"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Log Out", style: .plain, target: self, action: #selector(logoutTapped))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-logout"
        buildUI()
    }

    private func buildUI() {
        emailLabel.text = "Signed in as \(SessionStore.shared.email ?? "")"
        emailLabel.font = .preferredFont(forTextStyle: .headline)
        emailLabel.textAlignment = .center
        emailLabel.numberOfLines = 0
        emailLabel.accessibilityIdentifier = "text-user-email"

        statusLabel.text = "Ready for calls. Incoming calls will ring on this iPhone."
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "text-call-status"

        let stack = UIStackView(arrangedSubviews: [emailLabel, statusLabel])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])
    }

    @objc private func logoutTapped() {
        Task {
            await PushManager.shared.unregisterCurrentToken()
            await APIClient.shared.logout()
            SessionStore.shared.clear()
            onLoggedOut?()
        }
    }
}
