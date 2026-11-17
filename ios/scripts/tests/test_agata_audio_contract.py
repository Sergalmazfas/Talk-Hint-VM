"""Source contracts, NOT Swift compilation, XCTest, audibility or real routing."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
CHAT = ROOT / "ios/TalkHint/Chat"


class AgataAudioSourceTests(unittest.TestCase):
    def setUp(self):
        self.peer = (CHAT / "ChatAgataPeer.swift").read_text()
        self.audio = (CHAT / "ChatAgataAudioRouting.swift").read_text()

    def test_configures_webRTC_template_not_only_live_session(self):
        self.assertIn("RTCAudioSessionConfiguration.setWebRTC($0)", self.audio)
        self.assertIn("source.categoryOptions.union(.defaultToSpeaker)", self.audio)
        self.assertLess(self.peer.index("audioRouting.start()"), self.peer.index("factory = RTCPeerConnectionFactory()"))

    def test_only_agata_owns_the_template_and_phone_guard_remains(self):
        self.assertLess(self.peer.index("!CallManager.shared.hasPhoneAudioSession"), self.peer.index("audioRouting.start()"))
        self.assertIn("read() === installed", self.audio)
        self.assertIn("write(previous)", self.audio)
        self.assertIn("guard installed == nil", self.audio)

    def test_preserves_bluetooth_and_does_not_force_or_amplify_outputs(self):
        self.assertIn(".allowBluetoothHFP", self.audio)
        self.assertIn(".allowBluetooth", self.audio)
        for forbidden in ["try audio.setActive", "try? audio.setActive", "overrideOutputAudioPort(",
                          "setPreferredInput(", "setInputGain(", "track.volume", "setVolume("]:
            self.assertNotIn(forbidden, self.peer + self.audio)
        self.assertIn('"googEchoCancellation": "true"', self.peer)

    def test_template_restore_occurs_after_local_media_close(self):
        close = self.peer.split("func close()")[1]
        self.assertLess(close.index("connection?.close()"), close.index("audioRouting.stop()"))
        self.assertLess(close.index("factory = nil"), close.index("audioRouting.stop()"))
        failure = self.peer.split("} catch {")[1].split("// Category")[0]
        self.assertIn("audioRouting.stop()", failure)

    def test_observers_are_bounded_and_removed_without_audio_mutation(self):
        self.assertIn("AVAudioSession.routeChangeNotification", self.audio)
        self.assertIn("NotificationCenter.default.removeObserver(observer)", self.audio)
        self.assertIn("guard let self, self.running", self.audio)
        self.assertIn("nextSample = now + 5", self.audio)
        callback = self.audio.split("Task { @MainActor [weak self] in")[1].split("func sample(")[0]
        self.assertNotIn("lease.install()", callback)
        self.assertNotIn("setCategory", callback)

    def test_diagnostics_log_only_bounded_technical_values(self):
        log = self.audio.split("Self.logger.info(")[1].split("\n")[0]
        for forbidden in ["portName", "uid", "localizedDescription", "token", "text", "sdp", "snapshot)"]:
            self.assertNotIn(forbidden, log)
        for field in ["outputs=", "volume=", "defaultSpeaker=", "receivedRMS=", "phoneOwnsAudio="]:
            self.assertIn(field, log)
        self.assertIn('category: "AgataAudio"', self.audio)
        self.assertIn('default: return "other"', self.audio)


if __name__ == "__main__":
    unittest.main()
