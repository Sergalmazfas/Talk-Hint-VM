import XCTest
@testable import TalkHint

final class ChatVoiceSpeechStateTests: XCTestCase {
    func testPauseProposalDoesNotSilentlyChangeTheActiveTimer() {
        XCTAssertEqual(ChatVoicePausePolicy.currentSeconds, 1.2)
        XCTAssertEqual(ChatVoicePausePolicy.proposedSeconds, 0.8)
        XCTAssertTrue(ChatVoicePausePolicy.wouldEnd(silence: 0.7, threshold: 0.6))
        XCTAssertFalse(ChatVoicePausePolicy.wouldEnd(silence: 0.7, threshold: 0.8))
        XCTAssertTrue(ChatVoicePausePolicy.wouldEnd(silence: 0.9, threshold: 0.8))
        XCTAssertFalse(ChatVoicePausePolicy.wouldEnd(silence: 0.9, threshold: 1.2))
    }
    func testFirstSentenceIsAvailableBeforeTheWholeReply() {
        var cursor = ChatVoiceSentenceCursor()
        let part = cursor.next("Hello! The next sentence is still", complete: false)
        XCTAssertEqual(part?.offset, 0)
        XCTAssertEqual(part?.length, 6)
        XCTAssertNil(cursor.next("Hello! The next sentence is still", complete: false))
        XCTAssertNotNil(cursor.next("Hello! The next sentence is complete.", complete: true))
    }
    func testDecimalPriceIsNotCutAtTheDot() {
        var cursor = ChatVoiceSentenceCursor()
        XCTAssertNil(cursor.next("It costs $249.", complete: false))
        let text = "It costs $249.50. It is available."
        let part = cursor.next(text, complete: false)!
        XCTAssertEqual((text as NSString).substring(with: NSRange(location: part.offset, length: part.length)), "It costs $249.50.")
    }
    func testUTF16OffsetsAndNoRepeatedSentence() {
        var cursor = ChatVoiceSentenceCursor()
        let text = "Да! 😊 Отлично."
        let first = cursor.next(text, complete: true)!
        let second = cursor.next(text, complete: true)!
        XCTAssertEqual(first.length + second.length, (text as NSString).length)
        XCTAssertNil(cursor.next(text, complete: true))
    }
    func testOneTurnTimingIncludesVadAndDeviceOutputEstimate() {
        var trace = ChatVoiceLatencyTrace(speechEnd: 10, vadFinished: 11.2)
        trace.sttStarted = 11.2; trace.sttFinished = 11.5
        trace.submissionStarted = 11.5; trace.accepted = 11.6
        trace.sentenceReady = 12; trace.ttsStarted = 12
        let value = trace.payload(messageId: "reply", render: 12.2, outputLatency: 0.05)!
        XCTAssertEqual(value["speechEndToEstimatedFirstSoundMs"] as! Double, 2250, accuracy: 0.001)
        XCTAssertEqual(value["speechEndToVadMs"] as! Double, 1200, accuracy: 0.001)
    }
    func testNoTimingCanBeClaimedWithoutAudioRender() {
        let trace = ChatVoiceLatencyTrace(speechEnd: 10, vadFinished: 11.2)
        XCTAssertNil(trace.payload(messageId: "reply", render: 9, outputLatency: 0.05))
    }
}
