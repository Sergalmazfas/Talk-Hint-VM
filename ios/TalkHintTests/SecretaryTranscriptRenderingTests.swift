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
        XCTAssertFalse(texts(controller).contains("Здравствуйте"), "Live updates must not restore legacy translations in Secretary")
        assertAttachedWidthConstraints(stack, count: 1)
    }

    func testEmptyTurnsDoNotCreateCards() throws {
        let controller = makeController()
        controller.upsertTurn(id: "empty", role: "secretary", text: " \n", translation: nil)
        controller.renderSnapshot(["status": "connected", "transcript": ""])
        XCTAssertEqual(try feed(controller).arrangedSubviews.count, 0)
    }

    func testUnavailableTwilioSourceDoesNotOfferRecreationOrDisableEnd() throws {
        let controller = makeController()
        controller.applyMonitoring([
            "transport": "twilio-both-tracks",
            "sourceConnected": false,
            "sourceReconnectSupported": false,
            "guestReceived": false,
            "secretaryReceived": false,
        ])
        let source = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-source-status"
        } as? UILabel)
        let end = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "button-secretary-live-end"
        } as? UIButton)
        XCTAssertFalse(source.isHidden)
        XCTAssertEqual(source.text, NSLocalizedString("secretary.live.source.unavailable", comment: ""))
        XCTAssertTrue(end.isEnabled)
    }

    func testSourceTrackReceiptIsNotPresentedAsAudibleProof() throws {
        let controller = makeController()
        controller.applyMonitoring([
            "transport": "twilio-both-tracks",
            "sourceConnected": true,
            "sourceReconnectSupported": false,
            "guestReceived": true,
            "secretaryReceived": true,
        ])
        let source = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-source-status"
        } as? UILabel)
        let expected = String(
            format: NSLocalizedString("secretary.live.source.connected", comment: ""),
            "twilio-both-tracks",
            NSLocalizedString("secretary.live.source.received", comment: ""),
            NSLocalizedString("secretary.live.source.received", comment: ""))
        XCTAssertEqual(source.text, expected)
    }

    func testLegacyServerWithoutMonitoringCapabilityKeepsExistingFeedBehavior() {
        let controller = makeController()
        XCTAssertTrue(descendants(controller.view).contains {
            $0.accessibilityIdentifier == "text-secretary-source-status" &&
                $0.isHidden
        })
    }

    func testReappearingFeedDiscoversSourceThatStartedWhileMonitorWasHidden() throws {
        let controller = makeController()
        var feedSubscriptions = 0
        var playbackStarts = 0
        controller.onFeedSubscriptionRequested = { feedSubscriptions += 1 }
        controller.audioPlaybackConfigurationForTesting = {
            playbackStarts += 1
            return true
        }

        controller.applyMonitoring([
            "transport": "twilio-both-tracks",
            "sourceConnected": false,
            "sourceReconnectSupported": false,
            "guestReceived": false,
            "secretaryReceived": false,
        ])
        controller.viewDidAppear(false)
        XCTAssertEqual(feedSubscriptions, 1, "An absent source must not block the read-only feed")
        XCTAssertEqual(playbackStarts, 0, "Do not start local playback until source connection is reported")

        controller.viewWillDisappear(false)
        controller.applyMonitoring([
            "transport": "twilio-both-tracks",
            "sourceConnected": true,
            "sourceReconnectSupported": false,
            "guestReceived": true,
            "secretaryReceived": true,
        ])
        XCTAssertEqual(playbackStarts, 0, "Hidden updates must not activate audio")

        controller.viewDidAppear(false)
        XCTAssertEqual(feedSubscriptions, 2, "Visibility re-entry must refresh the read-only feed")
        XCTAssertEqual(playbackStarts, 1, "An existing source discovered on re-entry may start local playback")
        let end = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "button-secretary-live-end"
        } as? UIButton)
        XCTAssertTrue(end.isEnabled)
        controller.viewWillDisappear(false)
    }
}
