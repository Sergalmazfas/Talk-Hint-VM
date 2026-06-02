import Foundation
import PushKit

/// Manages the PushKit VoIP token: registers it with the backend's
/// `device_tokens` table and routes incoming VoIP pushes to the CallManager.
final class PushManager: NSObject {
    static let shared = PushManager()

    private var registry: PKPushRegistry?
    private(set) var voipToken: String?

    private override init() {}

    /// Call once at app launch (from AppDelegate) so pushes are handled even
    /// when the app is launched into the background by an incoming call.
    func start() {
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
    }

    /// Registers the current VoIP token with the backend if we have one and the
    /// user is logged in. Safe to call again after login.
    func registerCurrentTokenIfPossible() {
        guard let token = voipToken, SessionStore.shared.isLoggedIn else { return }
        Task { try? await APIClient.shared.registerDevice(voipToken: token) }
    }

    /// Unregisters the current token from the backend (call on logout).
    func unregisterCurrentToken() async {
        guard let token = voipToken else { return }
        try? await APIClient.shared.unregisterDevice(voipToken: token)
    }
}

extension PushManager: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        voipToken = token
        registerCurrentTokenIfPossible()
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }

        let dict = payload.dictionaryPayload
        let callSid = dict["callSid"] as? String
        let fromNumber = (dict["fromNumber"] as? String) ?? "Unknown"

        Task { @MainActor in
            if let callSid = callSid {
                CallManager.shared.reportIncomingCall(callSid: callSid, fromNumber: fromNumber, completion: completion)
            } else {
                // iOS 13+ still requires a reported call for every VoIP push.
                CallManager.shared.reportAndImmediatelyEnd(completion: completion)
            }
        }
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        let token = voipToken
        voipToken = nil
        if let token = token {
            Task { try? await APIClient.shared.unregisterDevice(voipToken: token) }
        }
    }
}
