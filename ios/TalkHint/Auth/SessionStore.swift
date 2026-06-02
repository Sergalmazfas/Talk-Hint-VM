import Foundation

/// Holds the authenticated session (Bearer token + user id) used for all
/// backend calls. The token is stored in the Keychain; the user id (not
/// sensitive) in UserDefaults.
final class SessionStore {
    static let shared = SessionStore()

    private let tokenKey = "talkhint.session.token"
    private let userIdKey = "talkhint.user.id"
    private let emailKey = "talkhint.user.email"

    private init() {}

    var token: String? { Keychain.get(tokenKey) }
    var userId: String? { UserDefaults.standard.string(forKey: userIdKey) }
    var email: String? { UserDefaults.standard.string(forKey: emailKey) }
    var isLoggedIn: Bool { token != nil }

    func save(token: String, userId: String, email: String) {
        Keychain.set(token, for: tokenKey)
        UserDefaults.standard.set(userId, forKey: userIdKey)
        UserDefaults.standard.set(email, forKey: emailKey)
    }

    func clear() {
        Keychain.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: userIdKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
    }
}
