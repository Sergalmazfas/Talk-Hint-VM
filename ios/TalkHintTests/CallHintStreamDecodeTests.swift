import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.decode(_:)`, the pure parser that turns a raw
/// `/ui` WebSocket text frame into a `CallHintEvent`. This is the boundary
/// between the backend socket and the in-call UI: a malformed or renamed field
/// (`isFinal`, `en`, `translation`, ...) would silently drop captions or hints,
/// so these tests pin the exact JSON contract.
///
/// `decode` is side-effect free (no networking, no main-thread dispatch), so the
/// tests run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamDecodeTests: XCTestCase {

    // MARK: guest_transcript

    func testGuestTranscriptWithTranslationAndFinal() {
        let json = #"{"type":"guest_transcript","text":"Hello there","translation":"Privet","isFinal":true}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .guestTranscript(text: "Hello there", translation: "Privet", isFinal: true)
        )
    }

    func testGuestTranscriptDefaultsIsFinalFalseWhenMissing() {
        let json = #"{"type":"guest_transcript","text":"Hel"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .guestTranscript(text: "Hel", translation: nil, isFinal: false)
        )
    }

    func testGuestTranscriptEmptyTranslationBecomesNil() {
        let json = #"{"type":"guest_transcript","text":"Hi","translation":"","isFinal":false}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .guestTranscript(text: "Hi", translation: nil, isFinal: false)
        )
    }

    func testGuestTranscriptEmptyTextIsRejected() {
        let json = #"{"type":"guest_transcript","text":"","isFinal":true}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    func testGuestTranscriptMissingTextIsRejected() {
        let json = #"{"type":"guest_transcript","translation":"Privet"}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    // MARK: owner_transcript

    func testOwnerTranscriptWithConfidenceAndFinal() {
        let json = #"{"type":"owner_transcript","text":"I would like to book","confidence":0.92,"isFinal":true}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .ownerTranscript(text: "I would like to book", confidence: 0.92, isFinal: true)
        )
    }

    func testOwnerTranscriptDefaultsConfidenceNilAndIsFinalFalse() {
        let json = #"{"type":"owner_transcript","text":"so"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .ownerTranscript(text: "so", confidence: nil, isFinal: false)
        )
    }

    func testOwnerTranscriptIntegerConfidenceIsDecoded() {
        let json = #"{"type":"owner_transcript","text":"hello","confidence":1,"isFinal":true}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .ownerTranscript(text: "hello", confidence: 1.0, isFinal: true)
        )
    }

    func testOwnerTranscriptEmptyTextIsRejected() {
        let json = #"{"type":"owner_transcript","text":"","confidence":0.9}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    // MARK: suggestion

    func testSuggestionWithTranslation() {
        let json = #"{"type":"suggestion","en":"Offer the morning slot","translation":"Predlozhi utro"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .suggestion(en: "Offer the morning slot", translation: "Predlozhi utro")
        )
    }

    func testSuggestionWithoutTranslationIsNil() {
        let json = #"{"type":"suggestion","en":"Ask for their name"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .suggestion(en: "Ask for their name", translation: nil)
        )
    }

    func testSuggestionEmptyEnIsRejected() {
        let json = #"{"type":"suggestion","en":"","translation":"x"}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    func testSuggestionMissingEnIsRejected() {
        // A renamed field (e.g. server sends "text" instead of "en") must drop.
        let json = #"{"type":"suggestion","text":"Offer the slot"}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    // MARK: fast_phrase

    func testFastPhraseWithTranslation() {
        let json = #"{"type":"fast_phrase","text":"One moment","translation":"Minutku"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .fastPhrase(text: "One moment", translation: "Minutku")
        )
    }

    func testFastPhraseEmptyTextIsRejected() {
        let json = #"{"type":"fast_phrase","text":""}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    // MARK: ai_response

    func testAIResponseDefaultsErrorFalse() {
        let json = #"{"type":"ai_response","text":"Here is the price list"}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .aiResponse(text: "Here is the price list", isError: false)
        )
    }

    func testAIResponseWithErrorTrue() {
        let json = #"{"type":"ai_response","text":"Something went wrong","error":true}"#
        XCTAssertEqual(
            CallHintStream.decode(json),
            .aiResponse(text: "Something went wrong", isError: true)
        )
    }

    func testAIResponseEmptyTextIsRejected() {
        let json = #"{"type":"ai_response","text":"","error":true}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    // MARK: malformed / unknown payloads

    func testUnknownTypeIsRejected() {
        let json = #"{"type":"heartbeat","text":"ping"}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    func testMissingTypeIsRejected() {
        let json = #"{"text":"Hello there","isFinal":true}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    func testNonStringTypeIsRejected() {
        let json = #"{"type":123,"text":"Hello"}"#
        XCTAssertNil(CallHintStream.decode(json))
    }

    func testInvalidJSONIsRejected() {
        XCTAssertNil(CallHintStream.decode("not json at all"))
        XCTAssertNil(CallHintStream.decode("{ broken json"))
    }

    func testEmptyStringIsRejected() {
        XCTAssertNil(CallHintStream.decode(""))
    }

    func testJSONArrayIsRejected() {
        // Top-level must be an object, not an array.
        XCTAssertNil(CallHintStream.decode(#"[{"type":"suggestion","en":"x"}]"#))
    }

    func testEmptyObjectIsRejected() {
        XCTAssertNil(CallHintStream.decode("{}"))
    }
}
