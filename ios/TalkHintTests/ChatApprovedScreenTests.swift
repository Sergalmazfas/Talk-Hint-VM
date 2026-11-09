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
                         width: CGFloat = 390, dark: Bool = false) throws -> ChatViewController {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        let chat = ChatApprovedPreview.make(state: state)
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
               all(chat.view, UILabel.self).contains(where: { $0.accessibilityIdentifier == "chat-message-text" }) {
                chat.view.layoutIfNeeded()
                return
            }
            guard Date() < deadline else { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Local fixture did not render before deadline")
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
        XCTAssertEqual(ChatScreenAppearance.approvedReference.messageFont.pointSize,
                       UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 20)).pointSize)
        XCTAssertEqual(ChatScreenAppearance.existing.messageFont, UIFont.preferredFont(forTextStyle: .body))
        XCTAssertEqual(ChatScreenAppearance.approvedReference.orbSize, 48)
    }
    func testFullscreenHasBackButNoDrawerOrTabs() async throws {
        let chat = try fixture()
        try await loaded(chat)
        XCTAssertNil(chat.tabBarController)
        XCTAssertTrue(all(chat.view, UITabBar.self).isEmpty)
        let title = try XCTUnwrap(all(chat.view, UILabel.self).first {
            $0.text == NSLocalizedString("chat.screen.title", comment: "")
        })
        XCTAssertNotNil(title.window)
        XCTAssertFalse(try control("chat-back", chat).allTargets.isEmpty)
        XCTAssertFalse(try control("chat-more-unavailable", chat).isEnabled)
        XCTAssertTrue(try control("chat-more-unavailable", chat).allTargets.isEmpty)
        XCTAssertFalse(all(chat.view, UIView.self).contains { $0.accessibilityIdentifier == "chat-drawer" })
    }
    func testSeparateOrbAndLargeControlsFitSmallScreen() async throws {
        let chat = try fixture(width: 320)
        try await loaded(chat)
        for id in ["chat-back", "chat-more-unavailable", "chat-attachment", "chat-dictation", "chat-orb-unavailable"] {
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
        XCTAssertEqual(all(chat.view, UILabel.self).filter { $0.accessibilityIdentifier == "chat-message-text" }.count, 5)
        snapshot("Chat-approved-light-native")
        window?.overrideUserInterfaceStyle = .dark
        try await Task.sleep(nanoseconds: 100_000_000)
        snapshot("Chat-approved-dark-native")
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
        let editor = try XCTUnwrap(all(chat.view, UITextView.self).first)
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
