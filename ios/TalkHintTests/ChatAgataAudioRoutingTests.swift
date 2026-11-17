import XCTest
import AVFoundation
@preconcurrency import WebRTC
@testable import TalkHint

final class ChatAgataAudioRoutingTests: XCTestCase {
    @MainActor
    func testSpeakerPreferenceSurvivesWebRTCDeviceConfiguration() {
        let old = RTCAudioSessionConfiguration()
        old.categoryOptions = []
        let configured = ChatAgataAudioConfigurationLease.speakerConfiguration(from: old)
        XCTAssertTrue(configured.categoryOptions.contains(.defaultToSpeaker))
        XCTAssertEqual(configured.category, AVAudioSession.Category.playAndRecord.rawValue)
        XCTAssertEqual(configured.mode, AVAudioSession.Mode.voiceChat.rawValue)
        if #available(iOS 26.0, *) { XCTAssertTrue(configured.categoryOptions.contains(.allowBluetoothHFP)) }
        else { XCTAssertTrue(configured.categoryOptions.contains(.allowBluetooth)) }
    }

    @MainActor
    func testSpeakerTemplateIsCopiedWithoutMutatingPreviousOwnerOrTuningAudio() {
        let old = RTCAudioSessionConfiguration()
        old.categoryOptions = [.allowAirPlay]
        old.sampleRate = 44100; old.ioBufferDuration = 0.03
        old.inputNumberOfChannels = 1; old.outputNumberOfChannels = 2
        let configured = ChatAgataAudioConfigurationLease.speakerConfiguration(from: old)
        XCTAssertFalse(configured === old)
        XCTAssertEqual(old.categoryOptions, [.allowAirPlay])
        XCTAssertTrue(configured.categoryOptions.contains(.allowAirPlay))
        XCTAssertEqual(configured.sampleRate, old.sampleRate)
        XCTAssertEqual(configured.ioBufferDuration, old.ioBufferDuration)
        XCTAssertEqual(configured.inputNumberOfChannels, old.inputNumberOfChannels)
        XCTAssertEqual(configured.outputNumberOfChannels, old.outputNumberOfChannels)
    }

    @MainActor
    func testCloseRestoresPreviousTemplateAndIsIdempotent() {
        let old = RTCAudioSessionConfiguration()
        var current = old
        var writes = 0
        let lease = ChatAgataAudioConfigurationLease(read: { current }, write: { current = $0; writes += 1 })
        lease.install(); let installed = current; lease.install()
        XCTAssertEqual(writes, 1)
        XCTAssertFalse(installed === old)
        lease.restore(); lease.restore()
        XCTAssertTrue(current === old)
        XCTAssertEqual(writes, 2)
    }

    @MainActor
    func testLateCloseDoesNotRestoreOverNewerOwnerConfiguration() {
        let old = RTCAudioSessionConfiguration()
        var current = old
        let lease = ChatAgataAudioConfigurationLease(read: { current }, write: { current = $0 })
        lease.install()
        let newer = RTCAudioSessionConfiguration()
        current = newer
        lease.restore()
        XCTAssertTrue(current === newer)
    }

    @MainActor
    func testLeaseCanBeUsedAgainAfterClosedOrFailedStart() {
        let old = RTCAudioSessionConfiguration()
        var current = old
        let lease = ChatAgataAudioConfigurationLease(read: { current }, write: { current = $0 })
        lease.install(); lease.restore(); lease.install()
        XCTAssertTrue(current.categoryOptions.contains(.defaultToSpeaker))
        lease.restore()
        XCTAssertTrue(current === old)
    }

    func testSpeakerAndReceiverAreDistinguishedInDiagnostics() {
        XCTAssertEqual(snapshot(outputs: [.builtInSpeaker]).outputs, "speaker")
        XCTAssertEqual(snapshot(outputs: [.builtInReceiver]).outputs, "receiver")
    }

    func testExternalOutputsStayVisibleWithoutDeviceIdentity() {
        for (port, label) in [(AVAudioSession.Port.bluetoothHFP, "bluetoothHFP"),
                              (.bluetoothA2DP, "bluetoothA2DP"), (.headphones, "headphones"),
                              (.carAudio, "carAudio"), (.usbAudio, "usbAudio")] {
            XCTAssertEqual(snapshot(outputs: [port]).outputs, label)
        }
        XCTAssertEqual(snapshot(outputs: [AVAudioSession.Port(rawValue: "PRIVATE_DEVICE_NAME")]).outputs, "other")
    }

    func testDiagnosticsClampVolumeAndOnlyReportBoundedValues() {
        XCTAssertEqual(snapshot(volume: .nan).volume, 0)
        XCTAssertEqual(snapshot(volume: .infinity).volume, 0)
        XCTAssertEqual(snapshot(volume: 2).volume, 1)
        XCTAssertEqual(snapshot(volume: -1).volume, 0)
        XCTAssertEqual(snapshot(volume: 0.75).volume, 0.75)
        XCTAssertEqual(snapshot(outputs: Array(repeating: .builtInSpeaker, count: 20)).outputs,
                       "speaker,speaker,speaker,speaker")
        XCTAssertTrue(snapshot().defaultToSpeaker)
        XCTAssertFalse(snapshot().phoneOwnsAudio)
    }

    private func snapshot(outputs: [AVAudioSession.Port] = [.builtInSpeaker],
                          volume: Float = 1) -> ChatAgataAudioSnapshot {
        ChatAgataAudioSnapshot(inputs: [.builtInMic], outputs: outputs, category: .playAndRecord,
            mode: .voiceChat, volume: volume, options: [.defaultToSpeaker], phoneOwnsAudio: false)
    }
}
