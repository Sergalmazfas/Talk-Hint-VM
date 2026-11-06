import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class ChatNavigationTests: XCTestCase {
    private var window: UIWindow?
    private var previousKeyWindow: UIWindow?
    private var suites: [String] = []

    override func tearDown() async throws {
        window?.isHidden = true
        window?.rootViewController = nil
        window = nil
        previousKeyWindow?.makeKey()
        previousKeyWindow = nil
        suites.forEach { UserDefaults.standard.removePersistentDomain(forName: $0) }
        suites = []
        try await super.tearDown()
    }

    private func fixture() throws -> (TalkHintTabBarController, ChatViewController) {
        let suite = "chat-navigation-\(UUID())"
        suites.append(suite)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let api = APIClient(transport: { request in
            let object: [String: Any]
            switch request.url!.path {
            case "/api/chat-v1/capabilities":
                object = ["ai": ["available": false], "voice": ["available": false],
                          "attachments": ["available": false, "mimeTypes": [], "maxBytes": 2097152]]
            case "/api/chat-v1/conversations":
                object = ["conversations": [["id": "c1", "title": "Fixture", "createdAt": "", "updatedAt": ""]]]
            case "/api/chat-v1/conversations/c1/messages":
                object = ["messages": (1...35).map { i in
                    ["id": "m\(i)", "conversationId": "c1", "sequence": i, "role": i % 2 == 0 ? "user" : "assistant",
                     "text": "Offline fixture \(i). This is enough text to exercise a scrollable conversation.",
                     "status": "complete", "attachmentIds": [], "createdAt": ""] as [String: Any]
                }, "hasMore": false]
            default: object = [:] // Settings GET fixtures; never external transport.
            }
            XCTAssertEqual(request.httpMethod, "GET")
            return (try JSONSerialization.data(withJSONObject: object),
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline-fixture-token" })
        let chat = ChatViewController(api: api, ownerId: suite, currentOwnerId: { suite },
                                     draftStore: ChatOutbox(owner: suite, origin: "https://fixture.invalid", defaults: defaults))
        let tabs = TalkHintTabBarController(chatFactory: { chat })
        tabs.viewControllers = (0...4).map { tag in
            let root: UIViewController = tag == 2 ? ChatEntryViewController() : UIViewController()
            let nav = UINavigationController(rootViewController: root)
            nav.tabBarItem = UITabBarItem(title: "Fixture \(tag)", image: nil, tag: tag)
            return nav
        }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 640)
        self.window = window
        window.rootViewController = tabs
        window.makeKeyAndVisible()
        return (tabs, chat)
    }

    private func descendants<T: UIView>(_ view: UIView, as type: T.Type) -> [T] {
        (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, as: type) }
    }
    private func button(_ id: String, in view: UIView) throws -> UIButton {
        try XCTUnwrap(descendants(view, as: UIButton.self).first { $0.accessibilityIdentifier == id })
    }
    private func settle() async throws { try await Task.sleep(nanoseconds: 100_000_000) }

    func testEntryInterceptsWithoutChangingPhoneTab() async throws {
        let (tabs, _) = try fixture()
        let origin = tabs.selectedViewController
        let entry = try XCTUnwrap(tabs.viewControllers?[2])
        XCTAssertFalse(tabs.tabBarController(tabs, shouldSelect: entry))
        XCTAssertTrue(tabs.selectedViewController === origin)
        XCTAssertEqual(tabs.selectedIndex, 0)
        try await Task.sleep(nanoseconds: 500_000_000)
        tabs.closeChat(animated: false)
    }
    func testFullscreenChatIsRetainedAcrossExitAndReopen() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        let destination = try XCTUnwrap(tabs.retainedChatNavigation)
        XCTAssertEqual(destination.modalPresentationStyle, .fullScreen)
        XCTAssertTrue(destination.viewControllers.first === chat)
        XCTAssertNil(chat.tabBarController)
        XCTAssertFalse(destination.view.subviews.contains { $0 is UITabBar })
        tabs.closeChat(animated: false)
        try await settle()
        tabs.openChat(animated: false)
        XCTAssertTrue(tabs.retainedChatNavigation === destination)
        XCTAssertEqual(tabs.selectedIndex, 0)
    }
    func testBackAndDrawerUseDifferentActions() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await settle()
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        XCTAssertTrue(chat.view.subviews.contains { $0.accessibilityIdentifier == "chat-drawer" })
        XCTAssertTrue(tabs.presentedViewController === tabs.retainedChatNavigation)
        try button("chat-back", in: chat.view).sendActions(for: .touchUpInside)
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNil(tabs.presentedViewController)
        XCTAssertEqual(tabs.selectedIndex, 0)
    }
    func testDrawerOpensExistingSettingsAndNativeBackReturns() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await settle()
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        try button("chat-settings", in: chat.view).sendActions(for: .touchUpInside)
        let navigation = try XCTUnwrap(tabs.retainedChatNavigation)
        XCTAssertTrue(navigation.topViewController is SettingsViewController)
        XCTAssertEqual(navigation.viewControllers.count, 2)
        XCTAssertFalse(navigation.isNavigationBarHidden)
        try await Task.sleep(nanoseconds: 500_000_000)
        navigation.popViewController(animated: false)
        XCTAssertTrue(navigation.topViewController === chat)
        XCTAssertTrue(navigation.isNavigationBarHidden)
    }
    func testDraftAndReadingPositionSurviveExitAndReopen() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await settle()
        let composer = try XCTUnwrap(descendants(chat.view, as: UITextView.self).first)
        composer.text = "Do not lose this unfinished text"
        chat.textViewDidChange(composer)
        let scroll = try XCTUnwrap(descendants(chat.view, as: UIScrollView.self).first { $0.accessibilityIdentifier == "chat-messages" })
        chat.view.layoutIfNeeded()
        XCTAssertGreaterThan(scroll.contentSize.height, 1000)
        scroll.setContentOffset(CGPoint(x: 0, y: 250), animated: false)
        tabs.closeChat(animated: false)
        try await settle()
        tabs.openChat(animated: false)
        try await settle()
        XCTAssertEqual(composer.text, "Do not lose this unfinished text")
        XCTAssertEqual(scroll.contentOffset.y, 250, accuracy: 2)
    }
    func testExternalTabSelectionDoesNotDismissCallOverlay() async throws {
        let (tabs, _) = try fixture()
        tabs.openChat(animated: false)
        let destination = try XCTUnwrap(tabs.retainedChatNavigation)
        let phoneOverlay = UIViewController() // no call or phone engine
        phoneOverlay.modalPresentationStyle = .fullScreen
        destination.present(phoneOverlay, animated: false)
        tabs.selectedViewController = tabs.viewControllers?[3]
        XCTAssertTrue(destination.presentedViewController === phoneOverlay)
        XCTAssertTrue(tabs.presentedViewController === destination)
        phoneOverlay.dismiss(animated: false)
        try await settle()
        XCTAssertNil(tabs.presentedViewController)
        XCTAssertEqual(tabs.selectedIndex, 3)
    }
    func testCompactDrawerScrollsAndFutureDestinationsAreDisabled() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await settle()
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        let drawer = try XCTUnwrap(chat.view.subviews.first { $0.accessibilityIdentifier == "chat-drawer" })
        XCTAssertFalse(descendants(drawer, as: UIScrollView.self).isEmpty)
        for id in ["chat.calendar", "chat.tasks", "chat.contacts", "chat.files", "chat.mail", "chat.card"] {
            XCTAssertFalse(try button(id, in: drawer).isEnabled)
        }
    }
}
