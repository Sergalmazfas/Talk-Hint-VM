import UIKit

enum HintVisibility {
    /// Conservative: text must fit inside every clipping ancestor, not just window.
    static func isVisible(_ target: UIView) -> Bool {
        guard UIApplication.shared.applicationState == .active,
              let window = target.window, !target.bounds.isEmpty else { return false }
        let rect = target.convert(target.bounds, to: window)
        guard window.bounds.contains(rect) else { return false }
        var ancestor: UIView? = target
        while let node = ancestor {
            if node.isHidden || node.alpha < 0.01 { return false }
            if node.clipsToBounds && !node.convert(node.bounds, to: window).contains(rect) { return false }
            ancestor = node.superview
        }
        return true
    }
}

/// Content scrolls instead of compressing bilingual replies into overlapping lines.
final class HintBannerScrollView: UIScrollView {
    override var contentSize: CGSize {
        didSet {
            if oldValue.height != contentSize.height { invalidateIntrinsicContentSize() }
        }
    }
    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: min(contentSize.height, 280))
    }
}

/// UIButton's multiline attributed title does not reliably measure its wrapped
/// height in a vertical stack. Two real labels have explicit width and height.
final class HintChoiceButton: UIButton {
    let englishLabel = UILabel()
    let translationLabel = UILabel()
    private let textStack = UIStackView()
    private var measuredWidth: CGFloat = 0

    init(english: String, translation: String, primary: Bool) {
        super.init(frame: .zero)
        layer.cornerRadius = 12
        layer.borderWidth = 1
        layer.borderColor = Theme.line.cgColor
        backgroundColor = primary ? Theme.purple : .white
        englishLabel.text = english
        englishLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        englishLabel.textColor = primary ? .white : Theme.ink
        translationLabel.text = translation
        translationLabel.font = .systemFont(ofSize: 14)
        translationLabel.textColor = primary ? UIColor.white.withAlphaComponent(0.9) : Theme.sub
        translationLabel.isHidden = translation.isEmpty
        for label in [englishLabel, translationLabel] {
            label.numberOfLines = 0
            label.lineBreakMode = .byWordWrapping
            label.setContentCompressionResistancePriority(.required, for: .vertical)
            textStack.addArrangedSubview(label)
        }
        textStack.axis = .vertical
        textStack.spacing = 5
        textStack.isUserInteractionEnabled = false
        textStack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(textStack)
        NSLayoutConstraint.activate([
            textStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            textStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            textStack.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            textStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
        ])
        setContentCompressionResistancePriority(.required, for: .vertical)
        accessibilityLabel = [english, translation].filter { !$0.isEmpty }.joined(separator: "\n")
        accessibilityValue = english
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.width != measuredWidth {
            measuredWidth = bounds.width
            invalidateIntrinsicContentSize()
        }
    }
    override var intrinsicContentSize: CGSize {
        let width = max(1, (bounds.width > 0 ? bounds.width : 280) - 28)
        let size = textStack.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
        return CGSize(width: UIView.noIntrinsicMetric, height: ceil(size.height) + 20)
    }
}
