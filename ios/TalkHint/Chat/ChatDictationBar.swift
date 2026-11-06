import UIKit

@MainActor
final class ChatDictationBar: UIView {
    enum Mode {
        case permission
        case recording
        case recognizing
        case failed
    }

    var onCancel: (() -> Void)?
    var onStop: (() -> Void)?
    var onRetry: (() -> Void)?

    private let cancelButton = UIButton(type: .system)
    private let actionButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let elapsedLabel = UILabel()
    private let waveformView = DictationWaveformView()
    private let centerStack = UIStackView()
    private let contentStack = UIStackView()
    private var currentMode: Mode = .recording

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: max(52, UIFont.preferredFont(forTextStyle: .subheadline).lineHeight + 12))
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
        configure(mode: .recording)
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        invalidateIntrinsicContentSize()
        guard previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle else { return }
        layer.borderColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.28, green: 0.29, blue: 0.31, alpha: 1)
                : UIColor(red: 0.88, green: 0.89, blue: 0.87, alpha: 1)
        }.resolvedColor(with: traitCollection).cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        build()
        configure(mode: .recording)
    }

    func configure(mode: Mode, elapsed: TimeInterval = 0) {
        currentMode = mode
        let cancelTitle = NSLocalizedString("chat.dictation.cancel", comment: "")
        cancelButton.accessibilityLabel = cancelTitle
        cancelButton.accessibilityHint = cancelTitle

        switch mode {
        case .recording:
            statusLabel.text = NSLocalizedString("chat.dictation.recording", comment: "")
            elapsedLabel.text = Self.elapsedString(elapsed)
            elapsedLabel.isHidden = false
            waveformView.isHidden = false
            actionButton.isHidden = false
            actionButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
            actionButton.accessibilityLabel = NSLocalizedString("chat.dictation.stop", comment: "")
            actionButton.accessibilityHint = actionButton.accessibilityLabel
            actionButton.isEnabled = true
            centerStack.isHidden = false
        case .permission, .recognizing:
            statusLabel.text = NSLocalizedString(mode == .permission ? "chat.voice.permission" : "chat.dictation.recognizing", comment: "")
            elapsedLabel.isHidden = true
            waveformView.isHidden = true
            actionButton.isHidden = true
            centerStack.isHidden = false
        case .failed:
            statusLabel.text = NSLocalizedString("chat.dictation.retry", comment: "")
            elapsedLabel.isHidden = true
            waveformView.isHidden = true
            actionButton.isHidden = false
            actionButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
            actionButton.accessibilityLabel = NSLocalizedString("chat.dictation.retry", comment: "")
            actionButton.accessibilityHint = actionButton.accessibilityLabel
            actionButton.isEnabled = true
            centerStack.isHidden = false
        }

        accessibilityValue = statusLabel.text
    }

    /// Feed the current recorder metering value (0...1); this view never samples audio.
    func update(level: Float) {
        waveformView.update(level: level)
    }

    private func build() {
        isAccessibilityElement = false
        backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.145, green: 0.15, blue: 0.17, alpha: 1)
                : UIColor(red: 0.99, green: 0.99, blue: 0.985, alpha: 1)
        }
        layer.cornerRadius = 26
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.borderColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.28, green: 0.29, blue: 0.31, alpha: 1)
                : UIColor(red: 0.88, green: 0.89, blue: 0.87, alpha: 1)
        }.resolvedColor(with: traitCollection).cgColor
        layer.masksToBounds = true

        cancelButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        cancelButton.tintColor = .secondaryLabel
        cancelButton.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.22, green: 0.23, blue: 0.25, alpha: 1)
                : UIColor(red: 0.95, green: 0.955, blue: 0.945, alpha: 1)
        }
        cancelButton.layer.cornerRadius = 22
        cancelButton.layer.cornerCurve = .continuous
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            cancelButton.widthAnchor.constraint(equalToConstant: 44),
            cancelButton.heightAnchor.constraint(equalToConstant: 44)
        ])

        actionButton.tintColor = .white
        actionButton.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.34, green: 0.66, blue: 0.48, alpha: 1)
                : UIColor(red: 0.16, green: 0.57, blue: 0.34, alpha: 1)
        }
        actionButton.layer.cornerRadius = 22
        actionButton.layer.cornerCurve = .continuous
        actionButton.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)
        actionButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            actionButton.widthAnchor.constraint(equalToConstant: 44),
            actionButton.heightAnchor.constraint(equalToConstant: 44)
        ])

        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = .label
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        statusLabel.numberOfLines = 1
        statusLabel.lineBreakMode = .byTruncatingTail

        elapsedLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        elapsedLabel.adjustsFontForContentSizeCategory = true
        elapsedLabel.textColor = .secondaryLabel
        elapsedLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        waveformView.translatesAutoresizingMaskIntoConstraints = false
        waveformView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        waveformView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        waveformView.accessibilityElementsHidden = true

        centerStack.axis = .horizontal
        centerStack.alignment = .center
        centerStack.spacing = 8
        centerStack.addArrangedSubview(statusLabel)
        centerStack.addArrangedSubview(waveformView)
        centerStack.addArrangedSubview(elapsedLabel)
        centerStack.translatesAutoresizingMaskIntoConstraints = false

        contentStack.axis = .horizontal
        contentStack.alignment = .center
        contentStack.spacing = 8
        contentStack.addArrangedSubview(cancelButton)
        contentStack.addArrangedSubview(centerStack)
        contentStack.addArrangedSubview(actionButton)
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(contentStack)

        NSLayoutConstraint.activate([
            contentStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
            contentStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
            contentStack.centerYAnchor.constraint(equalTo: centerYAnchor),
            centerStack.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            waveformView.widthAnchor.constraint(greaterThanOrEqualToConstant: 42),
            waveformView.heightAnchor.constraint(equalToConstant: 32)
        ])
    }

    private static func elapsedString(_ elapsed: TimeInterval) -> String {
        let wholeSeconds = max(0, Int(elapsed.rounded(.down)))
        return String(format: "%d:%02d", wholeSeconds / 60, wholeSeconds % 60)
    }

    @objc private func cancelTapped() {
        onCancel?()
    }

    @objc private func actionTapped() {
        switch currentMode {
        case .recording:
            onStop?()
        case .permission, .recognizing:
            break
        case .failed:
            onRetry?()
        }
    }
}

