import Foundation

/// Only identity persistence; no settings, calls or network operations.
/// Closures allow failed OS writes to be tested without weakening real Keychain.
final class SessionCredentials {
    private let defaults: UserDefaults
    private let write: (String, String) -> Bool
    private let read: (String) -> String?
    private let remove: (String) -> Void
    private let tokenKey = "talkhint.session.token"
    private let userKey = "talkhint.user.id"
    private let emailKey = "talkhint.user.email"

    init(defaults: UserDefaults = .standard,
         write: @escaping (String, String) -> Bool = { Keychain.set($0, for: $1) },
         read: @escaping (String) -> String? = { Keychain.get($0) },
         remove: @escaping (String) -> Void = { Keychain.delete($0) }) {
        self.defaults = defaults
        self.write = write
        self.read = read
        self.remove = remove
    }

    var userId: String? {
        guard let id = defaults.string(forKey: userKey), !id.isEmpty else { return nil }
        return id
    }
    var email: String? { defaults.string(forKey: emailKey) }
    var token: String? {
        guard userId != nil, let token = read(tokenKey), !token.isEmpty else { return nil }
        return token
    }

    @discardableResult
    func save(token: String, userId: String, email: String) -> Bool {
        // Never expose a previous user's token with a new user's metadata.
        guard !token.isEmpty, !userId.isEmpty,
              write(token, tokenKey), read(tokenKey) == token else {
            remove(tokenKey)
            defaults.removeObject(forKey: userKey)
            defaults.removeObject(forKey: emailKey)
            return false
        }
        defaults.set(userId, forKey: userKey)
        defaults.set(email, forKey: emailKey)
        guard self.token == token && self.userId == userId else {
            remove(tokenKey)
            defaults.removeObject(forKey: userKey)
            defaults.removeObject(forKey: emailKey)
            return false
        }
        return true
    }
}
