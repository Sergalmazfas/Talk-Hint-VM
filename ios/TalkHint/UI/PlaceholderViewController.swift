import UIKit

/// Reusable placeholder for tabs whose features arrive in later stages
/// (Numbers, Assistant, History). Keeps the navigation shell complete so
/// each later stage can drop its real screen into an existing tab.
final class PlaceholderViewController: UIViewController {

    private let featureTitle: String
    private let message: String
    private let systemImageName: String

    init(featureTitle: String, message: String, systemImageName: String) {
        self.featureTitle = featureTitle
        self.message = message
        self.systemImageName = systemImageName
        super.init(nibName: nil, bundle: nil)
        title = featureTitle
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let iconView = UIImageView(image: UIImage(systemName: systemImageName))
        iconView.tintColor = .tertiaryLabel
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.heightAnchor.constraint(equalToConstant: 56).isActive = true

        let titleLabel = UILabel()
        titleLabel.text = featureTitle
        titleLabel.font = .preferredFont(forTextStyle: .title3)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        let messageLabel = UILabel()
        messageLabel.text = message
        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        messageLabel.accessibilityIdentifier = "text-placeholder-message"

        let stack = UIStackView(arrangedSubviews: [iconView, titleLabel, messageLabel])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }
}
