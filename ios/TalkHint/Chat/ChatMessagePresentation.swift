import UIKit

struct ChatMessagePresentation: Codable, Equatable {
    struct Item: Codable, Equatable {
        let kind: String
        let value: String
        var supported: Bool { ["address", "phone", "email", "reference", "code"].contains(kind) }
    }
    let revision: Int
    let format: String
    var copyItems: [Item]
    let documentIds: [String]
    private enum CodingKeys: CodingKey { case revision, format, copyItems, documentIds }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = try c.decode(Int.self, forKey: .revision)
        format = try c.decode(String.self, forKey: .format)
        copyItems = try c.decodeIfPresent([Item].self, forKey: .copyItems)?.filter(\.supported) ?? []
        documentIds = try c.decodeIfPresent([String].self, forKey: .documentIds) ?? []
    }
}

enum ChatCopyItemLabel {
    static func text(_ item: ChatMessagePresentation.Item) -> String {
        if item.kind == "code" { return NSLocalizedString("chat.copy.code", comment: "") }
        let line = item.value.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        return line.count > 52 ? String(line.prefix(49)) + "…" : line
    }
}

enum ChatMarkdown {
    static func render(_ text: String, font: UIFont) -> NSAttributedString {
        // Parse prose one physical line at a time. Foundation's inline Markdown
        // parser normalizes code/newline whitespace; fenced code must bypass it.
        let result = NSMutableAttributedString(string: "")
        let lines = text.components(separatedBy: "\n")
        var fence: (character: Character, length: Int)?
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            let marker = trimmed.first
            let count = marker.map { c in trimmed.prefix(while: { $0 == c }).count } ?? 0
            let indentation = line.prefix(while: { $0 == " " }).count
            if indentation <= 3, let marker, (marker == "`" || marker == "~"), count >= 3 {
                if let active = fence {
                    if marker == active.character, count >= active.length,
                       trimmed.dropFirst(count).trimmingCharacters(in: .whitespaces).isEmpty {
                        fence = nil; continue
                    }
                } else {
                    fence = (marker, count); continue
                }
            }
            if fence != nil {
                result.append(NSAttributedString(string: line, attributes: [
                    .font: UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular),
                    .foregroundColor: UIColor.label]))
            } else { result.append(renderInline(line, font: font)) }
            if index < lines.count - 1 {
                result.append(NSAttributedString(string: "\n", attributes: [.font: font]))
            }
        }
        return result
    }
    private static func renderInline(_ text: String, font: UIFont) -> NSAttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let markdown = try? AttributedString(markdown: text, options: options) else {
            return NSAttributedString(string: text, attributes: [.font: font])
        }
        let result = NSMutableAttributedString(attributedString: NSAttributedString(markdown))
        let entire = NSRange(location: 0, length: result.length)
        result.addAttribute(.font, value: font, range: entire)
        for run in markdown.runs {
            let start = String(markdown.characters[..<run.range.lowerBound]).utf16.count
            let count = String(markdown.characters[run.range]).utf16.count
            let range = NSRange(location: start, length: count)
            var traits: UIFontDescriptor.SymbolicTraits = []
            if run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true { traits.insert(.traitBold) }
            if run.inlinePresentationIntent?.contains(.emphasized) == true { traits.insert(.traitItalic) }
            let descriptor = font.fontDescriptor.withSymbolicTraits(traits) ?? font.fontDescriptor
            let styled = run.inlinePresentationIntent?.contains(.code) == true
                ? UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular)
                : UIFont(descriptor: descriptor, size: font.pointSize)
            result.addAttribute(.font, value: styled, range: range)
        }
        result.addAttribute(.foregroundColor, value: UIColor.label, range: entire)
        // Links in model text are data, never automatic navigation.
        result.removeAttribute(.link, range: entire)
        return result
    }
    static func plain(_ text: String) -> String {
        render(text, font: .preferredFont(forTextStyle: .body)).string
    }
}

/// Selectable on iOS 15; data detectors only provide tappable ranges, delegate
/// copies verbatim and returns false (no dial, mail composer or Maps).
final class ChatMessageTextView: UITextView, UITextViewDelegate {
    private var measuredWidth: CGFloat = -1
    private let copyText: (String) -> Void
    init(text: String, font: UIFont, markdown: Bool = true,
         copyText: @escaping (String) -> Void = { UIPasteboard.general.string = $0 }) {
        self.copyText = copyText
        super.init(frame: .zero, textContainer: nil)
        isEditable = false; isSelectable = true; isScrollEnabled = false
        backgroundColor = .clear; textContainerInset = .zero
        textContainer.lineFragmentPadding = 0
        adjustsFontForContentSizeCategory = true
        attributedText = markdown ? ChatMarkdown.render(text, font: font)
            : NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: UIColor.label])
        dataDetectorTypes = [.address, .phoneNumber, .link]
        delegate = self
        accessibilityIdentifier = "chat-message-text"
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var intrinsicContentSize: CGSize {
        let natural = attributedText?.size() ?? .zero
        let width = bounds.width > 0 ? bounds.width : max(1, natural.width)
        let fitted = sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: ceil(natural.width), height: ceil(fitted.height))
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if measuredWidth != bounds.width {
            measuredWidth = bounds.width
            invalidateIntrinsicContentSize()
        }
    }
    func textView(_ textView: UITextView, shouldInteractWith URL: URL,
                  in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        let value = (textView.text as NSString).substring(with: characterRange)
        copyText(value)
        UIAccessibility.post(notification: .announcement, argument: NSLocalizedString("chat.copy.done", comment: ""))
        return false
    }
}
