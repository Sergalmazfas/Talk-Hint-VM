import UIKit

/// The hint is decoration, never editable text, a draft, or an API payload.
final class ChatComposerTextView: UITextView {
    private let hint = UILabel()

    var placeholder: String = "" {
        didSet { hint.text = placeholder; setNeedsLayout() }
    }
    override var text: String! {
        didSet { refreshPlaceholder() }
    }
    override var font: UIFont? {
        didSet { hint.font = font; setNeedsLayout() }
    }

    init() {
        super.init(frame: .zero, textContainer: nil)
        hint.textColor = .secondaryLabel
        hint.numberOfLines = 0
        hint.isUserInteractionEnabled = false
        hint.isAccessibilityElement = false
        addSubview(hint)
        NotificationCenter.default.addObserver(self, selector: #selector(refreshPlaceholder),
            name: UITextView.textDidChangeNotification, object: self)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { NotificationCenter.default.removeObserver(self) }

    @objc func refreshPlaceholder() {
        hint.isHidden = !(text ?? "").isEmpty
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let x = textContainerInset.left + textContainer.lineFragmentPadding
        let width = max(0, bounds.width - x - textContainerInset.right - textContainer.lineFragmentPadding)
        hint.frame = CGRect(origin: CGPoint(x: x, y: textContainerInset.top),
            size: hint.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)))
    }
}
