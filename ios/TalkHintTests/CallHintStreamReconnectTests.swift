import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.reconnectDelay(for:)`, the pure backoff timing
/// used by `handleDisconnect` when the live `/ui` socket drops mid-call. The feed
/// auto-reconnects after a brief blip, so this delay sits directly on the call's
/// recovery path: a bad edit (zeroed multiplier, dropped 6s cap) would make
/// retries either hammer the server or stall the feed, with nothing catching it.
/// These tests pin the timing contract, mirroring the decode/encode tests.
///
/// The function is side-effect free (no networking, no dispatch), so the tests
/// run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamReconnectTests: XCTestCase {

    func testDelayGrowsLinearlyWithAttempts() {
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 1), 1.5, accuracy: 0.0001)
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 2), 3.0, accuracy: 0.0001)
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 3), 4.5, accuracy: 0.0001)
    }

    func testDelayIsStrictlyIncreasingUntilCap() {
        // Each early attempt must wait longer than the previous one, so a blip
        // does not produce a tight reconnect loop that hammers the server.
        XCTAssertGreaterThan(
            CallHintStream.reconnectDelay(for: 2),
            CallHintStream.reconnectDelay(for: 1)
        )
        XCTAssertGreaterThan(
            CallHintStream.reconnectDelay(for: 3),
            CallHintStream.reconnectDelay(for: 2)
        )
    }

    func testDelayIsCappedAtSixSeconds() {
        // The 4th attempt would be 6.0s uncapped; everything from there on is
        // pinned to the cap so the feed keeps retrying promptly and never stalls.
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 4), 6.0, accuracy: 0.0001)
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 5), 6.0, accuracy: 0.0001)
        XCTAssertEqual(CallHintStream.reconnectDelay(for: 100), 6.0, accuracy: 0.0001)
    }

    func testDelayNeverExceedsCap() {
        for attempt in 1...1000 {
            XCTAssertLessThanOrEqual(CallHintStream.reconnectDelay(for: attempt), 6.0)
        }
    }

    func testFirstAttemptIsNonZero() {
        // A zeroed multiplier would make the first reconnect fire immediately and
        // spin; the first attempt must always wait a real interval.
        XCTAssertGreaterThan(CallHintStream.reconnectDelay(for: 1), 0.0)
    }
}
