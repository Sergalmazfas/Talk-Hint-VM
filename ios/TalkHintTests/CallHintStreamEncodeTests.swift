import XCTest
@testable import TalkHint

/// Unit tests for the pure outgoing-payload builders on `CallHintStream`
/// (`askAIPayload`, `setGoalPayload`, `setLanguagePayload`, `setModePayload`).
/// These are the control messages the app *sends* to the backend over the `/ui`
/// WebSocket. They are the mirror image of `CallHintStreamDecodeTests`: a
/// renamed key or dropped field (`type`, `question`, `goal`, `language`, `mode`)
/// would silently break live-call control with no test catching it, so these
/// tests pin the exact JSON contract.
///
/// The builders are side-effect free (no networking, no main-thread dispatch),
/// so the tests run without a live socket. Each payload is round-tripped through
/// `JSONSerialization` to prove it serializes to the exact wire shape the server
/// expects, not just an in-memory dictionary.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamEncodeTests: XCTestCase {

    /// Serializes a builder payload and parses it back, exactly as `send(_:)`
    /// puts it on the wire. Fails the test if serialization is not possible.
    private func roundTrip(_ payload: [String: Any],
                           file: StaticString = #filePath,
                           line: UInt = #line) -> [String: Any] {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("payload is not JSON-serializable: \(payload)", file: file, line: line)
            return [:]
        }
        return obj
    }

    // MARK: ask_ai

    func testAskAIWithGoalIncludesGoal() {
        let obj = roundTrip(CallHintStream.askAIPayload(question: "What is the price?", goal: "Book a slot"))
        XCTAssertEqual(obj["type"] as? String, "ask_ai")
        XCTAssertEqual(obj["question"] as? String, "What is the price?")
        XCTAssertEqual(obj["goal"] as? String, "Book a slot")
        XCTAssertEqual(obj.count, 3)
    }

    func testAskAIOmitsGoalWhenNil() {
        let obj = roundTrip(CallHintStream.askAIPayload(question: "What is the price?", goal: nil))
        XCTAssertEqual(obj["type"] as? String, "ask_ai")
        XCTAssertEqual(obj["question"] as? String, "What is the price?")
        XCTAssertNil(obj["goal"])
        XCTAssertEqual(obj.count, 2)
    }

    func testAskAIOmitsGoalWhenEmpty() {
        let obj = roundTrip(CallHintStream.askAIPayload(question: "Hello", goal: ""))
        XCTAssertEqual(obj["type"] as? String, "ask_ai")
        XCTAssertEqual(obj["question"] as? String, "Hello")
        XCTAssertNil(obj["goal"])
        XCTAssertEqual(obj.count, 2)
    }

    func testAskAIDefaultsGoalToNil() {
        // The `goal` parameter defaults to nil, so the common call site omits it.
        let obj = roundTrip(CallHintStream.askAIPayload(question: "Hi"))
        XCTAssertEqual(obj["type"] as? String, "ask_ai")
        XCTAssertEqual(obj["question"] as? String, "Hi")
        XCTAssertNil(obj["goal"])
        XCTAssertEqual(obj.count, 2)
    }

    func testAskAIPreservesEmptyQuestion() {
        // An empty question is still sent verbatim (no client-side dropping);
        // only `goal` is conditionally omitted.
        let obj = roundTrip(CallHintStream.askAIPayload(question: "", goal: nil))
        XCTAssertEqual(obj["type"] as? String, "ask_ai")
        XCTAssertEqual(obj["question"] as? String, "")
        XCTAssertEqual(obj.count, 2)
    }

    // MARK: set_goal

    func testSetGoalPayload() {
        let obj = roundTrip(CallHintStream.setGoalPayload(goal: "Reschedule the appointment"))
        XCTAssertEqual(obj["type"] as? String, "set_goal")
        XCTAssertEqual(obj["goal"] as? String, "Reschedule the appointment")
        XCTAssertEqual(obj.count, 2)
    }

    func testSetGoalPreservesEmptyGoal() {
        let obj = roundTrip(CallHintStream.setGoalPayload(goal: ""))
        XCTAssertEqual(obj["type"] as? String, "set_goal")
        XCTAssertEqual(obj["goal"] as? String, "")
        XCTAssertEqual(obj.count, 2)
    }

    // MARK: set_language

    func testSetLanguagePayload() {
        let obj = roundTrip(CallHintStream.setLanguagePayload(language: "ru"))
        XCTAssertEqual(obj["type"] as? String, "set_language")
        XCTAssertEqual(obj["language"] as? String, "ru")
        XCTAssertEqual(obj.count, 2)
    }

    // MARK: set_mode

    func testSetModePayload() {
        let obj = roundTrip(CallHintStream.setModePayload(mode: "massage"))
        XCTAssertEqual(obj["type"] as? String, "set_mode")
        XCTAssertEqual(obj["mode"] as? String, "massage")
        XCTAssertEqual(obj.count, 2)
    }

    // MARK: serialized wire shape

    func testAskAISerializesToValidJSONString() {
        // Proves the dictionary survives the exact `send(_:)` serialization path
        // (JSONSerialization -> UTF-8 string) the live socket uses.
        let payload = CallHintStream.askAIPayload(question: "Hi", goal: "Goal")
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            return XCTFail("ask_ai payload did not serialize to a UTF-8 JSON string")
        }
        XCTAssertTrue(text.contains("\"type\":\"ask_ai\""))
        XCTAssertTrue(text.contains("\"question\":\"Hi\""))
        XCTAssertTrue(text.contains("\"goal\":\"Goal\""))
    }
}
