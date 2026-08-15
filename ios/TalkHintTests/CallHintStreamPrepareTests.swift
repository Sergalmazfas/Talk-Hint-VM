import XCTest
@testable import TalkHint

/// Unit tests for the PREPARE-stage protocol pieces on `CallHintStream`:
/// - inbound decode of `prepare_reply` / `prepare_opening` / `prepare_error`
/// - outgoing payload builders for `prepare_message` / `prepare_confirm_goal` /
///   `prepare_reset`
///
/// These pin the exact JSON contract with the backend `/ui` WebSocket
/// (server/websocket.ts prepare_* handlers). A renamed key (`text`,
/// `proposedGoal`, `phraseEn`, `translation`, `goal`) would silently break the
/// pre-call preparation chat with no test catching it.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamPrepareTests: XCTestCase {

    // MARK: - Decode: prepare_reply

    func testDecodePrepareReplyWithProposedGoal() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_reply","text":"Вот цель:","proposedGoal":"Записаться на приём к врачу на этой неделе."}"#)
        XCTAssertEqual(event, .prepareReply(
            text: "Вот цель:",
            proposedGoal: "Записаться на приём к врачу на этой неделе."))
    }

    func testDecodePrepareReplyWithoutGoal() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_reply","text":"Уточните, пожалуйста, когда вам удобно?"}"#)
        XCTAssertEqual(event, .prepareReply(
            text: "Уточните, пожалуйста, когда вам удобно?", proposedGoal: nil))
    }

    func testDecodePrepareReplyNullGoalTreatedAsNil() {
        // The server sends proposedGoal: null when no goal is proposed yet.
        let event = CallHintStream.decode(
            #"{"type":"prepare_reply","text":"Понял.","proposedGoal":null}"#)
        XCTAssertEqual(event, .prepareReply(text: "Понял.", proposedGoal: nil))
    }

    func testDecodePrepareReplyEmptyGoalTreatedAsNil() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_reply","text":"Понял.","proposedGoal":""}"#)
        XCTAssertEqual(event, .prepareReply(text: "Понял.", proposedGoal: nil))
    }

    func testDecodePrepareReplyEmptyTextIsDropped() {
        XCTAssertNil(CallHintStream.decode(#"{"type":"prepare_reply","text":""}"#))
        XCTAssertNil(CallHintStream.decode(#"{"type":"prepare_reply"}"#))
    }

    // MARK: - Decode: prepare_opening

    func testDecodePrepareOpening() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_opening","phraseEn":"Hi, I'd like to book an appointment.","translation":"Здравствуйте, я хотел бы записаться на приём."}"#)
        XCTAssertEqual(event, .prepareOpening(
            phraseEn: "Hi, I'd like to book an appointment.",
            translation: "Здравствуйте, я хотел бы записаться на приём."))
    }

    func testDecodePrepareOpeningWithoutTranslation() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_opening","phraseEn":"Hello there.","translation":""}"#)
        XCTAssertEqual(event, .prepareOpening(phraseEn: "Hello there.", translation: nil))
    }

    func testDecodePrepareOpeningEmptyPhraseIsDropped() {
        XCTAssertNil(CallHintStream.decode(#"{"type":"prepare_opening","phraseEn":"","translation":"x"}"#))
        XCTAssertNil(CallHintStream.decode(#"{"type":"prepare_opening"}"#))
    }

    // MARK: - Decode: prepare_error

    func testDecodePrepareError() {
        let event = CallHintStream.decode(
            #"{"type":"prepare_error","text":"Модель подготовки (GPT-5.6 Sol) сейчас недоступна (HTTP 503). Никакая другая модель не подставляется — попробуйте позже."}"#)
        XCTAssertEqual(event, .prepareError(
            text: "Модель подготовки (GPT-5.6 Sol) сейчас недоступна (HTTP 503). Никакая другая модель не подставляется — попробуйте позже."))
    }

    func testDecodePrepareErrorEmptyTextIsDropped() {
        XCTAssertNil(CallHintStream.decode(#"{"type":"prepare_error","text":""}"#))
    }

    // MARK: - Encode: outgoing payload builders

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

    func testPrepareMessagePayload() {
        let obj = roundTrip(CallHintStream.prepareMessagePayload(text: "Мне нужно позвонить в клинику"))
        XCTAssertEqual(obj["type"] as? String, "prepare_message")
        XCTAssertEqual(obj["text"] as? String, "Мне нужно позвонить в клинику")
        XCTAssertEqual(obj.count, 2)
    }

    func testPrepareConfirmGoalPayload() {
        let obj = roundTrip(CallHintStream.prepareConfirmGoalPayload(goal: "Записаться на приём."))
        XCTAssertEqual(obj["type"] as? String, "prepare_confirm_goal")
        XCTAssertEqual(obj["goal"] as? String, "Записаться на приём.")
        XCTAssertEqual(obj.count, 2)
    }

    func testPrepareResetPayload() {
        let obj = roundTrip(CallHintStream.prepareResetPayload())
        XCTAssertEqual(obj["type"] as? String, "prepare_reset")
        XCTAssertEqual(obj.count, 1)
    }
}
