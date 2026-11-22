import XCTest
@testable import TalkHint

final class HintCallPreparationTests: XCTestCase {
    func testBrokenPlanDoesNotDiscardOtherValidPlans() throws {
        let plan = try response()
        // Preserve the actual wire structure while prepending malformed entries.
        let json: [String: Any] = [
            "serverTime": plan.serverTime,
            "plans": [NSNull(), ["id": "broken"], [
                "id": "valid", "planHash": "hash", "createdAt": plan.serverTime,
                "expiresAt": "2036-11-03T00:00:00.000Z",
                "plan": ["goal": "Find case", "executor": "hint", "language": "en",
                         "targetPhone": "+12025550123", "ownerFacts": [], "sayAsk": [],
                         "expectedQuestions": [], "unknowns": [],
                         "disclosurePolicy": ["allowed": [], "forbidden": []]]
            ]]
        ]
        let decoded = try JSONDecoder().decode(PreparedHintPlansResponse.self,
                                               from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(decoded.plans.map(\.id), ["valid"])
    }

    func testNetworkOrEmptyPreflightStillReturnsNeutralPreparation() async throws {
        for body in [nil, Data(), Data(#"{"plans":[],"serverTime":""}"#.utf8)] as [Data?] {
            let api = APIClient(transport: { req in
                XCTAssertEqual(req.timeoutInterval, 1)
                guard let body else { throw URLError(.timedOut) }
                return (body, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "offline" })
            let ready = await api.prepareHintCall(number: "+12025550123", goal: "",
                localOpening: nil)
            XCTAssertEqual(ready.opening.phraseEn, "Hi, may I ask you a quick question?")
            XCTAssertEqual(ready.parameters, ["HintPrepared": "1"])
        }
    }
    func testGoalFilteredPREPOpeningSurvivesEmptyOrFailedPreflight() async throws {
        for body in [nil, Data(), Data(#"{"plans":[],"serverTime":""}"#.utf8)] as [Data?] {
            let api = APIClient(transport: { req in
                guard let body else { throw URLError(.notConnectedToInternet) }
                return (body, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "offline" })
            let ready = await api.prepareHintCall(number: "+12025550123", goal: "Find case",
                localOpening: .init(phraseEn: "Has anyone found my case?", translation: "Кейс не находили?"))
            XCTAssertEqual(ready.goal, "Find case")
            XCTAssertEqual(ready.opening.phraseEn, "Has anyone found my case?")
            XCTAssertEqual(ready.opening.translation, "Кейс не находили?")
            XCTAssertNil(ready.parameters["HintPlanId"])
        }
    }
    func testLongMultilingualGoalFitsConservativeTwilioWireLimit() {
        let ready = HintCallPreparation(number: "+12025550123", goal: String(repeating: "Шины🚛 ", count: 10_000),
            response: .init(plans: []),
            localOpening: .init(phraseEn: String(repeating: "Ask? ", count: 1000),
                                translation: String(repeating: "Вопрос? ", count: 1000)))
        XCTAssertLessThanOrEqual(HintCallPreparation.encodedSize(ready.parameters.merging(["To": "+12025550123"]) { _, n in n }), 800)
        XCTAssertLessThanOrEqual(ready.parameters["HintGoal"]?.utf8.count ?? 0, 160)
        XCTAssertFalse(ready.parameters.values.contains(where: { $0.contains("\u{FFFD}") }))
    }
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
