import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.shouldGiveUp(after:)`, the pure give-up
/// threshold used by `handleDisconnect` when the live `/ui` socket keeps failing
/// to reconnect mid-call. Once consecutive failures hit `maxReconnectAttempts`
/// the stream stops retrying and reports a terminal failure instead of looping
/// forever behind a frozen feed. A bad edit (off-by-one, dropped ceiling) would
/// either strand users on a dead feed or give up after a single blip, with
/// nothing catching it — these tests pin the threshold, mirroring the timing /
/// decode / encode tests.
///
/// The function is side-effect free (no networking, no dispatch), so the tests
/// run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamGiveUpTests: XCTestCase {

    func testKeepsRetryingBelowThreshold() {
        // Every attempt before the cap must keep the stream retrying so a brief
        // network blip does not kill the feed.
        for attempt in 1..<CallHintStream.maxReconnectAttempts {
            XCTAssertFalse(
                CallHintStream.shouldGiveUp(after: attempt),
                "attempt \(attempt) should still retry"
            )
        }
    }

    func testGivesUpAtThreshold() {
        // Hitting the cap (5 consecutive failures by default) must stop retrying.
        XCTAssertTrue(CallHintStream.shouldGiveUp(after: CallHintStream.maxReconnectAttempts))
    }

    func testGivesUpBeyondThreshold() {
        // Anything past the cap stays terminal — never silently resumes retrying.
        XCTAssertTrue(CallHintStream.shouldGiveUp(after: CallHintStream.maxReconnectAttempts + 1))
        XCTAssertTrue(CallHintStream.shouldGiveUp(after: 100))
    }

    func testThresholdIsFiveAttempts() {
        // Pin the documented default so a change is a deliberate, visible edit.
        XCTAssertEqual(CallHintStream.maxReconnectAttempts, 5)
        XCTAssertFalse(CallHintStream.shouldGiveUp(after: 4))
        XCTAssertTrue(CallHintStream.shouldGiveUp(after: 5))
    }
}
