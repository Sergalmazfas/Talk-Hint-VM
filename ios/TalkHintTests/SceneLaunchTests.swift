import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class SceneLaunchTests: XCTestCase {
    func testLoggedInRootLoadsCallsScreen() {
        // The root now requires a session that is readable from the real Keychain.
        SessionStore.shared.clear()
        defer { SessionStore.shared.clear() }
        XCTAssertTrue(SessionStore.shared.save(token: "native-fixture", userId: "scene-launch-owner",
                                               email: "fixture@example.invalid"))
        let sceneDelegate = SceneDelegate()
        sceneDelegate.window = UIWindow(frame: UIScreen.main.bounds)

        sceneDelegate.showRoot(loggedIn: true)

        guard let tabs = sceneDelegate.window?.rootViewController as? UITabBarController else {
            XCTFail("A logged-in user must see the main tab controller")
            return
        }
        XCTAssertEqual(tabs.viewControllers?.count, 5)
        tabs.loadViewIfNeeded()
        guard let calls = tabs.selectedViewController as? UINavigationController,
              let home = calls.topViewController as? HomeViewController else {
            XCTFail("The first tab must be the Calls home screen")
            return
        }
        home.loadViewIfNeeded()
        XCTAssertEqual(home.view.backgroundColor, .systemBackground)
    }

    func testLoggedInFlagWithoutStoredSessionShowsLogin() {
        SessionStore.shared.clear()
        defer { SessionStore.shared.clear() }
        let sceneDelegate = SceneDelegate()
        sceneDelegate.window = UIWindow(frame: UIScreen.main.bounds)

        sceneDelegate.showRoot(loggedIn: true)

        let navigation = sceneDelegate.window?.rootViewController as? UINavigationController
        XCTAssertTrue(navigation?.topViewController is LoginViewController)
    }
}