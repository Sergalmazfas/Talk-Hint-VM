import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class PreparedHintPlansTests: XCTestCase {
    private func response(executor: String = "hint", expires: String = "2036-11-03T00:00:00.000Z") throws -> PreparedHintPlansResponse {
        let object: [String: Any] = [
            "serverTime": "2026-11-02T00:00:00.000Z",
            "plans": [[
                "id": "fixture", "planHash": "hash", "createdAt": "2026-11-02T00:00:00.000Z", "expiresAt": expires,
                "plan": ["goal": "Ask about tires", "ownerFacts": ["295/75 R22.5"], "sayAsk": ["Total price?"],
                         "expectedQuestions": [["q": "Size?", "answer": "295/75 R22.5"], ["q": "Arrival?", "answer": NSNull()]],
                         "unknowns": ["Arrival"], "disclosurePolicy": ["allowed": ["Size"], "forbidden": ["Payment"]],
                         "language": "en", "executor": executor, "targetPhone": "+12025550123"]
            ]]
        ]
        return try JSONDecoder().decode(PreparedHintPlansResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }
    private func labels(_ root: UIView) -> [UILabel] {
        (root as? UILabel).map { [$0] } ?? root.subviews.flatMap { labels($0) }
    }
    private func identifiers(_ root: UIView) -> [String] {
        [root.accessibilityIdentifier].compactMap { $0 } + root.subviews.flatMap { identifiers($0) }
    }

    func testDecodesCommonPlanAndUnknownAnswers() throws {
        let saved = try response().plans[0]
        XCTAssertNil(saved.plan.expectedQuestions[1].answer)
        XCTAssertEqual(saved.plan.disclosurePolicy.forbidden, ["Payment"])
        XCTAssertNotNil(saved.expiration)
    }
    func testAuthenticatedPreviewUsesGETAndNoBody() async throws {
        // Use the exact server envelope, not a synthesized model constructor.
        let body = Data("{\"plans\":[],\"serverTime\":\"2026-11-02T00:00:00.000Z\"}".utf8)
        var requests = 0
        let client = APIClient(transport: { req in
            requests += 1
            XCTAssertEqual(req.url?.path, "/api/prepare/hint-plans")
            XCTAssertEqual(req.httpMethod, "GET")
            XCTAssertNil(req.httpBody)
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-session")
            return (body, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "fixture-session" })
        let saved = try await client.preparedHintPlans()
        XCTAssertTrue(saved.plans.isEmpty)
        XCTAssertEqual(requests, 1)
    }
    func testMissingLoginDoesNotReadPlans() async {
        let client = APIClient(transport: { _ in
            XCTFail("Unauthenticated transport must never run")
            throw APIError.notAuthenticated
        }, tokenProvider: { nil })
        do { _ = try await client.preparedHintPlans(); XCTFail("Expected auth error") }
        catch APIError.notAuthenticated {} catch { XCTFail("Unexpected error") }
    }
    func testPreviewServiceFailureIsNotEmpty() async {
        let client = APIClient(transport: { req in
            (Data("{\"error\":\"Unavailable\"}".utf8),
             HTTPURLResponse(url: req.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "fixture-session" })
        do { _ = try await client.preparedHintPlans(); XCTFail("503 must not become an empty plan list") }
        catch APIError.http(let status, _) { XCTAssertEqual(status, 503) }
        catch { XCTFail("Unexpected error") }
    }
    func testPreviewDisplaysGoalNumberAnswersAndExpiry() throws {
        let view = PreparedHintPlansView()
        view.render(try response(), at: Date(timeIntervalSince1970: 1_790_000_000))
        let text = labels(view).compactMap(\.text).joined(separator: "\n")
        for value in ["Ask about tires", "+12025550123", "295/75 R22.5", "Total price?", "Arrival?"] {
            XCTAssertTrue(text.contains(value))
        }
        XCTAssertTrue(text.contains(NSLocalizedString("prepare.saved.unknown_answer", comment: "")))
        XCTAssertTrue(text.contains(NSLocalizedString("prepare.saved.expires", comment: "")))
    }
    func testExpiredAndNonHintPlansAreHidden() throws {
        let view = PreparedHintPlansView()
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        for saved in [try response(expires: "2020-01-01T00:00:00Z"),
                      try response(expires: "invalid"), try response(executor: "secretary")] {
            view.render(saved, at: now)
            XCTAssertFalse(identifiers(view).contains("prepare-saved-plan-fixture"))
            XCTAssertTrue(labels(view).contains { $0.text == NSLocalizedString("prepare.saved.empty", comment: "") })
        }
    }
    func testReadOnlyViewHasNoCallControls() throws {
        let view = PreparedHintPlansView()
        view.render(try response(), at: Date(timeIntervalSince1970: 1_790_000_000))
        let ids = identifiers(view)
        XCTAssertTrue(ids.contains("button-prepare-saved-refresh"))
        XCTAssertFalse(ids.contains { $0.contains("confirm") || $0.contains("dial") || $0.contains("start-call") })
    }
    func testRefreshFailureShowsErrorNotEmpty() async {
        let view = PreparedHintPlansView()
        view.loadPlans = { throw APIError.http(503, "Unavailable") }
        view.refresh()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(labels(view).contains { $0.text == NSLocalizedString("prepare.saved.error", comment: "") })
        view.stopLoading()
    }
    func testCancelledRefreshCannotRepopulatePlan() async throws {
        let view = PreparedHintPlansView()
        var continuation: CheckedContinuation<PreparedHintPlansResponse, Error>?
        view.loadPlans = { try await withCheckedThrowingContinuation { continuation = $0 } }
        view.refresh()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertNotNil(continuation)
        view.stopLoading()
        continuation?.resume(returning: try response())
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(identifiers(view).contains("prepare-saved-plan-fixture"))
    }
}
