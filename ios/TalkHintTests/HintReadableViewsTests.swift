import XCTest
@testable import TalkHint

@MainActor
final class HintReadableViewsTests: XCTestCase {
    func testEnglishFirstAndLongRepliesFitAtPhoneWidths() {
        for width: CGFloat in [288, 343, 398] {
            let button = HintChoiceButton(
                english: "I've completed the activation steps, but the mobile data still isn't working.",
                translation: "Я выполнил шаги активации, но мобильный интернет всё ещё не работает.",
                primary: true)
            button.frame.size.width = width
            button.layoutIfNeeded()
            button.frame.size.height = button.intrinsicContentSize.height
            button.layoutIfNeeded()
            XCTAssertGreaterThan(button.englishLabel.font.pointSize, button.translationLabel.font.pointSize)
            XCTAssertLessThan(button.englishLabel.frame.minY, button.translationLabel.frame.minY)
            XCTAssertLessThanOrEqual(button.translationLabel.frame.maxY + 20, button.bounds.height + 1)
            XCTAssertEqual(button.englishLabel.numberOfLines, 0)
            XCTAssertEqual(button.accessibilityValue, button.englishLabel.text)
        }
    }

    func testLongContentScrollsInsteadOfBeingDestroyed() {
        let scroll = HintBannerScrollView()
        scroll.contentSize = CGSize(width: 288, height: 800)
        XCTAssertEqual(scroll.intrinsicContentSize.height, 280)
        XCTAssertEqual(scroll.contentSize.height, 800)
        XCTAssertTrue(scroll.isScrollEnabled)
    }

    func testOpeningIsSingleUseAndGoalScoped() {
        let store = SessionStore.shared
        let oldGoal = store.callGoal
        defer { store.callGoal = oldGoal }
        store.callGoal = "fixture-goal"
        store.stageHintOpening(english: "Hello", translation: "Здравствуйте", goal: "fixture-goal")
        XCTAssertEqual(store.takeHintOpening()?.english, "Hello")
        XCTAssertNil(store.takeHintOpening())
        store.stageHintOpening(english: "Stale", translation: nil, goal: "fixture-goal")
        store.callGoal = "new-goal"
        XCTAssertNil(store.takeHintOpening())
    }
}
