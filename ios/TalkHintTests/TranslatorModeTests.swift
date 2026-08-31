import XCTest
@testable import TalkHint

/// Contract checks for Translator phone calls.
/// Run on macOS with:
/// xcodebuild test -scheme TalkHint \
///   -destination 'platform=iOS Simulator,name=iPhone 15'
@MainActor
final class TranslatorModeTests: XCTestCase {
    func testDialInputAcceptsPastedFormattedPhoneNumber() {
        XCTAssertEqual(
            HomeViewController.normalizedDialInput("+1 (909) 991-2111"),
            "+19099912111"
        )
        XCTAssertEqual(HomeViewController.normalizedDialInput("++1 23abc"), "+123")
    }
    func testTranslatorOutgoingCallIsExplicitlyModeTagged() {
        let params = CallManager.connectParameters(to: "+14155550100", mode: .translator)
        XCTAssertEqual(params, [
            "To": "+14155550100",
            "GuestTo": "+14155550100",
            "TranslatorMode": "ru_en",
        ])
    }

    func testTranslatorMetadataParsesStructuredConversation() throws {
        let record = try XCTUnwrap(APIClient.parseCall([
            "id": "call-1", "callSid": "CA1", "metadata": [
                "mode": "translator",
                "translationTurns": [[
                    "leg": "owner",
                    "sourceTranscript": "Привет",
                    "translatedTranscript": "Hello",
                ]],
            ],
        ]))
        XCTAssertEqual(record.mode, .translator)
        XCTAssertEqual(record.translationTurns, [
            .init(original: "Привет", translation: "Hello"),
        ])
    }

    func testHintCallRemainsModeTaggedAsHint() {
        XCTAssertEqual(CallManager.connectParameters(to: "+14155550100", mode: .hint), [
            "To": "+14155550100",
        ])
    }

    func testTranslatorPhoneFeedKeepsSourceTurnOpenUntilCompletion() {
        guard case let .transcript(leg, source, translation, isFinal)? =
                TranslatorPhoneFeedStream.decode(#"{"type":"source_transcript","leg":"guest","sourceTranscript":"Привет"}"#) else {
            return XCTFail("Expected translator turn")
        }
        XCTAssertEqual(leg, "guest")
        XCTAssertEqual(source, "Привет")
        XCTAssertNil(translation)
        XCTAssertFalse(isFinal, "Source cards must stay available for translation updates")

        guard case let .translationDelta(leg, text)? =
                TranslatorPhoneFeedStream.decode(#"{"type":"translation_delta","leg":"guest","translatedTranscript":"Hel"}"#) else {
            return XCTFail("Expected translation delta")
        }
        XCTAssertEqual(leg, "guest")
        XCTAssertEqual(text, "Hel")

        guard case let .translation(doneLeg, doneText, isFinal)? =
                TranslatorPhoneFeedStream.decode(#"{"type":"translated_transcript_done","leg":"guest","translatedTranscript":"Hello"}"#) else {
            return XCTFail("Expected completed translation")
        }
        XCTAssertEqual(doneLeg, "guest")
        XCTAssertEqual(doneText, "Hello")
        XCTAssertTrue(isFinal)

        guard case let .turnCompleted(completedLeg)? =
                TranslatorPhoneFeedStream.decode(#"{"type":"turn_completed","leg":"guest"}"#) else {
            return XCTFail("Expected turn completion")
        }
        XCTAssertEqual(completedLeg, "guest")
    }
}