@MainActor
private final class DictationWaveformView: UIView {
    private let barCount = 19
    private var level: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        contentMode = .redraw
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isOpaque = false
        contentMode = .redraw
    }

    func update(level newLevel: Float) {
        let clamped = CGFloat(newLevel.isFinite ? min(1, max(0, newLevel)) : 0)
        guard abs(clamped - level) > 0.005 else { return }
        level = clamped
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let barWidth: CGFloat = 2.5
        let gap: CGFloat = 3
        let totalWidth = CGFloat(barCount) * barWidth + CGFloat(barCount - 1) * gap
        let startX = max(0, (bounds.width - totalWidth) / 2)
        let midY = bounds.midY
        let availableHeight = max(6, bounds.height - 4)
        let green = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.48, green: 0.78, blue: 0.59, alpha: 1)
                : UIColor(red: 0.18, green: 0.57, blue: 0.37, alpha: 1)
        }
        let purple = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.73, green: 0.64, blue: 0.88, alpha: 1)
                : UIColor(red: 0.48, green: 0.36, blue: 0.68, alpha: 1)
        }
        let resolvedGreen = green.resolvedColor(with: traitCollection)
        let resolvedPurple = purple.resolvedColor(with: traitCollection)

        for index in 0..<barCount {
            let distance = abs(CGFloat(index) - CGFloat(barCount - 1) / 2) / (CGFloat(barCount) / 2)
            let envelope = 0.24 + (1 - distance) * 0.58
            let resting = 0.08 + envelope * 0.18
            let amplitude = min(1, resting + level * envelope * 0.78)
            let height = max(3, availableHeight * amplitude)
            let x = startX + CGFloat(index) * (barWidth + gap)
            let bar = UIBezierPath(roundedRect: CGRect(
                x: x,
                y: midY - height / 2,
                width: barWidth,
                height: height
            ), cornerRadius: barWidth / 2)
            context.setFillColor((index % 6 == 0 ? resolvedPurple : resolvedGreen).cgColor)
            bar.fill()
        }
    }
}
