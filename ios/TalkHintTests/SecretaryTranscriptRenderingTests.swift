import XCTest
import UIKit
@testable import TalkHint

/// These exercise the production rendering methods used by live turns and
/// recovered snapshots. Loading the view does not start its audio or transport;
/// tests deliberately never call viewDidAppear or create a phone task.
@MainActor
final class SecretaryTranscriptRenderingTests: XCTestCase {
    private func makeController() -> SecretaryLiveCallViewController {
        let task = APIClient.SecretaryTask(
            id: "render-fixture", clientRequestId: nil,
            phoneNumber: "+15555550100", instruction: "Rendering fixture only",
            status: "connected", mode: "live", outcome: nil, summary: nil,
            verifiedFacts: [], nextStep: nil, transcript: nil, transcriptTurns: [],
            translationLanguage: "ru", callId: nil, createdAt: nil, updatedAt: nil)
        let controller = SecretaryLiveCallViewController(task: task)
        controller.loadViewIfNeeded()
        controller.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        return controller
    }

    private func descendants(_ view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { descendants($0) }
    }

    private func feed(_ controller: SecretaryLiveCallViewController) throws -> UIStackView {
        try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "feed-secretary-live-transcript"
        } as? UIStackView)
    }

    private func texts(_ controller: SecretaryLiveCallViewController) -> [String] {
        descendants(controller.view).compactMap { ($0 as? UILabel)?.text }
    }

    private func assertAttachedWidthConstraints(_ feed: UIStackView, count: Int,
                                               file: StaticString = #filePath, line: UInt = #line) {
        let constraints = feed.constraints.filter {
            $0.firstAttribute == .width && ($0.secondItem as? UIView) === feed
        }
        XCTAssertEqual(constraints.count, count, file: file, line: line)
        for constraint in constraints {
            guard let bubble = constraint.firstItem as? UIView else {
                XCTFail("Missing bubble", file: file, line: line)
                continue
            }
            XCTAssertTrue(bubble.isDescendant(of: feed), file: file, line: line)
            XCTAssertTrue(constraint.isActive, file: file, line: line)
            XCTAssertEqual(constraint.multiplier, 0.88, accuracy: 0.001, file: file, line: line)
        }
    }

    func testFirstLiveSecretaryAndGuestTurnsHaveAttachedConstraints() throws {
        let controller = makeController()
        controller.upsertTurn(id: "s1", role: "secretary", text: "Hello", translation: nil)
        controller.upsertTurn(id: "g1", role: "guest", text: "Good morning", translation: nil)
        controller.view.layoutIfNeeded()
        let stack = try feed(controller)
        XCTAssertEqual(stack.arrangedSubviews.count, 2)
        assertAttachedWidthConstraints(stack, count: 2)
        XCTAssertTrue(texts(controller).contains("Hello"))
        XCTAssertTrue(texts(controller).contains("Good morning"))
    }

    func testRecoveredSnapshotAndReplayDoNotCrashOrDuplicateTurns() throws {
        let controller = makeController()
        let snapshot: [String: Any] = [
            "status": "connected", "translationLanguage": "ru",
            "transcriptTurns": [
                ["id": "s1", "role": "secretary", "text": "Hello", "translation": "Привет"],
                ["id": "g1", "role": "guest", "text": "How can I help?"],
            ],
        ]
        controller.renderSnapshot(snapshot)
        controller.renderSnapshot(snapshot)
        controller.view.layoutIfNeeded()
        let stack = try feed(controller)
        XCTAssertEqual(stack.arrangedSubviews.count, 2)
        assertAttachedWidthConstraints(stack, count: 2)
        XCTAssertTrue(texts(controller).contains("Hello"))
        XCTAssertFalse(texts(controller).contains("Привет"), "Secretary must show original speech, not legacy translations")
    }

    func testLegacyTranscriptSnapshotRestoresWithoutDuplicates() throws {
        let controller = makeController()
        let snapshot: [String: Any] = [
            "status": "connected", "transcript": "Secretary: Hello\nOther party: Good morning",
        ]
        controller.renderSnapshot(snapshot)
        controller.renderSnapshot(snapshot)
        controller.view.layoutIfNeeded()
        let stack = try feed(controller)
        XCTAssertEqual(stack.arrangedSubviews.count, 2)
        assertAttachedWidthConstraints(stack, count: 2)
    }

    func testLiveUpdateAfterRecoveryReusesTheExistingCard() throws {
        let controller = makeController()
        controller.renderSnapshot([
            "status": "connected",
            "transcriptTurns": [["id": "s1", "role": "secretary", "text": "Hel"]],
        ])
        controller.upsertTurn(id: "s1", role: "secretary", text: "Hello there", translation: "Здравствуйте")
        controller.view.layoutIfNeeded()
        let stack = try feed(controller)
        XCTAssertEqual(stack.arrangedSubviews.count, 1)
        XCTAssertTrue(texts(controller).contains("Hello there"))
        XCTAssertFalse(texts(controller).contains("Hel"))
        XCTAssertTrue(texts(controller).contains("Здравствуйте"))
        assertAttachedWidthConstraints(stack, count: 1)
    }

    func testEmptyTurnsDoNotCreateCards() throws {
        let controller = makeController()
        controller.upsertTurn(id: "empty", role: "secretary", text: " \n", translation: nil)
        controller.renderSnapshot(["status": "connected", "transcript": ""])
        XCTAssertEqual(try feed(controller).arrangedSubviews.count, 0)
    }
}
