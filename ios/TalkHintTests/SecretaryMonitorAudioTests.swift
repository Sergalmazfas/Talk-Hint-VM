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
}
