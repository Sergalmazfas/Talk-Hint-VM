import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class ChatVoiceScreenTests: XCTestCase {
    private func fixture() -> ChatVoiceViewController {
        let api = APIClient(transport: { _ in
            XCTFail("Loading a voice screen must not request the network")
            throw APIError.decoding
        }, tokenProvider: { "offline-screen-fixture" })
        let conversation = ChatConversation(id: "offline-voice", title: "Offline",
                                            createdAt: "2026-01-01", updatedAt: "2026-01-01")
        return ChatVoiceViewController(api: api, conversation: conversation,
            validOwner: { false },
            submit: { _, _ in
                XCTFail("Loading a voice screen must not submit a message")
                throw APIError.decoding
            }, attachments: { XCTFail("No attachment action during load") })
    }

    private func allViews(_ view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { allViews($0) }
    }

    private func checkHierarchy(_ controller: ChatVoiceViewController,
                                file: StaticString = #filePath, line: UInt = #line) throws {
        let root = try XCTUnwrap(controller.viewIfLoaded, file: file, line: line)
        let host = try XCTUnwrap(controller.children.first, file: file, line: line)
        XCTAssertTrue(host.parent === controller, file: file, line: line)
        XCTAssertTrue(host.view.isDescendant(of: root), file: file, line: line)
        let heightLimit = try XCTUnwrap(root.constraints.first {
            ($0.firstItem as? UIView) === host.view
                && ($0.secondItem as? UIView) === root
                && $0.firstAttribute == .height && $0.secondAttribute == .height
                && $0.relation == .lessThanOrEqual
        }, file: file, line: line)
        XCTAssertTrue(heightLimit.isActive, file: file, line: line)
        XCTAssertEqual(heightLimit.multiplier, 0.32, accuracy: 0.0001, file: file, line: line)
        let mic = try XCTUnwrap(allViews(root).compactMap { $0 as? UIButton }.first {
            $0.accessibilityIdentifier == "chat-voice-microphone"
        }, file: file, line: line)
        XCTAssertFalse(mic.isEnabled, file: file, line: line)
    }

    func testFullScreenLoadsWithoutNetworkOrMicrophone() async throws {
        let controller = fixture()
        // The regression threw NSGenericException here before any appearance/audio.
        controller.loadViewIfNeeded()
        await Task.yield()
        XCTAssertEqual(controller.modalPresentationStyle, .fullScreen)
        try checkHierarchy(controller)
    }

    func testFullScreenLaysOutOnSmallAndLargeScreensInBothThemes() throws {
        for size in [CGSize(width: 320, height: 568), CGSize(width: 402, height: 874)] {
            for style in [UIUserInterfaceStyle.light, .dark] {
                let controller = fixture()
                controller.overrideUserInterfaceStyle = style
                controller.loadViewIfNeeded()
                controller.view.frame = CGRect(origin: .zero, size: size)
                controller.view.setNeedsLayout()
                controller.view.layoutIfNeeded()
                try checkHierarchy(controller)
            }
        }
    }
}
