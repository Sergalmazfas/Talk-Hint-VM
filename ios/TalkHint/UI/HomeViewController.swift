import UIKit

/// "Calls" tab — the landing screen after login. Shows that the app is ready to
/// receive calls and lets the user place an outbound call to a typed number,
/// reusing the existing Twilio voice flow (`CallManager`). Incoming calls are
/// presented over this (or any) tab by `CallManager`.
final class HomeViewController: UIViewController {

    private let statusLabel = UILabel()
    private let numberField = UITextField()
    private let callButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Calls"
        view.backgroundColor = .systemBackground
        buildUI()

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }

    private func buildUI() {
        let iconView = UIImageView(image: UIImage(systemName: "phone.badge.waveform.fill"))
        iconView.tintColor = .systemGreen
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.heightAnchor.constraint(equalToConstant: 56).isActive = true

        statusLabel.text = "Ready for calls.\nIncoming calls will ring on this iPhone."
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "text-call-status"

        numberField.placeholder = "+1 555 123 4567"
        numberField.keyboardType = .phonePad
        numberField.borderStyle = .roundedRect
        numberField.font = .preferredFont(forTextStyle: .title3)
        numberField.textAlignment = .center
        numberField.accessibilityIdentifier = "input-dial-number"

        if #available(iOS 15.0, *) {
            var config = UIButton.Configuration.filled()
            config.cornerStyle = .large
            config.baseBackgroundColor = .systemGreen
            config.image = UIImage(systemName: "phone.fill")
            config.imagePadding = 8
            config.title = "Call"
            callButton.configuration = config
        } else {
            callButton.setTitle("Call", for: .normal)
            callButton.setTitleColor(.white, for: .normal)
            callButton.backgroundColor = .systemGreen
            callButton.layer.cornerRadius = 12
        }
        callButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        callButton.addTarget(self, action: #selector(callTapped), for: .touchUpInside)
        callButton.accessibilityIdentifier = "button-start-call"
        callButton.translatesAutoresizingMaskIntoConstraints = false
        callButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true

        let dialer = UIStackView(arrangedSubviews: [numberField, callButton])
        dialer.axis = .vertical
        dialer.spacing = 12

        let stack = UIStackView(arrangedSubviews: [iconView, statusLabel, dialer])
        stack.axis = .vertical
        stack.spacing = 28
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    @objc private func callTapped() {
        view.endEditing(true)
        let raw = numberField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleaned = raw.components(separatedBy: CharacterSet(charactersIn: " -()")).joined()

        // The backend only routes outbound dials to E.164 numbers (leading "+").
        guard cleaned.range(of: "^\\+[1-9]\\d{6,14}$", options: .regularExpression) != nil else {
            let alert = UIAlertController(
                title: "Enter a valid number",
                message: "Use international format, for example +15551234567.",
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
            return
        }

        CallManager.shared.startOutgoingCall(to: cleaned)
    }
}
