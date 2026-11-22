import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class ChatMessagePresentationTests: XCTestCase {
    func testUnknownKindIsSkippedNotWholeMessage() throws {
        let data = Data(#"{"revision":1,"format":"markdown","copyItems":[{"kind":"future","value":"ignore"},{"kind":"address","value":"901 Givens Rd"},{"kind":"reference","value":"00017"}],"documentIds":[]}"#.utf8)
        let p = try JSONDecoder().decode(ChatMessagePresentation.self, from: data)
        XCTAssertEqual(p.copyItems.map(\.kind), ["address", "reference"])
        XCTAssertEqual(p.copyItems.last?.value, "00017")
        var m = ChatMessage(id: "m", conversationId: "c", sequence: 1, role: "assistant",
                            text: "**Address**", status: "complete", clientRequestId: nil,
                            attachmentIds: [], createdAt: "", errorCode: nil)
        m.presentation = p
        XCTAssertEqual(try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(m)).presentation, p)
        m.presentation = nil
        XCTAssertNil(try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(m)).presentation)
    }
    func testMarkdownIsRenderedAndCopyPreservesNewlinesAndLeadingZero() {
        let raw = "**Address:** 901 Givens Rd\n`00017`"
        XCTAssertEqual(ChatMarkdown.plain(raw), "Address: 901 Givens Rd\n00017")
        let view = ChatMessageTextView(text: raw, font: .systemFont(ofSize: 17))
        XCTAssertTrue(view.isSelectable)
        XCTAssertFalse(view.isEditable)
        XCTAssertFalse(view.isScrollEnabled)
        XCTAssertFalse(view.text.contains("**"))
        view.bounds.size.width = 200
        view.layoutIfNeeded()
        XCTAssertGreaterThan(view.intrinsicContentSize.height, 0)
    }
    func testTapCopiesPhoneWithoutOpeningURL() {
        let view = ChatMessageTextView(text: "+1 202 555 0123", font: .systemFont(ofSize: 17))
        let before = UIPasteboard.general.string
        defer { UIPasteboard.general.string = before }
        XCTAssertFalse(view.textView(view, shouldInteractWith: URL(string: "tel:+12025550123")!,
            in: NSRange(location: 0, length: view.text.utf16.count), interaction: .invokeDefaultAction))
        XCTAssertEqual(UIPasteboard.general.string, "+1 202 555 0123")
    }
}
