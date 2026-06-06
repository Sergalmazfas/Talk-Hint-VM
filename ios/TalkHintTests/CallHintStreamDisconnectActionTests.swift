import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.disconnectAction(handshakeStatusCode:priorAttempts:)`,
/// the pure decision the live `handleDisconnect` uses to choose between the
/// sign-in path, the terminal give-up, and another reconnect when the `/ui`
/// socket drops mid-call. `isAuthRejection` is tested separately; these tests pin
/// the *wiring* on top of it — that an auth-rejected handshake (expired/revoked
/// session) routes to `.signIn` regardless of how many retries preceded it, while
/// a network-class drop advances the retry count until the give-up ceiling. A bad
/// edit (sending expired sessions down the retry loop, or auth rejections into a
/// frozen "connection lost" state) would otherwise be a silent regression.
///
/// The function is side-effect free (no networking, no dispatch), so the tests
/// run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamDisconnectActionTests: XCTestCase {

    func testAuthRejectionRoutesToSignIn() {
        // A 401/403 handshake is an expired/revoked session — the sign-in path,
        // never a reconnect, so the in-call screen can show "Sign in".
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: 401, priorAttempts: 0),
            .signIn)
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: 403, priorAttempts: 0),
            .signIn)
    }

    func testAuthRejectionWinsEvenAfterPriorRetries() {
        // The sign-in decision must not depend on the retry count: a session that
        // expires mid-call (after some transient blips) still routes to sign-in,
        // not into the give-up/terminal path it would otherwise be near.
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: 401, priorAttempts: 4),
            .signIn,
            "an auth rejection must route to sign-in regardless of prior attempts")
    }

    func testNetworkDropSchedulesNextRetry() {
        // No handshake status (genuine network drop) advances the 1-based attempt
        // count rather than demanding sign-in.
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: nil, priorAttempts: 0),
            .retry(attempt: 1))
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: nil, priorAttempts: 1),
            .retry(attempt: 2))
    }

    func testNonAuthHTTPStatusStillRetries() {
        // Server/transport errors (not 401/403) are network-class failures that
        // must keep retrying, not route to sign-in.
        for code in [500, 502, 503, 426] {
            XCTAssertEqual(
                CallHintStream.disconnectAction(handshakeStatusCode: code, priorAttempts: 0),
                .retry(attempt: 1),
                "status \(code) should reconnect, not demand sign-in")
        }
    }

    func testRetriesGiveUpAtCeiling() {
        // The attempt that reaches `maxReconnectAttempts` flips to the terminal
        // give-up state instead of scheduling yet another reconnect.
        let lastRetry = CallHintStream.maxReconnectAttempts - 1
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: nil, priorAttempts: lastRetry - 1),
            .retry(attempt: lastRetry),
            "the attempt just below the ceiling must still retry")
        XCTAssertEqual(
            CallHintStream.disconnectAction(handshakeStatusCode: nil, priorAttempts: lastRetry),
            .giveUp,
            "reaching the ceiling must give up, not retry forever")
    }
}
