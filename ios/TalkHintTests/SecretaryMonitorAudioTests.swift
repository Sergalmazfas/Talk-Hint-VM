import XCTest
import AVFoundation
@testable import TalkHint

final class SecretaryMonitorAudioTests: XCTestCase {
    func testTranscriptConnectionDoesNotClaimAudioIsPlaying() {
        var state = SecretaryMonitorState()
        state.connect()
        XCTAssertEqual(state.statusKey, "secretary.live.transcript_only")
        XCTAssertFalse(state.received)
        XCTAssertFalse(state.played)
    }

    func testAudioRequiresPacketsThenPlaybackEvidence() {
        var state = SecretaryMonitorState()
        state.renderAudio()
        XCTAssertFalse(state.played)
        state.receiveAudio()
        XCTAssertEqual(state.statusKey, "secretary.live.audio_receiving")
        state.renderAudio()
        XCTAssertEqual(state.statusKey, "secretary.live.audio_playing")
    }

    func testReconnectCannotReuseOldPlaybackEvidence() {
        var state = SecretaryMonitorState()
        state.connect()
        state.receiveAudio()
        state.renderAudio()
        state.reset()
        XCTAssertEqual(state.statusKey, "secretary.live.connecting")
        XCTAssertFalse(state.received)
        XCTAssertFalse(state.played)
    }

    func testPartyNodesUseDifferentMixerInputsWithoutStartingAudio() {
        let audio = SecretaryAudioPlayer()
        let nodes = audio.engine.attachedNodes.compactMap { $0 as? AVAudioPlayerNode }
        XCTAssertEqual(nodes.count, 2)
        let inputs = nodes.flatMap { audio.engine.outputConnectionPoints(for: $0, outputBus: 0) }
        XCTAssertEqual(inputs.count, 2)
        XCTAssertTrue(inputs.allSatisfy { $0.node === audio.engine.mainMixerNode })
        XCTAssertEqual(Set(inputs.map { $0.bus }).count, 2, "Both parties must mix, not overwrite/serialize")
        XCTAssertFalse(audio.isReady, "Graph inspection must not activate audio or capture a microphone")
    }

    func testMuLawDecodeSilenceAndBothPolarities() {
        XCTAssertEqual(SecretaryAudioPlayer.decodeMuLaw(0xff), 0)
        XCTAssertEqual(SecretaryAudioPlayer.decodeMuLaw(0x7f), 0)
        XCTAssertEqual(SecretaryAudioPlayer.decodeMuLaw(0x00), -32124)
        XCTAssertEqual(SecretaryAudioPlayer.decodeMuLaw(0x80), 32124)
        for byte in UInt8(0)...UInt8(127) {
            XCTAssertEqual(Int(SecretaryAudioPlayer.decodeMuLaw(byte)),
                           -Int(SecretaryAudioPlayer.decodeMuLaw(byte | 0x80)))
        }
    }

    func testRecoveryIsThrottledAndStopsAfterThreeAttempts() {
        var recovery = SecretaryMonitorRecovery()
        recovery.recordFailure("engine_start:NSOSStatusErrorDomain:-50")
        XCTAssertTrue(recovery.requestAttempt(now: 100))
        XCTAssertFalse(recovery.requestAttempt(now: 100.02), "Audio frames must not cause a restart storm")
        XCTAssertFalse(recovery.requestAttempt(now: 101.99))
        XCTAssertTrue(recovery.requestAttempt(now: 102))
        XCTAssertTrue(recovery.requestAttempt(now: 104))
        XCTAssertFalse(recovery.requestAttempt(now: 106))
        XCTAssertFalse(recovery.requestAttempt(now: 10_000), "Time alone must not reset the retry budget")
        XCTAssertEqual(recovery.attempts, 3)
        XCTAssertEqual(recovery.failure, "engine_start:NSOSStatusErrorDomain:-50")
    }

    func testOnlyPlaybackEvidenceResetsAutomaticRecoveryBudget() {
        var recovery = SecretaryMonitorRecovery()
        recovery.recordFailure("playback_stalled")
        XCTAssertTrue(recovery.requestAttempt(now: 10))
        XCTAssertTrue(recovery.requestAttempt(now: 12))
        XCTAssertTrue(recovery.requestAttempt(now: 14))
        // Configuring an engine and receiving frames do not call rendered().
        XCTAssertFalse(recovery.requestAttempt(now: 16))
        recovery.rendered()
        XCTAssertNil(recovery.failure)
        XCTAssertEqual(recovery.attempts, 0)
        XCTAssertTrue(recovery.requestAttempt(now: 16))
    }

    func testOwnerRetryDoesNotClaimFailureWasRepaired() {
        var recovery = SecretaryMonitorRecovery()
        recovery.recordFailure("session_activation:NSOSStatusErrorDomain:561017449")
        XCTAssertTrue(recovery.requestAttempt(now: 10))
        recovery.retryByOwner()
        XCTAssertEqual(recovery.attempts, 0)
        XCTAssertNotNil(recovery.failure, "Keep the failure until actual playback")
        XCTAssertTrue(recovery.requestAttempt(now: 10.1))
    }

    func testDiagnosticErrorCodeDoesNotExposeDescriptionsOrUnknownDomains() {
        let error = NSError(domain: "private URL or credential", code: -50,
                            userInfo: [NSLocalizedDescriptionKey: "secret transcript"])
        XCTAssertEqual(SecretaryAudioPlayer.safeErrorCode(error), "Other:-50")
        let osError = NSError(domain: "NSOSStatusErrorDomain", code: -10868)
        XCTAssertEqual(SecretaryAudioPlayer.safeErrorCode(osError), "NSOSStatusErrorDomain:-10868")
    }

    /// Real AVAudioEngine + session path, not the controller's fake operations.
    /// Synthetic local tones only. This never connects a call or opens an input.
    @MainActor
    func testRealEngineRendersBothSyntheticTracksWithoutNetworkOrMicrophone() async throws {
        guard !CallManager.shared.hasPhoneAudioSession else {
            XCTFail("Isolated fixture must not interrupt a telephone audio session")
            return
        }
        let session = AVAudioSession.sharedInstance()
        let player = SecretaryAudioPlayer()
        defer {
            player.stop()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
        }
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth])
        try session.setActive(true)
        try session.overrideOutputAudioPort(.speaker)
        XCTAssertTrue(player.start(), player.lastFailure ?? "Engine did not start")
        guard player.isReady else {
            XCTFail("Engine and both nodes must be running")
            return
        }
        let played = expectation(description: "Both synthetic buffers actually rendered")
        played.expectedFulfillmentCount = 2
        player.onPlayed = { played.fulfill() }
        for (role, period) in [("guest", 8), ("secretary", 10)] {
            let data = Data((0..<1_600).map { index in
                (index / period) % 2 == 0 ? UInt8(0xb0) : UInt8(0x30)
            })
            XCTAssertTrue(player.enqueue(muLaw: data, role: role))
        }
        await fulfillment(of: [played], timeout: 5)
        // Callback evidence is not a claim a person heard the simulator/device.
    }
}
