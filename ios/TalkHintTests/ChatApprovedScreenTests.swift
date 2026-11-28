import XCTest
import UIKit
@testable import TalkHint

#if DEBUG
@MainActor
final class ChatApprovedScreenTests: XCTestCase {
    private var window: UIWindow?
    private var previousKeyWindow: UIWindow?

    override func tearDown() async throws {
        window?.isHidden = true
        window?.rootViewController = nil
        window = nil
        previousKeyWindow?.makeKey()
        previousKeyWindow = nil
        try await super.tearDown()
    }

    private func fixture(_ state: ChatApprovedPreview.State = .dialogue,
                         width: CGFloat = 390, dark: Bool = false,
                         readAloudUnavailableReason: String? = nil) throws -> ChatViewController {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        let chat = ChatApprovedPreview.make(state: state, readAloudUnavailableReason: readAloudUnavailableReason)
        let nav = ChatNavigationController(chat: chat)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = nav
        self.window = window
        window.makeKeyAndVisible()
        return chat
    }
    private func all<T: UIView>(_ root: UIView, _ type: T.Type) -> [T] {
        ((root as? T).map { [$0] } ?? []) + root.subviews.flatMap { all($0, type) }
    }
    private func control(_ id: String, _ chat: ChatViewController) throws -> UIButton {
        try XCTUnwrap(all(chat.view, UIButton.self).first { $0.accessibilityIdentifier == id })
    }
    private func loaded(_ chat: ChatViewController) async throws {
        let deadline = Date().addingTimeInterval(3)
        // Check again after every wake-up: the fixture renders on the main actor, so a
        // stalled main thread can finish it while this loop sleeps past the deadline.
        while true {
            if chat.offlinePreviewReady,
               all(chat.view, UITextView.self).contains(where: { $0.accessibilityIdentifier == "chat-message-text" }) {
                chat.view.layoutIfNeeded()
                return
            }
            guard Date() < deadline else { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Local fixture did not render before deadline")
    }
    func testComposerFullWidthAndControlsBelowAt320() async throws {
        let chat = try fixture(width: 320)
        try await loaded(chat)
        let composer = try XCTUnwrap(all(chat.view, UITextView.self).first {
            $0.accessibilityIdentifier == "chat-composer"
        })
        let mic = try control("chat-dictation", chat)
        XCTAssertGreaterThan(composer.bounds.width, 250)
        XCTAssertGreaterThanOrEqual(mic.convert(.zero, to: chat.view).y,
                                    composer.convert(.zero, to: chat.view).y + composer.bounds.height - 1)
        let toolbar = try XCTUnwrap(composer.inputAccessoryView as? UIToolbar)
        XCTAssertNil(toolbar.items?.last?.title) // Not a giant text Done control.
        snapshot("chat-689-composer-320")
    }
    private func usabilityMessage(_ id: String, _ sequence: Int, text: String, status: String = "generating") -> ChatMessage {
        ChatMessage(id: id, conversationId: "usability", sequence: sequence, role: "assistant",
            text: text, status: status, clientRequestId: nil, attachmentIds: [], createdAt: "", errorCode: nil)
    }
    func testStreamingWidthIsStableAndProgressIsNotDuplicated() async throws {
        let chat = try fixture()
        try await loaded(chat)
        let conv = ChatConversation(id: "usability", title: "Offline", createdAt: "", updatedAt: "")
        chat.applyOfflineMemoryFixture(conversation: conv, messages: [usabilityMessage("r", 1, text: "Да")])
        chat.view.layoutIfNeeded()
        let first = try XCTUnwrap(all(chat.view, UITextView.self).first {
            $0.accessibilityIdentifier == "chat-message-text"
        })
        let width = first.bounds.width
        XCTAssertGreaterThan(width, 280)
        XCTAssertEqual(all(chat.view, UILabel.self).filter {
            $0.accessibilityIdentifier == "chat-reply-progress-r"
        }.count, 1)
        snapshot("chat-689-stream-short")
        chat.applyOfflineMemoryFixture(conversation: conv, messages: [
            usabilityMessage("r", 1, text: String(repeating: "Уточни время. ", count: 20))
        ])
        chat.view.layoutIfNeeded()
        let second = try XCTUnwrap(all(chat.view, UITextView.self).first {
            $0.accessibilityIdentifier == "chat-message-text"
        })
        XCTAssertEqual(second.bounds.width, width, accuracy: 1)
        snapshot("chat-689-stream-long")
    }
    func testEmptyFailedReplyHasNoEmptyBubble() async throws {
        let chat = try fixture()
        try await loaded(chat)
        chat.applyOfflineMemoryFixture(conversation: .init(id: "usability", title: "Offline", createdAt: "", updatedAt: ""),
            messages: [usabilityMessage("failed", 1, text: "", status: "failed")])
        chat.view.layoutIfNeeded()
        XCTAssertFalse(all(chat.view, UIStackView.self).contains {
            $0.accessibilityIdentifier == "chat-message-row-failed"
        })
        let error = try XCTUnwrap(all(chat.view, UILabel.self).first {
            $0.text == NSLocalizedString("chat.reply.incomplete", comment: "")
        })
        XCTAssertEqual(error.numberOfLines, 0)
        snapshot("chat-689-interrupted")
    }
    func testPlanStartsCompactAndReplacementDisablesOldCard() async throws {
        let chat = try fixture()
        try await loaded(chat)
        let plan = ChatCallPlan(goal: "Узнать про кейс.", ownerFacts: ["Не оплачивать"],
            sayAsk: ["Is the AirPods case there?", "When do you open?"], expectedQuestions: [],
            unknowns: ["Часы"], disclosurePolicy: .init(allowed: [], forbidden: ["Не платить"]),
            language: "en", executor: "secretary", targetPhone: "+14055550123", voicemail: "skip")
        var old = usabilityMessage("old-plan", 1, text: "Готово.", status: "complete")
        old.action = .init(plan: plan, planHash: String(repeating: "a", count: 64), status: "proposed")
        let conv = ChatConversation(id: "usability", title: "Offline", createdAt: "", updatedAt: "")
        chat.applyOfflineMemoryFixture(conversation: conv, messages: [old])
        chat.view.layoutIfNeeded()
        let hiddenDetails = all(chat.view, UILabel.self).filter { $0.text?.contains("When do you open?") == true }
        XCTAssertEqual(hiddenDetails.count, 1)
        XCTAssertTrue(hiddenDetails.allSatisfy(\.isHidden))
        let oldButton = try control("chat-plan-action-old-plan", chat)
        snapshot("chat-689-card-compact")
        try control("chat-plan-details-old-plan", chat).sendActions(for: .touchUpInside)
        chat.view.layoutIfNeeded()
        XCTAssertFalse(try XCTUnwrap(all(chat.view, UILabel.self).first { $0.text?.contains("When do you open?") == true }).isHidden)
        snapshot("chat-689-card-expanded")
        var replacement = usabilityMessage("new-plan", 3, text: "Исправлено.", status: "complete")
        replacement.action = .init(plan: plan, planHash: String(repeating: "b", count: 64), status: "proposed")
        let yes = ChatMessage(id: "yes", conversationId: "usability", sequence: 4, role: "user", text: "да",
            status: "complete", clientRequestId: nil, attachmentIds: [], createdAt: "", errorCode: nil)
        chat.applyOfflineMemoryFixture(conversation: conv, messages: [old, replacement, yes])
        XCTAssertFalse(all(chat.view, UIButton.self).contains { $0.accessibilityIdentifier == "chat-plan-action-old-plan" })
        XCTAssertTrue(all(chat.view, UILabel.self).contains { $0.accessibilityIdentifier == "chat-plan-superseded-old-plan" })
        XCTAssertTrue(try control("chat-plan-action-new-plan", chat).isEnabled)
        oldButton.sendActions(for: .touchUpInside) // A retained, detached button cannot launch either.
        XCTAssertNil(chat.presentedViewController) // A "yes" did not open review/start.
        snapshot("chat-689-card-replaced")
    }
    private func readingLayoutSettled(_ chat: ChatViewController) async throws {
        let deadline = Date().addingTimeInterval(3)
        while true {
            chat.view.layoutIfNeeded()
            if !chat.offlineReadingRestorePending { return }
            guard Date() < deadline else {
                XCTFail("Reading restore did not finish; do not accept an unverified anchor")
                throw NSError(domain: "OfflineChatReadingRestoreTimeout", code: 1)
            }
            // Task.yield does not guarantee that DispatchQueue.main's UIKit
            // restoration callbacks ran. Yield to the actual run loop instead.
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }
    func testReadingAnchorSurvivesGrowthAboveIt() async throws {
        let chat = try fixture(width: 320)
        try await loaded(chat)
        let conv = ChatConversation(id: "usability", title: "Offline", createdAt: "", updatedAt: "")
        var list = (1...25).map { usabilityMessage("r\($0)", $0, text: "Строка \($0). Сохранить позицию чтения.", status: "complete") }
        chat.applyOfflineMemoryFixture(conversation: conv, messages: list)
        try await readingLayoutSettled(chat)
        let scroll = try XCTUnwrap(all(chat.view, UIScrollView.self).first { $0.accessibilityIdentifier == "chat-messages" })
        chat.scrollViewWillBeginDragging(scroll) // User takes over from initial bottom-follow.
        scroll.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let rows = all(chat.view, UIStackView.self).filter { $0.accessibilityIdentifier?.hasPrefix("chat-message-row-") == true }
        let anchor = try XCTUnwrap(rows.first {
            $0.convert(.zero, to: scroll).y + $0.bounds.height > scroll.contentOffset.y
        })
        let id = anchor.accessibilityIdentifier
        let offset = anchor.convert(.zero, to: scroll).y - scroll.contentOffset.y
        for count in [30, 60] {
            list[0].text = String(repeating: "Добавленный текст выше. ", count: count)
            chat.applyOfflineMemoryFixture(conversation: conv, messages: list)
            try await readingLayoutSettled(chat)
            let restored = try XCTUnwrap(all(chat.view, UIStackView.self).first { $0.accessibilityIdentifier == id })
            XCTAssertEqual(restored.convert(.zero, to: scroll).y - scroll.contentOffset.y, offset, accuracy: 2)
            XCTAssertFalse(try control("chat-new-messages", chat).isHidden)
        }
        try control("chat-new-messages", chat).sendActions(for: .touchUpInside)
        XCTAssertTrue(try control("chat-new-messages", chat).isHidden)
        snapshot("chat-689-reading-anchor")
    }

    private func snapshot(_ name: String) {
        guard let window else { return XCTFail("Missing native fixture window") }
        window.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let image = UIGraphicsImageRenderer(size: window.bounds.size, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testApprovedTypographyIsOptInAndReadable() {
        XCTAssertEqual(ChatScreenAppearance.approvedReference.messageFont,
                       UIFont.preferredFont(forTextStyle: .body))
        XCTAssertEqual(ChatScreenAppearance.existing.messageFont, UIFont.preferredFont(forTextStyle: .body))
        XCTAssertEqual(ChatScreenAppearance.approvedReference.orbSize, 48)
    }
    func testUnavailableReadAloudKeepsDisabledButtonAndVisibleReason() async throws {
        let chat = try fixture(readAloudUnavailableReason: "READ_ALOUD_DISABLED")
        try await loaded(chat)
        let play = try control("chat-read-aloud", chat)
        XCTAssertFalse(play.isEnabled)
        let reason = try XCTUnwrap(all(chat.view, UILabel.self).first {
            $0.accessibilityIdentifier == "chat-read-aloud-unavailable"
        })
        XCTAssertEqual(reason.text, NSLocalizedString("chat.read.unavailable.disabled", comment: ""))
        XCTAssertFalse(reason.isHidden)
    }
    func testFullscreenHasLeadingMenuAndExitWithoutTabs() async throws {
        let chat = try fixture()
        try await loaded(chat)
        XCTAssertNil(chat.tabBarController)
        XCTAssertTrue(all(chat.view, UITabBar.self).isEmpty)
        let title = try XCTUnwrap(all(chat.view, UILabel.self).first {
            $0.text == NSLocalizedString("chat.screen.title", comment: "")
        })
        XCTAssertNotNil(title.window)
        XCTAssertFalse(try control("chat-back", chat).allTargets.isEmpty)
        let menu = try control("chat-menu", chat)
        let exit = try control("chat-back", chat)
        XCTAssertTrue(menu.isEnabled)
        XCTAssertFalse(menu.allTargets.isEmpty)
        XCTAssertTrue(menu is ChatMenuButton)
        XCTAssertLessThan(menu.convert(menu.bounds, to: chat.view).midX,
                          exit.convert(exit.bounds, to: chat.view).midX)
        XCTAssertFalse(all(chat.view, UIView.self).contains { $0.accessibilityIdentifier == "chat-drawer" })
        menu.sendActions(for: .touchUpInside)
        chat.view.layoutIfNeeded()
        XCTAssertTrue(all(chat.view, UIView.self).contains { $0.accessibilityIdentifier == "chat-drawer" })
        XCTAssertTrue(try control("chat-settings", chat).isEnabled)
        try control("chat-drawer-dismiss", chat).sendActions(for: .touchUpInside)
        XCTAssertFalse(all(chat.view, UIView.self).contains { $0.accessibilityIdentifier == "chat-drawer" })
    }
    func testSeparateOrbAndLargeControlsFitSmallScreen() async throws {
        let chat = try fixture(width: 320)
        try await loaded(chat)
        for id in ["chat-back", "chat-menu", "chat-attachment", "chat-dictation", "chat-orb-unavailable"] {
            let button = try control(id, chat)
            XCTAssertGreaterThanOrEqual(button.bounds.width, 44, id)
            XCTAssertGreaterThanOrEqual(button.bounds.height, 44, id)
            let frame = button.convert(button.bounds, to: chat.view)
            XCTAssertGreaterThanOrEqual(frame.minX, 0, id)
            XCTAssertLessThanOrEqual(frame.maxX, chat.view.bounds.width + 1, id)
        }
        let orb = try control("chat-orb-unavailable", chat)
        XCTAssertFalse(orb.isEnabled)
        XCTAssertTrue(orb.allTargets.isEmpty)
        let mic = try control("chat-dictation", chat)
        XCTAssertGreaterThan(orb.convert(orb.bounds, to: chat.view).minX,
                             mic.convert(mic.bounds, to: chat.view).maxX)
    }
    func testNativeLightAndDarkScreenshots() async throws {
        let chat = try fixture()
        try await loaded(chat)
        XCTAssertEqual(all(chat.view, UITextView.self).filter { $0.accessibilityIdentifier == "chat-message-text" }.count, 5)
        for text in all(chat.view, UITextView.self) where text.accessibilityIdentifier == "chat-message-text" {
            XCTAssertTrue(text.isSelectable)
            XCTAssertFalse(text.isEditable)
            XCTAssertFalse(text.isScrollEnabled)
        }
        let copies = all(chat.view, UIButton.self).filter { $0.accessibilityIdentifier == "chat-copy-message" }
        XCTAssertFalse(copies.isEmpty)
        XCTAssertTrue(copies.allSatisfy { $0.bounds.height >= 44 })
        snapshot("Chat-approved-light-native")
        window?.overrideUserInterfaceStyle = .dark
        try await Task.sleep(nanoseconds: 100_000_000)
        snapshot("Chat-approved-dark-native")
        try control("chat-menu", chat).sendActions(for: .touchUpInside)
        chat.view.layoutIfNeeded()
        snapshot("Chat-menu-dark-native")
        window?.overrideUserInterfaceStyle = .light
        try await Task.sleep(nanoseconds: 100_000_000)
        snapshot("Chat-menu-light-native")
    }
    func testRecordingAndRecognitionUseExistingBarWithoutAudio() async throws {
        let chat = try fixture(.recording)
        try await loaded(chat)
        let bar = try XCTUnwrap(all(chat.view, ChatDictationBar.self).first)
        XCTAssertFalse(bar.isHidden)
        snapshot("Chat-approved-recording-state-native-fixture")
        let cancel = try XCTUnwrap(all(bar, UIButton.self).first {
            $0.accessibilityLabel == NSLocalizedString("chat.dictation.cancel", comment: "")
        })
        cancel.sendActions(for: .touchUpInside)
        XCTAssertTrue(bar.isHidden)
        chat.applyOfflinePreviewState(.recognizing)
        XCTAssertFalse(bar.isHidden)
        snapshot("Chat-approved-recognizing-state-native-fixture")
    }
    func testKeyboardEditingScreenshotAndDraftRemainEditable() async throws {
        let chat = try fixture(.editing)
        try await loaded(chat)
        let editor = try XCTUnwrap(all(chat.view, UITextView.self).first {
            $0.accessibilityIdentifier == "chat-composer"
        })
        XCTAssertTrue(editor.isEditable)
        XCTAssertFalse(editor.text.isEmpty)
        XCTAssertTrue(editor.isFirstResponder)
        try await Task.sleep(nanoseconds: 400_000_000)
        let frame = editor.convert(editor.bounds, to: chat.view)
        XCTAssertLessThanOrEqual(frame.maxY, chat.view.keyboardLayoutGuide.layoutFrame.minY)
        // UIView rendering is not a screenshot of the separate system keyboard.
        // The Simulator's Cmd-S screenshot is required for a full keyboard view.
        snapshot("Chat-approved-editing-layout-native")
    }
}
#endif
