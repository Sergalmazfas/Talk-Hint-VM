import XCTest
@testable import TalkHint

final class SessionCredentialsTests: XCTestCase {
    private var suite: String!
    private var defaults: UserDefaults!
    override func setUp() {
        super.setUp()
        suite = "session-credentials-tests-\(UUID())"
        defaults = UserDefaults(suiteName: suite)!
    }
    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }
    func testFailedWriteNeverPersistsIdentityOrTokenInDefaults() {
        let store = SessionCredentials(defaults: defaults, write: { _, _ in false },
                                       read: { _ in nil }, remove: { _ in })
        XCTAssertFalse(store.save(token: "fixture-token", userId: "fixture-owner", email: "fixture.invalid"))
        XCTAssertNil(store.token)
        XCTAssertNil(store.userId)
        XCTAssertNil(store.email)
        XCTAssertTrue(defaults.dictionaryRepresentation().values.allSatisfy { ($0 as? String) != "fixture-token" })
    }
    func testSuccessRequiresSecureReadback() {
        var secure: [String: String] = [:]
        let store = SessionCredentials(defaults: defaults,
            write: { value, key in secure[key] = value; return true },
            read: { secure[$0] }, remove: { secure.removeValue(forKey: $0) })
        XCTAssertTrue(store.save(token: "fixture-token", userId: "fixture-owner", email: "fixture.invalid"))
        XCTAssertEqual(store.token, "fixture-token")
        XCTAssertEqual(store.userId, "fixture-owner")
        XCTAssertNil(defaults.string(forKey: "talkhint.session.token"))
    }
    func testReadbackFailureDoesNotDeclareLoginSuccessful() {
        var removed = false
        let store = SessionCredentials(defaults: defaults, write: { _, _ in true },
                                       read: { _ in nil }, remove: { _ in removed = true })
        XCTAssertFalse(store.save(token: "fixture-token", userId: "fixture-owner", email: "fixture.invalid"))
        XCTAssertTrue(removed)
        XCTAssertNil(store.userId)
        XCTAssertNil(store.token)
    }
    func testFailedAccountSwitchCannotExposeOldTokenAsNewOwner() {
        defaults.set("owner-a", forKey: "talkhint.user.id")
        defaults.set("a.invalid", forKey: "talkhint.user.email")
        let store = SessionCredentials(defaults: defaults, write: { _, _ in false },
                                       read: { _ in "token-a" }, remove: { _ in })
        XCTAssertFalse(store.save(token: "token-b", userId: "owner-b", email: "b.invalid"))
        XCTAssertNil(store.userId)
        XCTAssertNil(store.email)
        XCTAssertNil(store.token)
    }
    func testEmptyCredentialsAreRejectedBeforeSecureWrite() {
        var writes = 0
        let store = SessionCredentials(defaults: defaults, write: { _, _ in writes += 1; return true },
                                       read: { _ in nil }, remove: { _ in })
        XCTAssertFalse(store.save(token: "", userId: "owner", email: "fixture.invalid"))
        XCTAssertFalse(store.save(token: "fixture-token", userId: "", email: "fixture.invalid"))
        XCTAssertEqual(writes, 0)
    }
    func testIdentityWithoutSecureTokenIsNotAuthenticated() {
        defaults.set("owner", forKey: "talkhint.user.id")
        let store = SessionCredentials(defaults: defaults, write: { _, _ in false },
                                       read: { _ in nil }, remove: { _ in })
        XCTAssertNil(store.token)
    }
}
