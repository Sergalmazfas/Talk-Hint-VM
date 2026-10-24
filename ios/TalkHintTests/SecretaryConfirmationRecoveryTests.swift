import XCTest
@testable import TalkHint

final class SecretaryConfirmationRecoveryTests: XCTestCase {
    private func token(instruction: String = "Ask about opening hours", age: TimeInterval = 0) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: [
            "instruction": instruction,
            "issuedAt": (Date().timeIntervalSince1970 - age) * 1000,
        ])
        let payload = data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return "\(payload).fixture-signature"
    }

    private func draft(age: TimeInterval = 0, attempted: Bool = false) throws -> SessionStore.SecretaryCallDraft {
        SessionStore.SecretaryCallDraft(
            instruction: "Ask about opening hours", confirmationToken: try token(age: age),
            clientRequestId: UUID(), voiceProvider: .openai,
            phoneNumber: "+12025550123", requestAttempted: attempted)
    }

    func testFreshExpiredMalformedAndChangedInstruction() throws {
        XCTAssertFalse(try draft().needsPreparation)
        XCTAssertTrue(try draft(age: 901).needsPreparation)
        XCTAssertTrue(try draft(age: -60).needsPreparation)
        var wrong = try draft()
        wrong = SessionStore.SecretaryCallDraft(
            instruction: "Changed", confirmationToken: wrong.confirmationToken,
            clientRequestId: wrong.clientRequestId, voiceProvider: .openai,
            phoneNumber: wrong.phoneNumber, requestAttempted: false)
        XCTAssertTrue(wrong.needsPreparation)
    }

    func testAmbiguousAttemptMustRecoverSameIDDespiteExpiryAndRestart() throws {
        let pending = try draft(age: 901, attempted: true)
        let restored = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self,
                                                from: JSONEncoder().encode(pending))
        XCTAssertTrue(restored.requestAttempted)
        XCTAssertFalse(restored.needsPreparation)
        XCTAssertEqual(restored.clientRequestId, pending.clientRequestId)
    }

    func testExplicitRejectionSurvivesRestartAndAllowsPreparation() throws {
        var rejected = try draft(attempted: true)
        rejected.requestAttempted = false
        rejected.confirmationRejected = true
        let restored = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self,
                                                from: JSONEncoder().encode(rejected))
        XCTAssertTrue(restored.needsPreparation)
        XCTAssertFalse(restored.requestAttempted)
        XCTAssertEqual(restored.clientRequestId, rejected.clientRequestId)
        XCTAssertEqual(restored.phoneNumber, rejected.phoneNumber)
    }

    func testTimeoutIsNotTreatedAsAConfirmationRejection() async throws {
        let client = APIClient(transport: { _ in throw URLError(.timedOut) },
                               tokenProvider: { "fixture-session" })
        do {
            _ = try await client.createSecretaryTask(
                phoneNumber: "+12025550123", instruction: "Ask about opening hours",
                confirmationToken: "fixture", voiceProvider: .openai,
                live: true, clientRequestId: UUID())
            XCTFail("Timeout must not succeed")
        } catch APIError.secretaryConfirmationRequired {
            XCTFail("A timeout must keep the ambiguous-request lock")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        }
    }

    func testOnlyConfirmation403UnlocksPreparationIncludingExactLegacyResponse() async throws {
        for payload in [
            #"{"code":"SECRETARY_CONFIRMATION_REQUIRED","error":"Confirm again"}"#,
            #"{"error":"Confirm this Secretary assignment in Prepare before starting the call."}"#,
            #"{"error":"Another forbidden action"}"#,
        ] {
            let client = APIClient(transport: { request in
                (Data(payload.utf8), HTTPURLResponse(url: request.url!, statusCode: 403,
                                                    httpVersion: nil, headerFields: nil)!)
            }, tokenProvider: { "fixture-session" })
            do {
                _ = try await client.createSecretaryTask(
                    phoneNumber: "+12025550123", instruction: "Ask about opening hours",
                    confirmationToken: "fixture", voiceProvider: .openai,
                    live: true, clientRequestId: UUID())
                XCTFail("403 must not succeed")
            } catch APIError.secretaryConfirmationRequired {
                XCTAssertFalse(payload.contains("Another forbidden"))
            } catch APIError.http(let code, _) {
                XCTAssertEqual(code, 403)
                XCTAssertTrue(payload.contains("Another forbidden"))
            }
        }
    }
}
