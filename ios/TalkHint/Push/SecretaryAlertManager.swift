import UIKit
import UserNotifications

/// Standard user-visible APNs alerts are separate from PushKit's VoIP token.
/// Permission is requested only from the Secretary tab, never during launch or
/// in response to an incoming-call push.
final class SecretaryAlertManager: NSObject {
    static let shared = SecretaryAlertManager()

    private static let tokenKey = "talkhint.apns.alert.token"
    private static let optedInKey = "talkhint.apns.alert.opted_in"
    private let center = UNUserNotificationCenter.current()
    var isOptedIn: Bool {
        UserDefaults.standard.bool(forKey: Self.optedInKey)
    }
    private var alertToken: String? {
        get { UserDefaults.standard.string(forKey: Self.tokenKey) }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: Self.tokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.tokenKey)
            }
        }
    }

    private override init() {
        super.init()
    }

    func start() {
        center.delegate = self
    }

    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        center.getNotificationSettings { settings in
            DispatchQueue.main.async { completion(settings.authorizationStatus) }
        }
    }

    /// Called only after an explicit tap on the Secretary screen's notification
    /// control. Denied permission is reported to the UI instead of repeatedly
    /// triggering a system prompt that can no longer appear.
    func requestFromSecretary(completion: @escaping (Bool) -> Void) {
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async {
                    UserDefaults.standard.set(true, forKey: Self.optedInKey)
                    UIApplication.shared.registerForRemoteNotifications()
                    completion(true)
                }
            case .notDetermined:
                self.center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    DispatchQueue.main.async {
                        if granted {
                            UserDefaults.standard.set(true, forKey: Self.optedInKey)
                            UIApplication.shared.registerForRemoteNotifications()
                        }
                        completion(granted)
                    }
                }
            case .denied:
                DispatchQueue.main.async { completion(false) }
            @unknown default:
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    func registerCurrentTokenIfPossible() {
        guard SessionStore.shared.isLoggedIn, isOptedIn else { return }
        if let alertToken, !alertToken.isEmpty {
            Task { try? await APIClient.shared.registerAlertDevice(token: alertToken) }
            return
        }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func unregisterCurrentToken() async {
        UserDefaults.standard.set(false, forKey: Self.optedInKey)
        guard let token = alertToken, !token.isEmpty else {
            alertToken = nil
            return
        }
        try? await APIClient.shared.unregisterAlertDevice(token: token)
        alertToken = nil
    }

    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard !token.isEmpty, isOptedIn else { return }
        alertToken = token
        registerCurrentTokenIfPossible()
    }

    func didFailToRegisterForRemoteNotifications() {
        // Do not fall back to or overwrite the separate PushKit VoIP token.
    }

}

extension SecretaryAlertManager: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let payload = response.notification.request.content.userInfo
        if payload["type"] as? String == "secretary_result",
           let taskId = payload["taskId"] as? String,
           !taskId.isEmpty {
            Task { @MainActor in
                SecretaryNotificationRouter.open(taskID: taskId)
            }
        }
        completionHandler()
    }
}

/// Defers a report deep-link until the authenticated tab shell is available.
/// Only the opaque task ID is read from APNs; report data is always fetched from
/// the authenticated Secretary API.
enum SecretaryNotificationRouter {
    private static var pendingTaskID: String?

    @MainActor
    static func open(taskID: String) {
        pendingTaskID = taskID
        _ = openPendingIfPossible()
    }

    @MainActor
    @discardableResult
    static func openPendingIfPossible() -> Bool {
        guard let taskID = pendingTaskID else { return false }
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene,
                  let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first,
                  let tabs = window.rootViewController as? UITabBarController,
                  tabs.viewControllers?.indices.contains(3) == true,
                  let navigation = tabs.viewControllers?[3] as? UINavigationController,
                  let secretary = navigation.viewControllers.first as? SecretaryViewController else { continue }
            tabs.selectedIndex = 3
            navigation.popToRootViewController(animated: false)
            pendingTaskID = nil
            secretary.openTask(id: taskID)
            return true
        }
        return false
    }
}