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
            let home = HomeViewController()
            home.onLoggedOut = { [weak self] in self?.showRoot(loggedIn: false) }
            window?.rootViewController = UINavigationController(rootViewController: home)
        } else {
            let login = LoginViewController()
            login.onLoggedIn = { [weak self] in
                self?.showRoot(loggedIn: true)
                PushManager.shared.registerCurrentTokenIfPossible()
            }
            window?.rootViewController = UINavigationController(rootViewController: login)
        }
    }
}
