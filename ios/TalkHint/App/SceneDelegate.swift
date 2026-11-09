import UIKit
import UserNotifications

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
              willConnectTo session: UISceneSession,
              options connectionOptions: UIScene.ConnectionOptions) {
        print("[SceneDelegate] willConnectTo")
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        self.window = window
        #if TALKHINT_NATIVE_VALIDATION
        // Tests construct the controllers they need; no saved login or push routing.
        window.rootViewController = UIViewController()
        window.makeKeyAndVisible()
        return
        #elseif TALKHINT_CHAT_PREVIEW
        // Separate native design preview, not a change to working navigation.
        window.rootViewController = ChatApprovedPreviewHost()
        window.makeKeyAndVisible()
        return
        #elseif TALKHINT_CHAT_LIVE_DEV
        // Real chat API with normal login, but no telephony, push registration or main-tab changes.
        _ = AppConfig.baseURL // Validate the Dev-only origin before reading a saved session.
        #if TALKHINT_APP_DEV
        showAppDev(loggedIn: SessionStore.shared.isLoggedIn)
        #else
        showLiveChat(loggedIn: SessionStore.shared.isLoggedIn)
        #endif
        window.makeKeyAndVisible()
        return
        #else
        let loggedIn = SessionStore.shared.isLoggedIn
        print("[SceneDelegate] preparing \(loggedIn ? "main tabs" : "login")")
        showRoot(loggedIn: loggedIn)
        print("[SceneDelegate] root controller ready")
        window.makeKeyAndVisible()
        print("[SceneDelegate] window visible")

        if let response = connectionOptions.notificationResponse {
            let payload = response.notification.request.content.userInfo
            if payload["type"] as? String == "incoming_secretary_request" {
                Task { @MainActor in SecretaryNotificationRouter.openIncoming() }
            }
            if payload["type"] as? String == "secretary_result",
               let taskID = payload["taskId"] as? String,
               !taskID.isEmpty {
                Task { @MainActor in SecretaryNotificationRouter.open(taskID: taskID) }
            }
        }

        // If already logged in, make sure the VoIP token is registered.
        if SessionStore.shared.isLoggedIn {
            PushManager.shared.registerCurrentTokenIfPossible()
            SecretaryAlertManager.shared.registerCurrentTokenIfPossible()
        }
        #endif
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        #if !TALKHINT_NATIVE_VALIDATION && !TALKHINT_CHAT_PREVIEW && !TALKHINT_CHAT_LIVE_DEV
        print("[SceneDelegate] active")
        _ = SecretaryNotificationRouter.openPendingIfPossible()
        #endif
    }

    #if TALKHINT_CHAT_LIVE_DEV
    private func showAppDev(loggedIn: Bool) {
        if loggedIn && SessionStore.shared.isLoggedIn {
            window?.rootViewController = makeMainTabController(chatFactory: { [weak self] in
                if let chat = ChatViewController.liveApprovedScreen() { return chat }
                let login = LoginViewController()
                login.onLoggedIn = { [weak self] in self?.showAppDev(loggedIn: true) }
                return login
            })
        } else {
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in self?.showAppDev(loggedIn: true) }
            window?.rootViewController = UINavigationController(rootViewController: login)
        }
    }

    private func showLiveChat(loggedIn: Bool) {
        if loggedIn, let chat = ChatViewController.liveApprovedScreen() {
            chat.onClose = { [weak self] in self?.showLiveChat(loggedIn: false) }
            window?.rootViewController = ChatNavigationController(chat: chat)
        } else {
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in self?.showLiveChat(loggedIn: true) }
            window?.rootViewController = UINavigationController(rootViewController: login)
        }
    }
    #endif

    func showRoot(loggedIn: Bool) {
        if loggedIn && SessionStore.shared.isLoggedIn {
            window?.rootViewController = makeMainTabController()
        } else {
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in
                self?.showRoot(loggedIn: true)
                PushManager.shared.registerCurrentTokenIfPossible()
                SecretaryAlertManager.shared.registerCurrentTokenIfPossible()
                _ = SecretaryNotificationRouter.openPendingIfPossible()
            }
            window?.rootViewController = UINavigationController(rootViewController: login)
        }
    }

    /// Builds the main tab bar shown after login (Hint / Translator / Chat /
    /// Secretary / History). Chat opens a retained full-screen stack; Settings
    /// remains available from Hint and also from the chat drawer.
    ///
    /// The first tab is FUNCTIONALLY the same Calls flow (dialer, recents,
    /// live-hint calls) — only its user-facing name/icon changed to "Hint".
    /// The Tutor tab was replaced by Translator; TutorViewController and the
    /// backend /tutor page are intentionally left in the codebase (no UI entry
    /// points, no refactoring — see task #274 scope).
    // Internal for hosted navigation regression tests; not an additional UI entry.
    func makeMainTabController(chatFactory: (() -> UIViewController)? = nil) -> UITabBarController {
        let defaultFactory: () -> UIViewController = { [weak self] in
            if let chat = ChatViewController.liveApprovedScreen() { return chat }
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in self?.showRoot(loggedIn: true) }
            return login
        }
        let tabController = TalkHintTabBarController(chatFactory: chatFactory ?? defaultFactory)
        tabController.tabBar.tintColor = Theme.green

        let calls = HomeViewController()
        calls.tabBarItem = UITabBarItem(
            title: NSLocalizedString("tab.hint", comment: ""),
            image: Self.tabIcon(badge: .sparkle), tag: 0)

        let translator = HomeViewController(mode: .translator)
        translator.tabBarItem = UITabBarItem(
            title: NSLocalizedString("tab.translator", comment: ""),
            image: Self.tabIcon(badge: .translate), tag: 1)

        let chat = ChatEntryViewController()
        chat.tabBarItem = UITabBarItem(
            title: NSLocalizedString("tab.chat", comment: ""),
            image: UIImage(systemName: "bubble.left.and.bubble.right"), tag: 2)

        let secretary = HomeViewController(secretary: true)
        secretary.tabBarItem = UITabBarItem(
            title: NSLocalizedString("tab.secretary", comment: ""),
            image: UIImage(systemName: "person.crop.circle.badge.checkmark"), tag: 3)

        let history = CallHistoryViewController()
        history.tabBarItem = UITabBarItem(
            title: NSLocalizedString("tab.history", comment: ""), image: UIImage(systemName: "clock"), tag: 4)

        let roots: [UIViewController] = [calls, translator, chat, secretary, history]
        tabController.viewControllers = roots.map { root in
            let navigation = UINavigationController(rootViewController: root)
            navigation.tabBarItem = root.tabBarItem
            return navigation
        }
        // Preserve the original phone/Hint launch. Chat is an intercepted entry,
        // not a selected tab containing a second bottom navigation bar.
        return tabController
    }

    // MARK: - Composite tab icons

    private enum TabBadge {
        /// Small sparkle over the handset — "call with live hints".
        case sparkle
        /// Small 文/A over the handset — "call with a translator".
        case translate
    }

    /// Renders a phone handset with a small badge (sparkle or 文/A) as a
    /// template image, matching the TalkHint style from the approved mockup.
    /// SF Symbols has no combined glyph for either concept, so the icon is
    /// composed at render time; `.alwaysTemplate` keeps normal tab tinting.
    private static func tabIcon(badge: TabBadge) -> UIImage {
        let size = CGSize(width: 30, height: 30)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { _ in
            // Handset, slightly bottom-left so the badge has room top-right.
            let phoneConfig = UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)
            if let phone = UIImage(systemName: "phone.fill", withConfiguration: phoneConfig) {
                phone.withTintColor(.black).draw(in: CGRect(x: 1, y: 8, width: 20, height: 20))
            }
            switch badge {
            case .sparkle:
                let badgeConfig = UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
                if let sparkles = UIImage(systemName: "sparkles", withConfiguration: badgeConfig) {
                    sparkles.withTintColor(.black).draw(in: CGRect(x: 17, y: 1, width: 13, height: 13))
                }
            case .translate:
                // 文 + A drawn as text (no SF Symbol below iOS 17.4 covers this).
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 9, weight: .bold),
                    .foregroundColor: UIColor.black,
                ]
                ("文" as NSString).draw(at: CGPoint(x: 16, y: 0), withAttributes: attrs)
                ("A" as NSString).draw(at: CGPoint(x: 23, y: 7), withAttributes: attrs)
            }
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
}
