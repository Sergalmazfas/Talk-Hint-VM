import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize CallKit before any push can arrive.
        _ = CallManager.shared
        // Start PushKit so VoIP pushes are handled even when launched in background.
        PushManager.shared.start()
        // Standard APNs alerts are used for completed Secretary tasks. The
        // manager does not request permission here; Secretary asks in context.
        SecretaryAlertManager.shared.start()
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        SecretaryAlertManager.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        SecretaryAlertManager.shared.didFailToRegisterForRemoteNotifications()
    }

    // MARK: UISceneSession Lifecycle

    func application(_ application: UIApplication,
                    configurationForConnecting connectingSceneSession: UISceneSession,
                    options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
}
