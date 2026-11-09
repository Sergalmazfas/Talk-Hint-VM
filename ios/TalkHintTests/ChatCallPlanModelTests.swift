import XCTest
import Foundation
@testable import TalkHint

final class ChatCallPlanModelTests: XCTestCase {
    func testOldMessageWithoutActionStillDecodes() throws {
        let fixture = """
        {"id":"old","conversationId":"conversation-2","sequence":1,"role":"user",
         "text":"Hello","status":"complete","clientRequestId":null,"attachmentIds":[],
         "createdAt":"2026-01-12T12:00:00.000Z","errorCode":null}
        """
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(fixture.utf8))
        XCTAssertNil(message.action)
        XCTAssertEqual(message.text, "Hello")
    }

    func testFetchedActionFixtureRoundTripsWithoutLosingPlan() throws {
        let fixture = """
        {
          "id":"assistant-7","conversationId":"conversation-2","sequence":7,"role":"assistant",
          "text":"I prepared a call plan.","status":"complete","clientRequestId":null,
          "attachmentIds":[],"createdAt":"2026-01-12T12:00:00.000Z","errorCode":null,
          "action":{
            "plan":{
              "goal":"Ask about the appointment","ownerFacts":["Available Tuesday"],
              "sayAsk":["Ask for the next opening"],"expectedQuestions":[{"q":"Which day?","answer":null}],
              "unknowns":["Price"],"disclosurePolicy":{"allowed":["Available Tuesday"],"forbidden":["Do not share my address"]},
              "language":"en","executor":"secretary","targetPhone":"+12025550123","voicemail":"skip"
            },
            "planHash":"fixture-hash","status":"proposed"
          }
        }
        """
        let decoder = JSONDecoder()
        let message = try decoder.decode(ChatMessage.self, from: Data(fixture.utf8))
        XCTAssertEqual(message.action?.plan.expectedQuestions.first?.answer, nil)
        XCTAssertEqual(message.action?.plan.disclosurePolicy.forbidden, ["Do not share my address"])
        XCTAssertEqual(message.action?.plan.targetPhone, "+12025550123")
        let encoded = try JSONEncoder().encode(message)
        let encodedObject = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let action = try XCTUnwrap(encodedObject["action"] as? [String: Any])
        let plan = try XCTUnwrap(action["plan"] as? [String: Any])
        let question = try XCTUnwrap((plan["expectedQuestions"] as? [[String: Any]])?.first)
        XCTAssertTrue(question["answer"] is NSNull, "Nullable answer must round-trip as explicit JSON null.")
        let restored = try decoder.decode(ChatMessage.self, from: encoded)
        XCTAssertEqual(restored, message)
    }

    func testConfirmationUsesExactMessageAndHashAndKeepsTokenOutOfMessageModel() async throws {
        let payload: [String: Any] = [
            "message": [
                "id": "assistant-7", "conversationId": "conversation-2", "sequence": 7,
                "role": "assistant", "text": "Plan ready", "status": "complete",
                "attachmentIds": [], "createdAt": "2026-01-12T12:00:00.000Z",
                "action": ["planHash": "fixture-hash", "status": "confirmed",
                           "plan": ["goal": "Ask", "ownerFacts": [], "sayAsk": [],
                                    "expectedQuestions": [], "unknowns": [],
                                    "disclosurePolicy": ["allowed": [], "forbidden": []],
                                    "language": "en", "executor": "secretary",
                                    "targetPhone": "+12025550123"]]
            ],
            "dialed": false,
            "review": ["phoneNumber": "+12025550123", "instruction": "Ask about the appointment",
                       "confirmationToken": "ephemeral-review-token"]
        ]
        var captured: URLRequest?
        let api = APIClient(transport: { request in
            captured = request
            let data = try JSONSerialization.data(withJSONObject: payload)
            let response = try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                                         httpVersion: nil, headerFields: nil))
            return (data, response)
        }, tokenProvider: { "fixture-auth" })

        let response = try await api.confirmChatPlan(conversationId: "conversation-2",
                                                      messageId: "assistant-7", planHash: "fixture-hash")
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path,
                       "/api/chat-v1/conversations/conversation-2/messages/assistant-7/confirm-plan")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-auth")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String])
        XCTAssertEqual(body, ["planHash": "fixture-hash"])
        XCTAssertFalse(response.dialed)
        XCTAssertEqual(response.review?.confirmationToken, "ephemeral-review-token")
        XCTAssertNil(response.message.action?.result?.id)
    }

    func testOnlyExactPlanStaleCodesAreReturnedForStaleClassification() async {
        let cases: [([String: String], String)] = [
            (["code": "PLAN_STALE", "error": "The prepared plan is no longer current."], "PLAN_STALE"),
            (["code": "PLAN_CHANGED", "error": "The prepared plan changed."], "PLAN_CHANGED"),
            (["code": "PLAN_UNAVAILABLE", "error": "The plan is unavailable."], "The plan is unavailable."),
        ]
        for (payload, expectedDetail) in cases {
            let api = APIClient(transport: { request in
                let data = try JSONSerialization.data(withJSONObject: payload)
                let response = try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(request.url),
                                                             statusCode: 409, httpVersion: nil, headerFields: nil))
                return (data, response)
            }, tokenProvider: { "fixture-auth" })
            do {
                _ = try await api.confirmChatPlan(conversationId: "conversation-2",
                                                  messageId: "assistant-7", planHash: "fixture-hash")
                XCTFail("Expected the offline fixture error.")
            } catch APIError.http(_, let detail) {
                XCTAssertEqual(detail, expectedDetail)
            } catch {
                XCTFail("Unexpected error type: \(error)")
            }
        }
    }
}
