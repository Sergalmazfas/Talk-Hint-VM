import XCTest
@testable import TalkHint

final class ChatPlanPresentationTests: XCTestCase {
    func testNoWarningsKeepsOldCardUnchanged() {
        XCTAssertNil(ChatPlanPresentation.missing(nil))
        XCTAssertNil(ChatPlanPresentation.missing([]))
    }
    func testWarningUsesAppLanguageNotCallLanguage() {
        let warnings = [ChatMessageAction.Warning(field: "leaseDuration",
            labels: ["ru": "Срок аренды", "en": "Lease duration", "es": "Duración del alquiler"],
            reason: "missing")]
        XCTAssertEqual(ChatPlanPresentation.missing(warnings, language: "ru-RU"), "Срок аренды")
        XCTAssertEqual(ChatPlanPresentation.missing(warnings, language: "es"), "Duración del alquiler")
        XCTAssertEqual(ChatPlanPresentation.missing(warnings, language: "fr"), "Lease duration")
    }
    func testUnstructuredInstructionIsNeverRewritten() {
        let original = "Ask for a studio. Do not pay."
        XCTAssertEqual(ChatPlanPresentation.instruction(original), original)
        XCTAssertEqual(ChatPlanPresentation.instruction("Owner-approved call plan.\nINVALID"), "Owner-approved call plan.\nINVALID")
    }
    func testStructuredInstructionUsesReadableLabelsWithoutChangingOriginal() {
        let original = """
        Owner-approved call plan. Unknown answers must be clarified, not invented.
        {"goal":"Узнать о студии","ownerFacts":[],"sayAsk":["Какой депозит?","Какие сборы?"],"expectedQuestions":[{"q":"Срок?","answer":null}],"unknowns":["Срок"],"disclosurePolicy":{"allowed":[],"forbidden":["Не платить"]},"language":"en","executor":"secretary","targetPhone":"+12025550123"}
        """
        let shown = ChatPlanPresentation.instruction(original)
        XCTAssertTrue(shown.contains("Какой депозит?"))
        XCTAssertTrue(shown.contains("Не платить"))
        XCTAssertFalse(shown.contains("Owner-approved call plan."))
        XCTAssertTrue(original.contains("\"language\":\"en\""))
        XCTAssertFalse(shown.contains("\"sayAsk\""))
    }
    func testWarningDecodesAsAdvisoryNotAnAuthorizationField() throws {
        let data = Data("""
        {"field":"leaseDuration","labels":{"ru":"Срок аренды"},"reason":"ambiguous"}
        """.utf8)
        let warning = try JSONDecoder().decode(ChatMessageAction.Warning.self, from: data)
        XCTAssertEqual(warning.reason, "ambiguous")
    }
}
