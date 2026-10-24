import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class PrepareGoalProposalAppearanceTests: XCTestCase {
    private func luminance(_ color: UIColor, traits: UITraitCollection) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        XCTAssertTrue(color.resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a))
        XCTAssertEqual(a, 1, accuracy: 0.001)
        func linear(_ value: CGFloat) -> Double {
            let c = Double(value)
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    private func assertContrast(_ foreground: UIColor?, _ background: UIColor?,
                                traits: UITraitCollection, file: StaticString = #filePath, line: UInt = #line) {
        guard let foreground, let background else {
            return XCTFail("Explicit paired colors are required", file: file, line: line)
        }
        let a = luminance(foreground, traits: traits), b = luminance(background, traits: traits)
        XCTAssertGreaterThanOrEqual((max(a, b) + 0.05) / (min(a, b) + 0.05), 4.5, file: file, line: line)
    }

    func testSecretaryTaskAndActionsStayReadableInBothAppearances() {
        for style in [UIUserInterfaceStyle.light, .dark] {
            let card = PrepareGoalProposalView(goal: "Уточнить время и место встречи", secretary: true)
            card.overrideUserInterfaceStyle = style
            let traits = UITraitCollection(userInterfaceStyle: style)
            XCTAssertEqual(card.goalLabel.text, "Уточнить время и место встречи")
            XCTAssertNotNil(card.confirmationQuestion.superview)
            assertContrast(card.goalLabel.textColor, card.backgroundColor, traits: traits)
            assertContrast(card.confirmationQuestion.textColor, card.backgroundColor, traits: traits)
            assertContrast(card.editButton.titleColor(for: .normal), card.editButton.backgroundColor, traits: traits)
            XCTAssertEqual(card.buttons.arrangedSubviews.count, 2)
        }
    }

    func testHintUsesTheSameReadableGoalWithoutSecretaryQuestion() {
        let card = PrepareGoalProposalView(goal: "Confirm the appointment", secretary: false)
        XCTAssertNil(card.confirmationQuestion.superview)
        assertContrast(card.goalLabel.textColor, card.backgroundColor,
                       traits: UITraitCollection(userInterfaceStyle: .dark))
        XCTAssertEqual(card.confirmButton.accessibilityIdentifier, "button-goal-confirm")
        XCTAssertEqual(card.editButton.accessibilityIdentifier, "button-goal-edit")
    }
}
