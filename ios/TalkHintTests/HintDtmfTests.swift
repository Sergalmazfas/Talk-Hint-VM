import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class HintDtmfTests: XCTestCase {
    func testAllTwelveKeysDispatchExactlyOnce() {
        var sent: [String] = []
        for digit in "123456789*0#" {
            XCTAssertTrue(HintDtmf.send(String(digit), connected: true) { sent.append($0) })
        }
        XCTAssertEqual(sent, "123456789*0#".map(String.init))
    }

    func testInvalidAndDisconnectedDigitsNeverDispatch() {
        var sent: [String] = []
        for invalid in ["", "w", "p", "A", "١", "1 2", "1\n", String(repeating: "0", count: 33)] {
            XCTAssertFalse(HintDtmf.send(invalid, connected: true) { sent.append($0) })
        }
        XCTAssertFalse(HintDtmf.send("0", connected: false) { sent.append($0) })
        XCTAssertTrue(sent.isEmpty)
    }

    func testReconnectDoesNotReplayEarlierKeyPresses() {
        var sent: [String] = []
        XCTAssertFalse(HintDtmf.send("1", connected: false) { sent.append($0) })
        XCTAssertTrue(HintDtmf.send("2", connected: true) { sent.append($0) })
        XCTAssertEqual(sent, ["2"])
    }

    func testKeypadButtonsDispatchAndCompactScreenCanScroll() {
        var sent: [String] = []
        let vc = InCallKeypadViewController { sent.append($0); return true }
        vc.loadViewIfNeeded()
        vc.view.frame = CGRect(x: 0, y: 0, width: 375, height: 380)
        vc.view.layoutIfNeeded()
        let descendants = views(vc.view)
        let buttons = descendants.compactMap { $0 as? UIButton }
        for digit in "123456789*0#" {
            let button = buttons.first { $0.accessibilityIdentifier == "incall-dtmf-\(digit)" }
            XCTAssertNotNil(button)
            button?.sendActions(for: .touchUpInside)
        }
        XCTAssertEqual(sent, "123456789*0#".map(String.init))
        let scroll = descendants.compactMap { $0 as? UIScrollView }.first!
        XCTAssertGreaterThan(scroll.contentSize.height, scroll.bounds.height)
        let close = buttons.first { $0.accessibilityIdentifier == "incall-keypad-close" }!
        XCTAssertGreaterThanOrEqual(close.frame.height, 44)
        XCTAssertLessThanOrEqual(close.frame.maxY, vc.view.bounds.height)
    }

    func testFailedDispatchShowsErrorWithoutDisplayingUnsentDigits() {
        let vc = InCallKeypadViewController { _ in false }
        vc.loadViewIfNeeded()
        let descendants = views(vc.view)
        let button = descendants.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "incall-dtmf-0" }!
        button.sendActions(for: .touchUpInside)
        let digits = descendants.first { $0.accessibilityIdentifier == "incall-keypad-digits" } as! UILabel
        let error = descendants.first { $0.accessibilityIdentifier == "incall-keypad-error" } as! UILabel
        XCTAssertNil(digits.text)
        XCTAssertFalse(error.isHidden)
    }

    private func views(_ root: UIView) -> [UIView] {
        [root] + root.subviews.flatMap { views($0) }
    }
}
