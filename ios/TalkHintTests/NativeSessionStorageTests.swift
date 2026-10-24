import XCTest
import Foundation
import Security
@testable import TalkHint

/// UI fixtures deliberately use an injected credential source. This separate
/// integration test must still exercise real OS secure storage, never a mock.
final class NativeSessionStorageTests: XCTestCase {
    func testRealKeychainCanStoreReadAndDeleteSessionToken() {
        let key = "talkhint.native.validation.\(UUID().uuidString)"
        let token = "isolated-keychain-fixture"
        defer { Keychain.delete(key) }

        let saved = Keychain.set(token, for: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        let readStatus = SecItemCopyMatching(query as CFDictionary, nil)
        XCTAssertTrue(saved, "Native test host cannot write Keychain; inspect simulator signing/entitlements. Read OSStatus: \(readStatus)")
        XCTAssertEqual(readStatus, errSecSuccess, "Real Keychain must be available; no in-memory fallback is allowed")
        XCTAssertEqual(Keychain.get(key), token)
        Keychain.delete(key)
        XCTAssertNil(Keychain.get(key))
    }
}
