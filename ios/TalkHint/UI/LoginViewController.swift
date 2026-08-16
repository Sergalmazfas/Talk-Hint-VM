import UIKit
import AuthenticationServices

final class LoginViewController: UIViewController {
    var onLoggedIn: (() -> Void)?

    private let emailField = UITextField()
    private let passwordField = UITextField()
    private let loginButton = UIButton(type: .system)
    private let googleButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var authSession: ASWebAuthenticationSession?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "TalkHint"
        view.backgroundColor = .systemBackground
        buildUI()
    }

    private func buildUI() {
        emailField.placeholder = NSLocalizedString("login.email.placeholder", comment: "")
        emailField.keyboardType = .emailAddress
        emailField.autocapitalizationType = .none
        emailField.autocorrectionType = .no
        emailField.borderStyle = .roundedRect
        emailField.accessibilityIdentifier = "input-email"

        passwordField.placeholder = NSLocalizedString("login.password.placeholder", comment: "")
        passwordField.isSecureTextEntry = true
        passwordField.borderStyle = .roundedRect
        passwordField.accessibilityIdentifier = "input-password"

        loginButton.setTitle(NSLocalizedString("login.button.login", comment: ""), for: .normal)
        loginButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        loginButton.addTarget(self, action: #selector(loginTapped), for: .touchUpInside)
        loginButton.accessibilityIdentifier = "button-login"

        googleButton.setTitle(NSLocalizedString("login.button.google", comment: ""), for: .normal)
        googleButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        googleButton.addTarget(self, action: #selector(googleTapped), for: .touchUpInside)
        googleButton.accessibilityIdentifier = "button-google-login"

        statusLabel.numberOfLines = 0
        statusLabel.textColor = .systemRed
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.accessibilityIdentifier = "text-login-status"

        let stack = UIStackView(arrangedSubviews: [emailField, passwordField, loginButton, googleButton, spinner, statusLabel])
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
            statusLabel.text = NSLocalizedString("login.error.empty_fields", comment: "")
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

    @objc private func googleTapped() {
        statusLabel.text = nil
        guard let url = APIClient.shared.googleLoginURL else {
            statusLabel.text = NSLocalizedString("login.error.google_start", comment: "")
            return
        }

        setLoading(true)

        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "talkhint") { [weak self] callbackURL, error in
            guard let self = self else { return }

            if let error = error {
                self.setLoading(false)
                let nsErr = error as NSError
                // User tapped Cancel — not an error worth showing.
                if nsErr.code == ASWebAuthenticationSessionError.canceledLogin.rawValue { return }
                self.statusLabel.text = error.localizedDescription
                return
            }

            guard let callbackURL = callbackURL,
                  let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                self.setLoading(false)
                self.statusLabel.text = NSLocalizedString("login.error.google_failed", comment: "")
                return
            }

            let items = comps.queryItems ?? []
            if let token = items.first(where: { $0.name == "token" })?.value {
                self.finishGoogleLogin(token: token)
            } else {
                self.setLoading(false)
                let reason = items.first(where: { $0.name == "error" })?.value ?? "unknown_error"
                self.statusLabel.text = String(format: NSLocalizedString("login.error.google_failed_reason", comment: ""), reason)
            }
        }

        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }

    private func finishGoogleLogin(token: String) {
        Task {
            do {
                let me = try await APIClient.shared.me(token: token)
                SessionStore.shared.save(token: token, userId: me.userId, email: me.email)
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
        googleButton.isEnabled = !loading
        loading ? spinner.startAnimating() : spinner.stopAnimating()
    }
}

extension LoginViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }
}
