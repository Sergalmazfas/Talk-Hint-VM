import XCTest
@testable import TalkHint

/// Unit tests for `CallHintStream.isAuthRejection(statusCode:)`, the pure check
/// `handleDisconnect` uses to tell an expired/revoked session apart from a
/// transient network drop when the live `/ui` socket fails mid-call. The backend
/// refuses an unauthenticated WebSocket upgrade with an HTTP 401 (see
/// `setupWebSocket`); when the handshake response carries that status the stream
/// must surface the actionable "sign in" state (`callHintStreamDidRequireSignIn`)
/// instead of retrying into the misleading "connection lost" terminal path. A bad
/// edit (matching the wrong codes, dropping the nil guard) would silently strand
/// expired-session users on the dead-end retry path, with nothing catching it —
/// these tests pin the contract, mirroring the give-up / timing / decode tests.
///
/// The function is side-effect free (no networking, no dispatch), so the tests
/// run without a live socket.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class CallHintStreamAuthRejectionTests: XCTestCase {

    func testTreats401AsAuthRejection() {
        // The exact status the backend writes for a missing/expired session.
        XCTAssertTrue(CallHintStream.isAuthRejection(statusCode: 401))
    }

    func testTreats403AsAuthRejection() {
        // Defensive: a forbidden response is also an auth problem, not a network
        // blip, so it must route to "sign in" too.
        XCTAssertTrue(CallHintStream.isAuthRejection(statusCode: 403))
    }

    func testNilStatusIsNotAuthRejection() {
        // A genuine network drop has no HTTP handshake response — it must keep the
        // normal reconnect/give-up path, never the sign-in path.
        XCTAssertFalse(CallHintStream.isAuthRejection(statusCode: nil))
    }

    func testNonAuthStatusesAreNotAuthRejection() {
        // Successful upgrade (101) and server/transport errors are network-class
        // failures that should retry, not demand re-authentication.
        for code in [101, 200, 404, 426, 500, 502, 503] {
            XCTAssertFalse(
                CallHintStream.isAuthRejection(statusCode: code),
                "status \(code) should not be treated as an auth rejection"
            )
        }
    }
}
