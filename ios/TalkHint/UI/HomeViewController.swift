import UIKit

/// "Calls" tab — the landing screen after login. Shows that the app is ready to
/// receive calls. Incoming calls are presented over this (or any) tab by
/// `CallManager`. Account info and logout live in the Account tab.
final class HomeViewController: UIViewController {

    private let statusLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Calls"
        view.backgroundColor = .systemBackground
        buildUI()
    }

    private func buildUI() {
        let iconView = UIImageView(image: UIImage(systemName: "phone.badge.waveform.fill"))
        iconView.tintColor = .systemGreen
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.heightAnchor.constraint(equalToConstant: 64).isActive = true

        statusLabel.text = "Ready for calls.\nIncoming calls will ring on this iPhone."
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "text-call-status"

        let stack = UIStackView(arrangedSubviews: [iconView, statusLabel])
        stack.axis = .vertical
        stack.spacing = 20
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])
    }
}
