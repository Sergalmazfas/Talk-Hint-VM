import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class DialerLayoutTests: XCTestCase {
    private func descendants(_ view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { descendants($0) }
    }

    func testBothDialersHaveNoKeyboardInputAndKeepCallOutsideScroll() {
        for mode in [CallManager.CallMode.hint, .translator] {
            let controller = HomeViewController(mode: mode)
            controller.loadViewIfNeeded()
            controller.view.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
            controller.view.layoutIfNeeded()
            let views = descendants(controller.view)
            XCTAssertFalse(views.contains { $0 is UITextField || $0 is UITextView })
            let number = views.first { $0.accessibilityIdentifier == "input-dial-number" }
            XCTAssertTrue(number is UILabel)
            XCTAssertFalse(number?.canBecomeFirstResponder ?? true)
            XCTAssertNotNil(views.first { $0.accessibilityIdentifier == "button-paste-number" })
            let call = views.first { $0.accessibilityIdentifier == "button-start-call" }
            XCTAssertNotNil(call)
            var ancestor = call?.superview
            while let current = ancestor {
                XCTAssertFalse(current is UIScrollView)
                ancestor = current.superview
            }
            if let call {
                let frame = call.convert(call.bounds, to: controller.view)
                XCTAssertGreaterThanOrEqual(frame.minY, 0)
                XCTAssertLessThanOrEqual(frame.maxY, controller.view.bounds.maxY)
            }
        }
    }
}