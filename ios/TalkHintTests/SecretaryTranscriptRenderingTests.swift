import XCTest
import UIKit
import AVFoundation
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
        XCTAssertEqual(source.textColor, .systemOrange)
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

    func testFeedResetKeepsLocalAudioFailureAndDiagnosticVisible() throws {
        let controller = makeController()
        controller.reportAudioFailure("engine_start:NSOSStatusErrorDomain:-10868")
        controller.resetFeedObservation()
        let status = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-live-status"
        } as? UILabel)
        let diagnostic = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-audio-diagnostic"
        } as? UILabel)
        XCTAssertEqual(status.text, NSLocalizedString("secretary.live.audio_failed", comment: ""))
        XCTAssertEqual(status.textColor, .systemRed)
        XCTAssertFalse(diagnostic.isHidden)
        XCTAssertTrue(diagnostic.text?.contains("engine_start:NSOSStatusErrorDomain:-10868") == true)
        XCTAssertFalse(diagnostic.text?.contains("+15555550100") == true)
        XCTAssertFalse(diagnostic.text?.contains("Rendering fixture") == true)
    }

    func testSourceLossDoesNotEraseLocalFailureOrDisableHangup() throws {
        let controller = makeController()
        controller.reportAudioFailure("buffer_allocation")
        controller.applyMonitoring([
            "transport": "twilio-both-tracks", "sourceConnected": false,
            "sourceReconnectSupported": false,
        ])
        controller.renderSnapshot([
            "status": "connected",
            "transcriptTurns": [["id": "g1", "role": "guest", "text": "Still here"]],
        ])
        controller.resetFeedObservation()
        let diagnostic = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-audio-diagnostic"
        } as? UILabel)
        let end = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "button-secretary-live-end"
        } as? UIButton)
        XCTAssertTrue(diagnostic.text?.contains("buffer_allocation") == true)
        XCTAssertTrue(end.isEnabled)
        XCTAssertTrue(texts(controller).contains("Still here"))
    }

    func testPacketsAndFeedResetCannotClearFailureBeforePlayback() throws {
        let controller = makeController()
        controller.audioPlaybackConfigurationForTesting = { true }
        controller.audioPlaybackIsReadyForTesting = { true }
        controller.audioEnqueueForTesting = { _, _ in true }
        controller.feedConnectionForTesting = {}
        controller.viewDidAppear(false)
        defer { controller.viewWillDisappear(false) }
        controller.reportAudioFailure("playback_stalled")
        let status = try XCTUnwrap(descendants(controller.view).first {
            $0.accessibilityIdentifier == "text-secretary-live-status"
        } as? UILabel)
        let frame: [String: Any] = [
            "type": "audio", "role": "guest",
            "payload": Data(repeating: 0xff, count: 160).base64EncodedString(),
        ]
        controller.receive(frame)
        XCTAssertEqual(status.text, NSLocalizedString("secretary.live.audio_failed", comment: ""))
        controller.resetFeedObservation()
        controller.recordAudioPlayback()
        XCTAssertEqual(status.text, NSLocalizedString("secretary.live.audio_failed", comment: ""),
                       "An old playback callback after feed reset is not current playback evidence")
        // Failure must remain: no current frame was received after reset.
        XCTAssertEqual(status.textColor, .systemRed)
        controller.receive(frame)
        controller.recordAudioPlayback()
        XCTAssertEqual(status.text, NSLocalizedString("secretary.live.audio_playing", comment: ""))
    }

    func testBadPacketsNeverEnqueueAndHiddenScreenCannotRecoverOrRender() throws {
        let controller = makeController()
        var starts = 0
        var enqueued = 0
        controller.audioPlaybackConfigurationForTesting = { starts += 1; return true }
        controller.audioPlaybackIsReadyForTesting = { true }
        controller.audioEnqueueForTesting = { _, _ in enqueued += 1; return true }
        controller.feedConnectionForTesting = {}
        controller.viewDidAppear(false)
        let initialStarts = starts
        for role in ["guest", "owner", "secretary"] {
            controller.receive(["type": "audio", "role": role, "payload": "not base64!"])
        }
        XCTAssertEqual(enqueued, 0)
        XCTAssertEqual(starts, initialStarts, "Malformed frames must not trigger restart loops")
        controller.viewWillDisappear(false)
        controller.receive(["type": "audio", "role": "guest",
                            "payload": Data(repeating: 0xff, count: 160).base64EncodedString()])
        controller.recordAudioPlayback()
        XCTAssertEqual(enqueued, 0)
        XCTAssertEqual(starts, initialStarts)
    }

    func testNotReadyPlayerRetriesLocallyWithoutAnotherFeedSubscription() {
        let controller = makeController()
        var starts = 0
        var subscriptions = 0
        controller.audioPlaybackConfigurationForTesting = { [weak controller] in
            starts += 1
            controller?.reportAudioFailure("engine_start:NSOSStatusErrorDomain:-50")
            return false
        }
        controller.audioPlaybackIsReadyForTesting = { false }
        controller.feedConnectionForTesting = { subscriptions += 1 }
        controller.viewDidAppear(false)
        defer { controller.viewWillDisappear(false) }
        let initialStarts = starts
        let frame: [String: Any] = [
            "type": "audio", "role": "guest",
            "payload": Data(repeating: 0xff, count: 160).base64EncodedString(),
        ]
        controller.receive(frame)
        XCTAssertEqual(starts, initialStarts + 1)
        controller.receive(frame)
        XCTAssertEqual(starts, initialStarts + 1, "A second frame cannot immediately restart again")
        XCTAssertEqual(subscriptions, 1, "Player recovery never restarts the network feed or call")
    }

    func testInterruptionWithoutResumePermissionCannotRestartOnPackets() {
        let controller = makeController()
        var starts = 0
        var enqueued = 0
        controller.audioPlaybackConfigurationForTesting = { starts += 1; return true }
        controller.audioPlaybackIsReadyForTesting = { true }
        controller.audioEnqueueForTesting = { _, _ in enqueued += 1; return true }
        controller.feedConnectionForTesting = {}
        controller.viewDidAppear(false)
        defer { controller.viewWillDisappear(false) }
        let initialStarts = starts
        let center = NotificationCenter.default
        center.post(name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        center.post(name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                               AVAudioSessionInterruptionOptionKey: UInt(0)])
        controller.receive(["type": "audio", "role": "guest",
                            "payload": Data(repeating: 0xff, count: 160).base64EncodedString()])
        controller.recordAudioPlayback()
        XCTAssertEqual(enqueued, 0)
        XCTAssertEqual(starts, initialStarts)
        XCTAssertTrue(texts(controller).contains {
            $0.contains("interruption_resume_denied")
        })
    }
}
