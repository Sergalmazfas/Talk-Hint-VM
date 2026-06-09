import Foundation

/// Holds the authenticated session (Bearer token + user id) used for all
/// backend calls. The token is stored in the Keychain; the user id (not
/// sensitive) in UserDefaults.
final class SessionStore {
    static let shared = SessionStore()

    private let tokenKey = "talkhint.session.token"
    private let userIdKey = "talkhint.user.id"
    private let emailKey = "talkhint.user.email"
    private let activeNumberIdKey = "talkhint.active.number.id"
    private let activeModeKey = "talkhint.assistant.mode"
    private let languageKey = "talkhint.assistant.language"
    private let callModeKey = "talkhint.user.call.mode"
    private let callGoalKey = "talkhint.assistant.goal"
    private let activePromptIdKey = "talkhint.assistant.prompt.id"
    private let userContextKey = "talkhint.user.context"

    /// Built-in assistant modes mirrored from the backend (`BUILTIN_MODES` in
    /// server/websocket.ts). Selecting one sends `set_mode` over the /ui socket.
    static let availableModes: [(id: String, name: String)] = [
        ("universal", "Universal Assistant"),
        ("massage", "Massage Salon Assistant"),
        ("dispatcher", "Dispatcher Assistant"),
    ]

    /// Languages the live assistant accepts for translations (server only honors
    /// "ru" / "es" on `set_language`).
    static let availableLanguages: [(code: String, name: String)] = [
        ("ru", "Русский"),
        ("es", "Español"),
    ]

    private init() {}

    var token: String? { Keychain.get(tokenKey) }
    var userId: String? { UserDefaults.standard.string(forKey: userIdKey) }
    var email: String? { UserDefaults.standard.string(forKey: emailKey) }
    var isLoggedIn: Bool { token != nil }

    /// The phone number the user has chosen as their active line. The backend has
    /// no per-user "active number" field, so this selection is stored locally and
    /// shared between the Numbers and Account tabs.
    var activeNumberId: String? {
        get { UserDefaults.standard.string(forKey: activeNumberIdKey) }
        set {
            if let value = newValue {
                UserDefaults.standard.set(value, forKey: activeNumberIdKey)
            } else {
                UserDefaults.standard.removeObject(forKey: activeNumberIdKey)
            }
        }
    }

    /// The built-in assistant mode applied to live calls (`set_mode`). Defaults
    /// to "universal" to match the backend default.
    var activeMode: String {
        get { UserDefaults.standard.string(forKey: activeModeKey) ?? "universal" }
        set { UserDefaults.standard.set(newValue, forKey: activeModeKey) }
    }

    /// The native language used for translations/hints (`set_language`). Server
    /// only honors "ru" / "es"; defaults to "ru".
    var language: String {
        get { UserDefaults.standard.string(forKey: languageKey) ?? "ru" }
        set { UserDefaults.standard.set(newValue, forKey: languageKey) }
    }

    /// How incoming calls are handled, persisted to the backend via
    /// `POST /api/user/call-mode` (enum live / forwarding / training). The
    /// backend exposes no GET for it, so this local copy is the display source
    /// of truth and is kept in sync on every successful update. Defaults to
    /// "live" to match the backend default.
    var callMode: String {
        get { UserDefaults.standard.string(forKey: callModeKey) ?? "live" }
        set { UserDefaults.standard.set(newValue, forKey: callModeKey) }
    }

    /// The call goal sent to the live assistant (`set_goal`). Empty string means
    /// no goal is set.
    var callGoal: String {
        get { UserDefaults.standard.string(forKey: callGoalKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: callGoalKey) }
    }

    /// The user's "My Context" free-text block, persisted on the backend
    /// (`/api/user/context`) and injected into every live hint. This local copy
    /// is the display source of truth and is refreshed from the backend when the
    /// Assistant tab appears. Empty string means no context is set.
    var userContext: String {
        get { UserDefaults.standard.string(forKey: userContextKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: userContextKey) }
    }

    /// The user prompt the user marked active. Tracked locally so the Assistant
    /// tab can show a checkmark; the backend persists `isActive` per prompt.
    var activePromptId: String? {
        get { UserDefaults.standard.string(forKey: activePromptIdKey) }
        set {
            if let value = newValue {
                UserDefaults.standard.set(value, forKey: activePromptIdKey)
            } else {
                UserDefaults.standard.removeObject(forKey: activePromptIdKey)
            }
        }
    }

    func save(token: String, userId: String, email: String) {
        Keychain.set(token, for: tokenKey)
        UserDefaults.standard.set(userId, forKey: userIdKey)
        UserDefaults.standard.set(email, forKey: emailKey)
    }

    func clear() {
        Keychain.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: userIdKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
        UserDefaults.standard.removeObject(forKey: activeNumberIdKey)
        UserDefaults.standard.removeObject(forKey: activeModeKey)
        UserDefaults.standard.removeObject(forKey: languageKey)
        UserDefaults.standard.removeObject(forKey: callModeKey)
        UserDefaults.standard.removeObject(forKey: callGoalKey)
        UserDefaults.standard.removeObject(forKey: activePromptIdKey)
        UserDefaults.standard.removeObject(forKey: userContextKey)
    }
}
