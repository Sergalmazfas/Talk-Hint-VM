import XCTest
import AVFoundation
@testable import TalkHint

@MainActor
final class ChatVoiceCaptureHealthTests: XCTestCase {
    func testConfigurationChangeAllowsExactlyOneRecovery() {
        var health = ChatVoiceCaptureHealth()
        XCTAssertEqual(health.configurationChanged(allowed: true, recording: true, playing: false), .recover)
        health.awaitInput(at: 1)
        health.receivedBuffer(at: 1.1)
        XCTAssertEqual(health.check(at: 1.2, running: true, allowed: true, recording: true, playing: false), .none)
        XCTAssertEqual(health.configurationChanged(allowed: true, recording: true, playing: false), .fail)
        XCTAssertEqual(health.recoveries, 1)
    }

    func testStoppedEngineRecoversButFailedRestartFails() {
        var health = ChatVoiceCaptureHealth()
        health.awaitInput(at: 10)
        XCTAssertEqual(health.check(at: 10.17, running: false, allowed: true, recording: true, playing: false), .recover)
        XCTAssertEqual(health.check(at: 10.6, running: false, allowed: true, recording: true, playing: false), .fail)
    }

    func testNoBuffersTimesOutWithoutAnySampleCallback() {
        var health = ChatVoiceCaptureHealth()
        health.awaitInput(at: 10)
        XCTAssertEqual(health.check(at: 11.9, running: true, allowed: true, recording: true, playing: false), .none)
        XCTAssertEqual(health.check(at: 12, running: true, allowed: true, recording: true, playing: false), .fail)
    }

    func testBuffersKeepWatchdogAliveAndStallFails() {
        var health = ChatVoiceCaptureHealth()
        health.awaitInput(at: 10)
        health.receivedBuffer(at: 11.5)
        XCTAssertEqual(health.check(at: 12, running: true, allowed: true, recording: true, playing: false), .none)
        XCTAssertEqual(health.check(at: 13.5, running: true, allowed: true, recording: true, playing: false), .fail)
    }

    func testRevokedAccessPlaybackOrNoRecordingNeverRestarts() {
        for input in [(false, true, false), (true, true, true), (true, false, false)] {
            var health = ChatVoiceCaptureHealth()
            XCTAssertEqual(health.configurationChanged(allowed: input.0, recording: input.1, playing: input.2), .fail)
            XCTAssertEqual(health.recoveries, 0)
        }
    }

    func testIdleBetweenUtterancesDoesNotHaveInputTimeout() {
        var health = ChatVoiceCaptureHealth()
        health.awaitInput(at: 1)
        XCTAssertEqual(health.check(at: 60, running: true, allowed: true, recording: false, playing: false), .none)
    }

    func testOwnEngineNotificationRestartsAndForeignEngineIsIgnored() async throws {
        let fixture = CaptureSupervisorFixture()
        fixture.start()
        defer { fixture.supervisor.stop() }
        fixture.center.post(name: .AVAudioEngineConfigurationChange, object: NSObject())
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.restarts, 0)
        fixture.notify()
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.restarts, 1)
        XCTAssertEqual(fixture.failures, 0)
        fixture.notify()
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.restarts, 1)
        XCTAssertEqual(fixture.failures, 1)
    }

    func testRestartErrorTerminatesAndDoesNotLoop() async throws {
        let fixture = CaptureSupervisorFixture()
        fixture.restartThrows = true
        fixture.start()
        defer { fixture.supervisor.stop() }
        fixture.notify()
        try await Task.sleep(nanoseconds: 20_000_000)
        fixture.notify(); fixture.supervisor.check()
        XCTAssertEqual(fixture.restarts, 1)
        XCTAssertEqual(fixture.failures, 1)
    }

    func testClosingCancelsQueuedRecoveryAndRemovesObserver() async throws {
        let fixture = CaptureSupervisorFixture()
        fixture.start()
        fixture.notify()
        fixture.supervisor.stop()
        fixture.notify()
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.restarts, 0)
        XCTAssertEqual(fixture.failures, 0)
    }

    func testWatchdogFailsWithoutAnyNotificationOrAudioCallback() {
        let fixture = CaptureSupervisorFixture()
        fixture.start()
        defer { fixture.supervisor.stop() }
        fixture.clock += 2
        fixture.supervisor.check()
        XCTAssertEqual(fixture.failures, 1)
        XCTAssertEqual(fixture.restarts, 0)
    }

    func testRouteHandoverDuringPlaybackFailsWithoutReplayingOutput() {
        let fixture = CaptureSupervisorFixture()
        fixture.playing = true
        fixture.start()
        defer { fixture.supervisor.stop() }
        fixture.supervisor.configurationChanged()
        XCTAssertEqual(fixture.failures, 1)
        XCTAssertEqual(fixture.restarts, 0)
    }

    func testLostOwnershipDuringRecoveryNeverRestartsInput() async throws {
        let fixture = CaptureSupervisorFixture()
        fixture.start()
        defer { fixture.supervisor.stop() }
        fixture.supervisor.configurationChanged()
        fixture.allowed = false
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.restarts, 0)
        XCTAssertEqual(fixture.failures, 1)
    }
}

/// Real notification delivery + real supervisor, fake operations only.
/// No AVAudioEngine, AVAudioSession, microphone, providers or APIClient.
@MainActor
private final class CaptureSupervisorFixture {
    let center = NotificationCenter()
    let engine = NSObject()
    var allowed = true
    var playing = false
    var running = true
    var clock = 10.0
    var restarts = 0
    var failures = 0
    var restartThrows = false
    lazy var supervisor = ChatVoiceCaptureSupervisor(center: center, object: engine,
        name: .AVAudioEngineConfigurationChange,
        allowed: { [unowned self] in self.allowed }, recording: { true },
        playing: { [unowned self] in self.playing }, running: { [unowned self] in self.running },
        restart: { [unowned self] in
            self.restarts += 1
            if self.restartThrows { throw NSError(domain: "offline-restart", code: 1) }
            self.running = true
            self.supervisor.awaitInput()
        }, failed: { [unowned self] in self.failures += 1 },
        now: { [unowned self] in self.clock }, settleNanoseconds: 0)

    func start() { supervisor.start(automaticWatchdog: false); supervisor.awaitInput() }
    func notify() { center.post(name: .AVAudioEngineConfigurationChange, object: engine) }
}
