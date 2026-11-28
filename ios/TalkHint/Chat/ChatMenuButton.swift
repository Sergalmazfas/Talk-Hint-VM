import UIKit

/// Two short lines and an accent dot, as in the owner's reference.
/// The dot is decorative, not an unread/status indicator.
final class ChatMenuButton: UIButton {
    init(title: String) {
        super.init(frame: .zero)
        accessibilityLabel = title
        accessibilityIdentifier = "chat-menu"
        backgroundColor = .secondarySystemBackground
        layer.cornerRadius = 22
        isOpaque = false
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.55 : 1 }
    }
    override func draw(_ rect: CGRect) {
        super.draw(rect)
        let x = bounds.midX, y = bounds.midY
        UIColor.label.setStroke()
        let lines = UIBezierPath()
        lines.lineWidth = 2
        lines.lineCapStyle = .round
        lines.move(to: CGPoint(x: x - 8, y: y - 4))
        lines.addLine(to: CGPoint(x: x + 1, y: y - 4))
        lines.move(to: CGPoint(x: x - 8, y: y + 5))
        lines.addLine(to: CGPoint(x: x + 5, y: y + 5))
        lines.stroke()
        UIColor.systemBlue.setFill()
        UIBezierPath(ovalIn: CGRect(x: x + 4, y: y - 9, width: 7, height: 7)).fill()
    }
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        setNeedsDisplay()
    }
}

/// Shared visual treatment for real and explicitly unavailable destinations.
final class ChatDrawerButton: UIButton {
    init(title: String, symbol: String) {
        super.init(frame: .zero)
        var style = UIButton.Configuration.plain()
        style.title = title
        style.image = UIImage(systemName: symbol)
        style.imagePadding = 12
        style.baseForegroundColor = .label
        style.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
        configuration = style
        contentHorizontalAlignment = .leading
        titleLabel?.font = .preferredFont(forTextStyle: .body)
        titleLabel?.adjustsFontForContentSizeCategory = true
        titleLabel?.numberOfLines = 0
        heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
