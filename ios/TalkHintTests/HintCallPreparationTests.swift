import XCTest
@testable import TalkHint

final class HintCallPreparationTests: XCTestCase {
    private func response(target: String? = "+12025550123", expires: String = "2036-11-03T00:00:00.000Z") throws -> PreparedHintPlansResponse {
        let object: [String: Any] = [
            "serverTime": "2026-11-02T00:00:00.000Z",
            "plans": [[
                "id": "approved-plan", "planHash": "approved-hash", "createdAt": "2026-11-02T00:00:00.000Z",
                "expiresAt": expires,
                "opening": ["phraseEn": "Has anyone found my case?", "translation": ""],
                "plan": ["goal": "Find my case", "executor": "hint", "language": "en",
                         "targetPhone": target as Any? ?? NSNull(),
                         "sayAsk": ["Has anyone found my case?"], "ownerFacts": [],
                         "expectedQuestions": [], "unknowns": [], "disclosurePolicy": ["allowed": [], "forbidden": []]]
            ]]
        ]
        return try JSONDecoder().decode(PreparedHintPlansResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testBindsExactRecipientAndStagesOpeningBeforeCall() throws {
        let ready = HintCallPreparation(number: "+12025550123", goal: "", response: try response())
        XCTAssertEqual(ready.goal, "Find my case")
        XCTAssertEqual(ready.opening.phraseEn, "Has anyone found my case?")
        XCTAssertEqual(ready.parameters["HintPlanId"], "approved-plan")
        XCTAssertEqual(ready.parameters["HintPlanHash"], "approved-hash")
        XCTAssertNil(ready.parameters["HintGoal"])
    }

    func testDifferentNumberDoesNotStealPendingPlan() throws {
        let ready = HintCallPreparation(number: "+12025550124", goal: "", response: try response())
        XCTAssertEqual(ready.goal, "")
        XCTAssertEqual(ready.parameters, ["HintPrepared": "1"])
        XCTAssertEqual(ready.opening.phraseEn, "Hi, may I ask you a quick question?")
    }

    func testPREPIntentAndOpeningTakePrecedenceOverUnrelatedChatPlan() throws {
        let ready = HintCallPreparation(number: "+12025550123", goal: "Ask about tires", response: try response(),
            localOpening: .init(phraseEn: "Do you have these tires?", translation: "У вас есть эти шины?"))
        XCTAssertEqual(ready.goal, "Ask about tires")
        XCTAssertNil(ready.parameters["HintPlanId"])
        XCTAssertEqual(ready.parameters["HintOpening"], "Do you have these tires?")
    }

    func testExpiredAndUntargetedPlansNeverActivateOnPlainDial() throws {
        for saved in [try response(expires: "2020-01-01T00:00:00Z"), try response(target: nil)] {
            let ready = HintCallPreparation(number: "+12025550123", goal: "", response: saved)
            XCTAssertEqual(ready.goal, "")
            XCTAssertNil(ready.parameters["HintPlanId"])
        }
    }
}
