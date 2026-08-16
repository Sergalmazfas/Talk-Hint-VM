import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
              willConnectTo session: UISceneSession,
              options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        self.window = window
        showRoot(loggedIn: SessionStore.shared.isLoggedIn)
        window.makeKeyAndVisible()

        // If already logged in, make sure the VoIP token is registered.
        if SessionStore.shared.isLoggedIn {
            PushManager.shared.registerCurrentTokenIfPossible()
        }
    }

    func showRoot(loggedIn: Bool) {
        if loggedIn {
            window?.rootViewController = makeMainTabController()
        } else {
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in
                self?.showRoot(loggedIn: true)
                PushManager.shared.registerCurrentTokenIfPossible()
            }
            window?.rootViewController = UINavigationController(rootViewController: login)
        }
    }

    /// Builds the main tab bar shown after login — the redesigned three-tab
    /// layout (Calls / Tutor / History). Settings opens from the gear on the
    /// Calls screen; Numbers, Assistant tools and Account are reachable from
    /// Settings ("More" section).
    private func makeMainTabController() -> UITabBarController {
        let tabController = UITabBarController()
        tabController.tabBar.tintColor = Theme.green

        let calls = HomeViewController()
        calls.tabBarItem = UITabBarItem(
            title: "Calls", image: UIImage(systemName: "phone.fill"), tag: 0)

        let tutor = TutorViewController()
        tutor.tabBarItem = UITabBarItem(
            title: "Tutor", image: UIImage(systemName: "graduationcap"), tag: 1)

        let history = CallHistoryViewController()
        history.tabBarItem = UITabBarItem(
            title: "History", image: UIImage(systemName: "clock"), tag: 2)

        tabController.viewControllers = [
            UINavigationController(rootViewController: calls),
            UINavigationController(rootViewController: tutor),
            UINavigationController(rootViewController: history),
        ]
        return tabController
    }
}
