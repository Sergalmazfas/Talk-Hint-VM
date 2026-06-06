import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.reconnectingStatusText(attempt:of:)`, the pure
/// copy shown while the live `/ui` socket retries mid-call. The transient state
/// must convey progress (an attempt count, not a frozen "Reconnecting…") and
/// escalate the wording on the final attempt before the terminal give-up state.
/// A bad edit (dropped attempt count, lost escalation) would be a silent UX
/// regression with nothing catching it, so these tests pin the contract,
/// mirroring the timing / give-up helpers.
///
/// The function is side-effect free (no networking, no dispatch), so the tests
/// run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamReconnectStatusTests: XCTestCase {

    func testIncludesAttemptProgress() {
        // The transient label must surface how far recovery has progressed so the
        // feed never reads as frozen.
        let text = CallHintStream.reconnectingStatusText(attempt: 2, of: 5)
        XCTAssertTrue(text.contains("2"), "should name the current attempt")
        XCTAssertTrue(text.contains("5"), "should name the give-up ceiling")
        XCTAssertTrue(text.lowercased().contains("attempt"))
    }

    func testEarlyAttemptsUseStandardWording() {
        for attempt in 1..<CallHintStream.maxReconnectAttempts {
            let text = CallHintStream.reconnectingStatusText(
                attempt: attempt, of: CallHintStream.maxReconnectAttempts)
            XCTAssertTrue(text.contains("Reconnecting to live assistant"),
                          "attempt \(attempt) should use the standard wording")
            XCTAssertFalse(text.contains("Still trying"),
                           "attempt \(attempt) should not escalate yet")
        }
    }

    func testFinalAttemptEscalatesWording() {
        // The last attempt before the terminal state must read differently so the
        // transient state is distinct as it approaches give-up.
        let text = CallHintStream.reconnectingStatusText(
            attempt: CallHintStream.maxReconnectAttempts,
            of: CallHintStream.maxReconnectAttempts)
        XCTAssertTrue(text.contains("Still trying to reconnect"))
    }

    func testWordingDiffersAcrossAttempts() {
        // Distinct attempts must not render identical strings — otherwise the
        // label would look frozen between retries.
        let first = CallHintStream.reconnectingStatusText(attempt: 1, of: 5)
        let second = CallHintStream.reconnectingStatusText(attempt: 2, of: 5)
        XCTAssertNotEqual(first, second)
    }
}
