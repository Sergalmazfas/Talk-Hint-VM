import UIKit

/// Key presses go to the already connected call, not the dialer/assistant.
/// The scrolling keypad and pinned close button also fit compact-height phones.
final class InCallKeypadViewController: UIViewController {
    private let sendDigits: (String) -> Bool
    private let digitsLabel = UILabel()
    private let errorLabel = UILabel()
    private var displayedDigits = ""

    init(sendDigits: @escaping (String) -> Bool) {
        self.sendDigits = sendDigits
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        if let sheet = sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        let title = UILabel()
        title.text = NSLocalizedString("incall.keypad.title", comment: "")
        title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center
        digitsLabel.font = .monospacedDigitSystemFont(ofSize: 24, weight: .medium)
        digitsLabel.textAlignment = .center
        digitsLabel.accessibilityIdentifier = "incall-keypad-digits"
        digitsLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
        errorLabel.font = .preferredFont(forTextStyle: .footnote)
        errorLabel.textColor = .systemRed
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.accessibilityIdentifier = "incall-keypad-error"
        errorLabel.isHidden = true
        let header = UIStackView(arrangedSubviews: [title, digitsLabel, errorLabel])
        header.axis = .vertical
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let keys = UIStackView()
        keys.axis = .vertical
        keys.spacing = 10
        keys.translatesAutoresizingMaskIntoConstraints = false
        for digits in ["123", "456", "789", "*0#"] {
            let row = UIStackView()
            row.axis = .horizontal
            row.distribution = .fillEqually
            row.spacing = 12
            for digit in digits {
                let button = UIButton(type: .system)
                button.setTitle(String(digit), for: .normal)
                button.titleLabel?.font = .systemFont(ofSize: 28, weight: .medium)
                button.backgroundColor = Theme.fill
                button.tintColor = Theme.ink
                button.layer.cornerRadius = 16
                button.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
                button.accessibilityIdentifier = "incall-dtmf-\(digit)"
                button.addTarget(self, action: #selector(digitTapped(_:)), for: .touchUpInside)
                row.addArrangedSubview(button)
            }
            keys.addArrangedSubview(row)
        }
        scroll.addSubview(keys)
        let close = UIButton(type: .system)
        close.setTitle(NSLocalizedString("incall.keypad.close", comment: ""), for: .normal)
        close.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        close.accessibilityIdentifier = "incall-keypad-close"
        close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        [header, scroll, close].forEach(view.addSubview)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor, constant: 24),
            header.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24),
            header.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            scroll.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24),
            scroll.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            scroll.bottomAnchor.constraint(equalTo: close.topAnchor, constant: -8),
            close.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24),
            close.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            close.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -8),
            keys.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            keys.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            keys.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            keys.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            keys.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])
    }

    @objc private func digitTapped(_ sender: UIButton) {
        guard let digit = sender.title(for: .normal) else { return }
        guard sendDigits(digit) else {
            errorLabel.text = NSLocalizedString("incall.keypad.unavailable", comment: "")
            errorLabel.isHidden = false
            return
        }
        errorLabel.isHidden = true
        displayedDigits = String((displayedDigits + digit).suffix(24))
        digitsLabel.text = displayedDigits
    }

    @objc private func closeTapped() { dismiss(animated: true) }
}
