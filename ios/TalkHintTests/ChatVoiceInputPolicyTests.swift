import XCTest
@testable import TalkHint

final class ChatVoiceInputPolicyTests: XCTestCase {
    func testSpeakerEchoNeverInterruptsOrSubmits() {
        var policy = ChatVoiceInputPolicy()
        policy.reset(playback: true)
        for index in 0..<200 {
            XCTAssertEqual(policy.sample(db: -32, at: Double(index) * 0.02), .none)
        }
        XCTAssertFalse(policy.canSubmit)
    }
    func testLoudTransientAndBrokenCandidateDoNotInterrupt() {
        var policy = ChatVoiceInputPolicy()
        policy.reset(playback: true)
        XCTAssertEqual(policy.sample(db: -20, at: 0), .candidate)
        XCTAssertEqual(policy.sample(db: -20, at: 0.3), .candidate)
        XCTAssertEqual(policy.sample(db: -35, at: 0.32), .rejected)
        XCTAssertEqual(policy.sample(db: -20, at: 0.5), .candidate)
        XCTAssertEqual(policy.sample(db: -20, at: 0.8), .candidate)
        XCTAssertEqual(policy.sample(db: -20, at: 1.3), .candidate)
        XCTAssertFalse(policy.canSubmit)
    }
    func testSustainedVoiceInterruptsOnceAndNeedsHalfSecondBeforeSubmission() {
        var policy = ChatVoiceInputPolicy()
        policy.reset(playback: true)
        XCTAssertEqual(policy.sample(db: -20, at: 1), .candidate)
        for time in [1.1, 1.2, 1.3] { XCTAssertEqual(policy.sample(db: -20, at: time), .none) }
        XCTAssertEqual(policy.sample(db: -20, at: 1.41), .speech)
        XCTAssertFalse(policy.canSubmit)
        XCTAssertEqual(policy.sample(db: -20, at: 1.55), .none)
        XCTAssertTrue(policy.canSubmit)
        XCTAssertEqual(policy.sample(db: -20, at: 1.6), .none)
    }
    func testQuietUserAfterPlaybackUsesNormalThresholdAndSilenceCannotSubmit() {
        var policy = ChatVoiceInputPolicy()
        XCTAssertEqual(policy.sample(db: -90, at: 1), .none)
        XCTAssertFalse(policy.canSubmit)
        XCTAssertEqual(policy.sample(db: -34, at: 2), .speech)
        _ = policy.sample(db: -34, at: 2.6)
        XCTAssertTrue(policy.canSubmit)
        policy.reset()
        XCTAssertFalse(policy.canSubmit)
    }
    func testShortYesAndInvalidLevelsAreNotSubmitted() {
        var policy = ChatVoiceInputPolicy()
        _ = policy.sample(db: -20, at: 0)
        _ = policy.sample(db: -20, at: 0.3)
        XCTAssertFalse(policy.canSubmit)
        XCTAssertEqual(policy.sample(db: .nan, at: 0.7), .none)
        XCTAssertFalse(policy.canSubmit)
    }
    func testLastReliableUserLanguageOverridesInterfaceButUnknownDoesNot() {
        var language = ChatVoiceLanguageHint()
        XCTAssertEqual(language.hint(interface: "ru-RU"), "ru")
        XCTAssertEqual(language.hint(interface: "ru", profile: "es-MX"), "es")
        language.detected("en-US")
        XCTAssertEqual(language.hint(interface: "ru"), "en")
        language.detected("und")
        XCTAssertEqual(language.hint(interface: "ru"), "en")
        XCTAssertEqual(ChatVoiceLanguageHint().hint(interface: "invalid"), "en")
    }
    func testHistoryRetriesOnlyNetworkAndAtMostTwice() {
        XCTAssertTrue(ChatVoiceHistoryRetryPolicy.shouldRetry(URLError(.networkConnectionLost), attempt: 0))
        XCTAssertTrue(ChatVoiceHistoryRetryPolicy.shouldRetry(URLError(.timedOut), attempt: 1))
        XCTAssertFalse(ChatVoiceHistoryRetryPolicy.shouldRetry(URLError(.networkConnectionLost), attempt: 2))
        XCTAssertFalse(ChatVoiceHistoryRetryPolicy.shouldRetry(APIError.decoding, attempt: 0))
        XCTAssertFalse(ChatVoiceHistoryRetryPolicy.shouldRetry(URLError(.cancelled), attempt: 0))
    }
}
