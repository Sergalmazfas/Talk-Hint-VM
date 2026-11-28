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

    private func fixture(growFirstMessageOnRefresh: Bool = false, conversationTitle: String = "Fixture") throws -> (TalkHintTabBarController, ChatViewController) {
        let suite = "chat-navigation-\(UUID())"
        suites.append(suite)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        var messageReads = 0
        let api = APIClient(transport: { request in
            let object: [String: Any]
            switch request.url!.path {
            case "/api/chat-v1/capabilities":
                object = ["ai": ["available": false], "voice": ["available": false],
                          "attachments": ["available": false, "mimeTypes": [], "maxBytes": 2097152]]
            case "/api/chat-v1/conversations":
                object = ["conversations": [["id": "c1", "title": conversationTitle, "createdAt": "", "updatedAt": ""]]]
            case "/api/chat-v1/conversations/c1/messages":
                messageReads += 1
                object = ["messages": (1...35).map { i in
                    ["id": "m\(i)", "conversationId": "c1", "sequence": i, "role": i % 2 == 0 ? "user" : "assistant",
                     "text": growFirstMessageOnRefresh && messageReads > 1 && i == 1
                        ? String(repeating: "Offline growth above the reader. ", count: 60)
                        : "Offline fixture \(i). This is enough text to exercise a scrollable conversation.",
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
        ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { descendants($0, as: type) }
    }
    private func button(_ id: String, in view: UIView) throws -> UIButton {
        try XCTUnwrap(descendants(view, as: UIButton.self).first { $0.accessibilityIdentifier == id })
    }
    // Wait for the real UIKit event instead of a fixed pause: on a cold simulator the first
    // full-screen presentation can take well over a second. Upper bound only.
    private func waitUntil(_ what: String, timeout: TimeInterval = 4,
                           _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            guard Date() < deadline else { XCTFail("Timed out waiting for \(what)"); throw URLError(.timedOut) }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }
    private func chatShown(_ tabs: TalkHintTabBarController) async throws {
        try await waitUntil("chat presentation to finish") {
            guard let navigation = tabs.retainedChatNavigation else { return false }
            return tabs.presentedViewController === navigation && !navigation.isBeingPresented &&
                navigation.transitionCoordinator == nil &&
                navigation.viewControllers.first?.viewIfLoaded?.window != nil
        }
    }
    private func chatHidden(_ tabs: TalkHintTabBarController) async throws {
        try await waitUntil("chat dismissal to finish") {
            tabs.presentedViewController == nil && tabs.transitionCoordinator == nil &&
                tabs.retainedChatNavigation?.isBeingDismissed != true
        }
    }

    func testEntryInterceptsWithoutChangingPhoneTab() async throws {
        let (tabs, _) = try fixture()
        let origin = tabs.selectedViewController
        let entry = try XCTUnwrap(tabs.viewControllers?[2])
        XCTAssertFalse(tabs.tabBarController(tabs, shouldSelect: entry))
        XCTAssertTrue(tabs.selectedViewController === origin)
        XCTAssertEqual(tabs.selectedIndex, 0)
        try await chatShown(tabs)
        tabs.closeChat(animated: false)
    }
    func testFullscreenChatIsRetainedAcrossExitAndReopen() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        let destination = try XCTUnwrap(tabs.retainedChatNavigation)
        XCTAssertEqual(destination.modalPresentationStyle, .fullScreen)
        XCTAssertTrue(destination.viewControllers.first === chat)
        XCTAssertNil(chat.tabBarController)
        XCTAssertFalse(destination.view.subviews.contains { $0 is UITabBar })
        tabs.closeChat(animated: false)
        try await chatHidden(tabs)
        tabs.openChat(animated: false)
        XCTAssertTrue(tabs.retainedChatNavigation === destination)
        XCTAssertEqual(tabs.selectedIndex, 0)
    }
    func testBackAndDrawerUseDifferentActions() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        XCTAssertTrue(chat.view.subviews.contains { $0.accessibilityIdentifier == "chat-drawer" })
        XCTAssertTrue(tabs.presentedViewController === tabs.retainedChatNavigation)
        try button("chat-back", in: chat.view).sendActions(for: .touchUpInside)
        try await chatHidden(tabs)
        XCTAssertNil(tabs.presentedViewController)
        XCTAssertEqual(tabs.selectedIndex, 0)
    }
    func testDrawerOpensExistingSettingsAndNativeBackReturns() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        try button("chat-settings", in: chat.view).sendActions(for: .touchUpInside)
        let navigation = try XCTUnwrap(tabs.retainedChatNavigation)
        XCTAssertTrue(navigation.topViewController is SettingsViewController)
        XCTAssertEqual(navigation.viewControllers.count, 2)
        let settings = try XCTUnwrap(navigation.topViewController)
        // The animated push has no transition coordinator until UIKit starts it, so wait
        // until the chat leaves the window; a pop issued mid-push is deferred by UIKit.
        try await waitUntil("Settings push to finish") { chat.viewIfLoaded?.window == nil && navigation.transitionCoordinator == nil }
        XCTAssertFalse(navigation.isNavigationBarHidden)
        navigation.popViewController(animated: false)
        XCTAssertTrue(navigation.topViewController === chat)
        try await waitUntil("pop back to chat to finish") { settings.viewIfLoaded?.window == nil && chat.viewIfLoaded?.window != nil && navigation.transitionCoordinator == nil }
        XCTAssertTrue(navigation.isNavigationBarHidden)
    }
    func testDraftAndReadingPositionSurviveExitAndReopen() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        let composer = try XCTUnwrap(descendants(chat.view, as: UITextView.self).first {
            $0.accessibilityIdentifier == "chat-composer"
        })
        let scroll = try XCTUnwrap(descendants(chat.view, as: UIScrollView.self).first { $0.accessibilityIdentifier == "chat-messages" })
        // The transcript arrives through the async offline load started on appearance.
        try await waitUntil("offline transcript to render") {
            chat.view.layoutIfNeeded()
            return scroll.contentSize.height > 1000
        }
        XCTAssertGreaterThan(scroll.contentSize.height, 1000)
        composer.text = "Do not lose this unfinished text"
        chat.textViewDidChange(composer)
        for _ in 0..<8 {
            chat.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        let oldMessage = try XCTUnwrap(descendants(chat.view, as: ChatMessageTextView.self).first)
        scroll.setContentOffset(CGPoint(x: 0, y: 250), animated: false)
        XCTAssertEqual(scroll.contentOffset.y, 250, accuracy: 2)
        tabs.closeChat(animated: false)
        try await chatHidden(tabs)
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        try await waitUntil("reopened transcript refresh and self-sizing layout") {
            chat.view.layoutIfNeeded()
            let textViews = self.descendants(chat.view, as: ChatMessageTextView.self)
            return !textViews.isEmpty && !textViews.contains(where: { $0 === oldMessage })
        }
        // Let width-dependent intrinsic-size invalidation finish; do not widen
        // the tolerance or assert only before the delayed +13 pt reflow.
        for _ in 0..<8 {
            descendants(chat.view, as: ChatMessageTextView.self).forEach { $0.setNeedsLayout() }
            chat.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertEqual(composer.text, "Do not lose this unfinished text")
        XCTAssertEqual(scroll.contentOffset.y, 250, accuracy: 2)
        // Subsequent ordinary layouts must not keep moving the reading position.
        for _ in 0..<4 {
            chat.view.setNeedsLayout()
            chat.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 1_000_000)
            XCTAssertEqual(scroll.contentOffset.y, 250, accuracy: 2)
        }
    }
    func testReadingAnchorSurvivesGrowthDuringReopen() async throws {
        let (tabs, chat) = try fixture(growFirstMessageOnRefresh: true)
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        let scroll = try XCTUnwrap(descendants(chat.view, as: UIScrollView.self).first {
            $0.accessibilityIdentifier == "chat-messages"
        })
        try await waitUntil("initial transcript layout") {
            chat.view.layoutIfNeeded()
            return scroll.contentSize.height > 1000 && !chat.offlineReadingRestorePending
        }
        let firstRow = try XCTUnwrap(descendants(chat.view, as: UIStackView.self).first {
            $0.accessibilityIdentifier == "chat-message-row-m1"
        })
        let oldHeight = firstRow.bounds.height
        chat.scrollViewWillBeginDragging(scroll)
        scroll.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let anchor = try XCTUnwrap(descendants(chat.view, as: UIStackView.self).first {
            $0.accessibilityIdentifier?.hasPrefix("chat-message-row-") == true &&
                $0.convert(.zero, to: scroll).y + $0.bounds.height > scroll.contentOffset.y
        })
        let id = anchor.accessibilityIdentifier
        let offset = anchor.convert(.zero, to: scroll).y - scroll.contentOffset.y
        tabs.closeChat(animated: false)
        try await chatHidden(tabs)
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        try await waitUntil("grown refresh and message-relative restore") {
            chat.view.layoutIfNeeded()
            let row = self.descendants(chat.view, as: UIStackView.self).first {
                $0.accessibilityIdentifier == "chat-message-row-m1"
            }
            return (row?.bounds.height ?? 0) > oldHeight + 200 && !chat.offlineReadingRestorePending
        }
        for _ in 0..<4 {
            chat.view.setNeedsLayout()
            chat.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 1_000_000)
            let restored = try XCTUnwrap(descendants(chat.view, as: UIStackView.self).first {
                $0.accessibilityIdentifier == id
            })
            XCTAssertEqual(restored.convert(.zero, to: scroll).y - scroll.contentOffset.y,
                           offset, accuracy: 2)
        }
    }
    func testExternalTabSelectionDoesNotDismissCallOverlay() async throws {
        let (tabs, _) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        let destination = try XCTUnwrap(tabs.retainedChatNavigation)
        let phoneOverlay = UIViewController() // no call or phone engine
        phoneOverlay.modalPresentationStyle = .fullScreen
        destination.present(phoneOverlay, animated: false)
        tabs.selectedViewController = tabs.viewControllers?[3]
        XCTAssertTrue(destination.presentedViewController === phoneOverlay)
        XCTAssertTrue(tabs.presentedViewController === destination)
        phoneOverlay.dismiss(animated: false)
        try await chatHidden(tabs)
        XCTAssertNil(tabs.presentedViewController)
        XCTAssertEqual(tabs.selectedIndex, 3)
    }
    func testCompactDrawerScrollsAndFutureDestinationsAreDisabled() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        let drawer = try XCTUnwrap(chat.view.subviews.first { $0.accessibilityIdentifier == "chat-drawer" })
        chat.view.layoutIfNeeded()
        let settings = try button("chat-settings", in: drawer)
        let settingsFrame = settings.convert(settings.bounds, to: chat.view)
        XCTAssertGreaterThanOrEqual(settings.bounds.height, 44)
        XCTAssertLessThanOrEqual(settingsFrame.maxY, chat.view.safeAreaLayoutGuide.layoutFrame.maxY)
        let panel = try XCTUnwrap(descendants(drawer, as: UIView.self).first { $0.accessibilityIdentifier == "chat-drawer-panel" })
        XCTAssertLessThanOrEqual(panel.bounds.width, chat.view.bounds.width * 0.88 + 1)
        XCTAssertTrue(drawer.accessibilityViewIsModal)
        XCTAssertFalse(descendants(drawer, as: UIScrollView.self).isEmpty)
        for id in ["chat.calendar", "chat.tasks", "chat.contacts", "chat.files", "chat.mail", "chat.card"] {
            XCTAssertFalse(try button(id, in: drawer).isEnabled)
        }
    }
    private func openChat(_ tabs: TalkHintTabBarController) async throws {
        tabs.openChat(animated: false)
        try await chatShown(tabs)
    }

    private func loaded(_ chat: ChatViewController) async throws {
        try await waitUntil("offline conversation messages") {
            self.descendants(chat.view, as: UITextView.self).contains {
                $0.accessibilityIdentifier == "chat-message-text"
            }
        }
    }

    func testDrawerSeparatesUnavailableGroupAndRecentChats() async throws {
        let (tabs, chat) = try fixture(conversationTitle: "Write a message… прикк век но")
        try await openChat(tabs)
        try await loaded(chat)
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        chat.view.layoutIfNeeded()
        let groups = descendants(chat.view, as: UIStackView.self)
        let unavailable = try XCTUnwrap(groups.first { $0.accessibilityIdentifier == "chat-unavailable-group" })
        let recent = try XCTUnwrap(groups.first { $0.accessibilityIdentifier == "chat-recent-group" })
        XCTAssertEqual(unavailable.arrangedSubviews.first?.accessibilityIdentifier, "chat-unavailable-note")
        for id in ["chat.calendar", "chat.tasks", "chat.card", "chat.tariff", "chat.help", "chat.about"] {
            let row = try button(id, in: unavailable)
            XCTAssertFalse(row.isEnabled)
            XCTAssertTrue(row.superview === unavailable)
            XCTAssertFalse(row.isDescendant(of: recent))
        }
        let title = try XCTUnwrap(descendants(recent, as: UIButton.self).first)
        XCTAssertEqual(title.configuration?.title, "прикк век но")
        XCTAssertTrue(unavailable.superview === recent.superview)
        let parent = try XCTUnwrap(unavailable.superview as? UIStackView)
        XCTAssertLessThan(try XCTUnwrap(parent.arrangedSubviews.firstIndex(of: unavailable)),
                          try XCTUnwrap(parent.arrangedSubviews.firstIndex(of: recent)))
    }

    func testComposerPlaceholderIsNotEditableTextOrDraft() {
        let composer = ChatComposerTextView()
        composer.placeholder = NSLocalizedString("chat.message.placeholder", comment: "")
        XCTAssertEqual(composer.text, "")
        composer.text = "прикк век но"
        XCTAssertEqual(composer.text, "прикк век но")
        composer.text = ""
        composer.refreshPlaceholder()
        XCTAssertEqual(composer.text, "")
        // Deliberately typing the hint is real user input, not an empty draft.
        composer.text = composer.placeholder
        XCTAssertEqual(composer.text, composer.placeholder)
    }

    func testOldConversationTitlesLoseOnlyLeadingHint() {
        for hint in ["Write a message…", "Напишите сообщение…", "Escribe un mensaje…",
                     "Хабарлама жазыңыз…", "Напишіть повідомлення…"] {
            XCTAssertEqual(ChatConversationTitle.display(hint + "  Диспетчер Том"), "Диспетчер Том")
            XCTAssertEqual(ChatConversationTitle.display(hint), NSLocalizedString("chat.new", comment: ""))
        }
        XCTAssertEqual(ChatConversationTitle.display("Текст Write a message… внутри"), "Текст Write a message… внутри")
        XCTAssertEqual(ChatConversationTitle.display("  Диспетчер Том  "), "Диспетчер Том")
    }

    func testSettingsFullWidthLabelsAndLightDarkSnapshots() async throws {
        let (tabs, chat) = try fixture()
        try await openChat(tabs)
        try await loaded(chat)
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        for style in [UIUserInterfaceStyle.light, .dark] {
            window?.overrideUserInterfaceStyle = style
            try await Task.sleep(nanoseconds: 100_000_000)
            snapshot("Menu-grouping-\(style.rawValue)")
        }
        try button("chat-settings", in: chat.view).sendActions(for: .touchUpInside)
        let navigation = try XCTUnwrap(tabs.retainedChatNavigation)
        let settings = try XCTUnwrap(navigation.topViewController as? SettingsViewController)
        try await waitUntil("Settings push to finish") {
            chat.viewIfLoaded?.window == nil && navigation.transitionCoordinator == nil
        }
        for style in [UIUserInterfaceStyle.light, .dark] {
            window?.overrideUserInterfaceStyle = style
            settings.tableView.scrollToRow(at: IndexPath(row: 1, section: 2), at: .middle, animated: false)
            settings.tableView.layoutIfNeeded()
            for row in 0...2 {
                let cell = settings.tableView(settings.tableView, cellForRowAt: IndexPath(row: row, section: 2))
                cell.frame = CGRect(x: 0, y: 0, width: 288, height: 140)
                cell.layoutIfNeeded()
                let label = try XCTUnwrap(descendants(cell, as: UILabel.self).first { $0.text?.isEmpty == false })
                let control = try XCTUnwrap(descendants(cell, as: UISegmentedControl.self).first)
                XCTAssertEqual(label.numberOfLines, 0)
                XCTAssertEqual(label.lineBreakMode, .byWordWrapping)
                XCTAssertLessThanOrEqual(label.convert(label.bounds, to: cell).maxY,
                                         control.convert(control.bounds, to: cell).minY)
                XCTAssertEqual(control.accessibilityLabel, label.text)
            }
            try await Task.sleep(nanoseconds: 100_000_000)
            snapshot("Settings-full-labels-\(style.rawValue)", screenUpdates: true)
        }
    }

    private func snapshot(_ name: String, screenUpdates: Bool = false) {
        guard let window else { return XCTFail("No fixture window") }
        window.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { context in
            // The pushed Settings table renders blank through layer.render; draw the
            // committed on-screen hierarchy for it. Menu keeps the model-layer render.
            if screenUpdates {
                _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            } else {
                window.layer.render(in: context.cgContext)
            }
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testPhoneScreensDoNotDuplicateSettingsOrChatMenu() {
        let api = APIClient(transport: { _ in
            XCTFail("Loading the phone header must not start network work")
            throw APIError.decoding
        }, tokenProvider: { nil })
        for home in [HomeViewController(api: api), HomeViewController(mode: .translator, api: api),
                     HomeViewController(secretary: true, api: api)] {
            home.loadViewIfNeeded()
            let ids = descendants(home.view, as: UIButton.self).compactMap(\.accessibilityIdentifier)
            XCTAssertFalse(ids.contains("button-open-settings"))
            XCTAssertFalse(ids.contains("chat-menu"))
        }
    }
    func testDrawerDismissKeepsDraftAndSameChat() async throws {
        let (tabs, chat) = try fixture()
        tabs.openChat(animated: false)
        try await chatShown(tabs)
        let composer = try XCTUnwrap(descendants(chat.view, as: UITextView.self).first {
            $0.accessibilityIdentifier == "chat-composer"
        })
        composer.text = "Unsent offline draft"
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        try button("chat-drawer-dismiss", in: chat.view).sendActions(for: .touchUpInside)
        XCTAssertEqual(composer.text, "Unsent offline draft")
        XCTAssertTrue(tabs.retainedChatNavigation?.topViewController === chat)
        XCTAssertFalse(chat.view.subviews.contains { $0.accessibilityIdentifier == "chat-drawer" })
        try button("chat-menu", in: chat.view).sendActions(for: .touchUpInside)
        try button("chat-drawer-close", in: chat.view).sendActions(for: .touchUpInside)
        XCTAssertFalse(chat.view.subviews.contains { $0.accessibilityIdentifier == "chat-drawer" })
    }
}
