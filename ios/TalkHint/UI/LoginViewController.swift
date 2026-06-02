import UIKit

final class LoginViewController: UIViewController {
    var onLoggedIn: (() -> Void)?

    private let emailField = UITextField()
    private let passwordField = UITextField()
    private let loginButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "TalkHint"
        view.backgroundColor = .systemBackground
        buildUI()
    }

    private func buildUI() {
        emailField.placeholder = "Email"
        emailField.keyboardType = .emailAddress
        emailField.autocapitalizationType = .none
        emailField.autocorrectionType = .no
        emailField.borderStyle = .roundedRect
        emailField.accessibilityIdentifier = "input-email"

        passwordField.placeholder = "Password"
        passwordField.isSecureTextEntry = true
        passwordField.borderStyle = .roundedRect
        passwordField.accessibilityIdentifier = "input-password"

        loginButton.setTitle("Log In", for: .normal)
        loginButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        loginButton.addTarget(self, action: #selector(loginTapped), for: .touchUpInside)
        loginButton.accessibilityIdentifier = "button-login"

        statusLabel.numberOfLines = 0
        statusLabel.textColor = .systemRed
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.accessibilityIdentifier = "text-login-status"

        let stack = UIStackView(arrangedSubviews: [emailField, passwordField, loginButton, spinner, statusLabel])
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

    @objc private func loginTapped() {
        let email = emailField.text?.trimmingCharacters(in: .whitespaces) ?? ""
        let password = passwordField.text ?? ""
        guard !email.isEmpty, !password.isEmpty else {
            statusLabel.text = "Enter your email and password."
            return
        }

        statusLabel.text = nil
        setLoading(true)

        Task {
            do {
                let result = try await APIClient.shared.login(email: email, password: password)
                SessionStore.shared.save(token: result.token, userId: result.userId, email: result.email)
                setLoading(false)
                onLoggedIn?()
            } catch {
                setLoading(false)
                statusLabel.text = error.localizedDescription
            }
        }
    }

    private func setLoading(_ loading: Bool) {
        loginButton.isEnabled = !loading
        loading ? spinner.startAnimating() : spinner.stopAnimating()
    }
}
