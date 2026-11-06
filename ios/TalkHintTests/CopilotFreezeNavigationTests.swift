import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class CopilotFreezeNavigationTests: XCTestCase {
    func testFiveVisibleTabsPreserveStableIdentifiersAndNoCopilot() throws {
        let tabs = SceneDelegate().makeMainTabController()
        let controllers = try XCTUnwrap(tabs.viewControllers)
        XCTAssertEqual(controllers.count, 5)
        XCTAssertEqual(controllers.map { $0.tabBarItem.tag }, [0, 1, 2, 3, 4])
        XCTAssertTrue((controllers[2] as? UINavigationController)?.viewControllers.first is ChatViewController)
        XCTAssertEqual(tabs.selectedIndex, 2)
        XCTAssertFalse(CallManager.copilotAvailable)
        for controller in controllers {
            let navigation = try XCTUnwrap(controller as? UINavigationController)
            XCTAssertFalse(navigation.viewControllers.contains { $0 is CopilotViewController })
        }
    }

    func testSecretaryAndHistoryCanBeSelectedByIdentityAfterRemoval() throws {
        let tabs = SceneDelegate().makeMainTabController()
        let controllers = try XCTUnwrap(tabs.viewControllers)
        let secretary = try XCTUnwrap(controllers.first { $0.tabBarItem.tag == 3 } as? UINavigationController)
        let history = try XCTUnwrap(controllers.first { $0.tabBarItem.tag == 4 } as? UINavigationController)
        tabs.selectedViewController = secretary
        XCTAssertEqual(tabs.selectedIndex, 3)
        XCTAssertTrue(secretary.viewControllers.first is HomeViewController)
        tabs.selectedViewController = history
        XCTAssertEqual(tabs.selectedIndex, 4)
        XCTAssertTrue(history.viewControllers.first is CallHistoryViewController)
    }
}
