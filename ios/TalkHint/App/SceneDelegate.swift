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

    /// Builds the main tab bar shown after login. The Calls and Account tabs are
    /// live (Stage 1); Numbers, Assistant and History are placeholders that later
    /// stages replace with their real screens.
    private func makeMainTabController() -> UITabBarController {
        let tabController = UITabBarController()

        let calls = HomeViewController()
        calls.tabBarItem = UITabBarItem(
            title: "Calls", image: UIImage(systemName: "phone.fill"), tag: 0)

        let numbers = NumbersViewController()
        numbers.tabBarItem = UITabBarItem(
            title: "Numbers", image: UIImage(systemName: "number"), tag: 1)

        let assistant = AssistantViewController()
        assistant.tabBarItem = UITabBarItem(
            title: "Assistant", image: UIImage(systemName: "wand.and.stars"), tag: 2)

        let history = CallHistoryViewController()
        history.tabBarItem = UITabBarItem(
            title: "History", image: UIImage(systemName: "clock"), tag: 3)

        let settings = SettingsViewController()
        settings.tabBarItem = UITabBarItem(
            title: "Settings", image: UIImage(systemName: "gearshape"), tag: 4)

        let account = AccountViewController()
        account.onLoggedOut = { [weak self] in self?.showRoot(loggedIn: false) }
        account.tabBarItem = UITabBarItem(
            title: "Account", image: UIImage(systemName: "person.crop.circle"), tag: 5)

        tabController.viewControllers = [
            UINavigationController(rootViewController: calls),
            UINavigationController(rootViewController: numbers),
            UINavigationController(rootViewController: assistant),
            UINavigationController(rootViewController: history),
            UINavigationController(rootViewController: settings),
            UINavigationController(rootViewController: account),
        ]
        return tabController
    }
}
