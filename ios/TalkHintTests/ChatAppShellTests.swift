import XCTest
import UIKit
@testable import TalkHint

/// No window, network, microphone or phone session is started by these tests.
@MainActor
final class ChatAppShellTests: XCTestCase {
    func testFullAppUsesChatInTheExistingFiveTabShell() throws {
        let scene = SceneDelegate()
        let tabs = scene.makeMainTabController(chatFactory: { UIViewController() })
        XCTAssertTrue(tabs is TalkHintTabBarController)
        let roots = try XCTUnwrap(tabs.viewControllers).map {
            ($0 as? UINavigationController)?.viewControllers.first
        }
        XCTAssertEqual(roots.count, 5)
        XCTAssertTrue(roots[0] is HomeViewController)
        XCTAssertTrue(roots[1] is HomeViewController)
        XCTAssertTrue(roots[2] is ChatEntryViewController)
        XCTAssertTrue(roots[3] is HomeViewController)
        XCTAssertTrue(roots[4] is CallHistoryViewController)
        XCTAssertEqual(roots[2]?.tabBarItem.title, NSLocalizedString("tab.chat", comment: ""))
        XCTAssertEqual(tabs.selectedIndex, 0)
    }

    func testBuildingShellDoesNotStartChatRequests() throws {
        var created = 0
        let tabs = SceneDelegate().makeMainTabController(chatFactory: {
            created += 1
            return UIViewController()
        })
        XCTAssertEqual(created, 0)
        let shell = try XCTUnwrap(tabs as? TalkHintTabBarController)
        XCTAssertNil(shell.retainedChatNavigation)
        XCTAssertEqual(shell.selectedIndex, 0)
    }
}
