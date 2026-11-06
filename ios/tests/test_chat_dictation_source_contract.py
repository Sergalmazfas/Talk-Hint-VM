"""Static source-contract checks only; NOT Swift compilation or iPhone execution."""
import plistlib
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "ios/TalkHint/Chat"


class DictationSourceContracts(unittest.TestCase):
    def setUp(self):
        self.controller = (CHAT / "ChatViewController.swift").read_text()
        self.state = (CHAT / "ChatDictationState.swift").read_text()
        self.bar = (CHAT / "ChatDictationBar.swift").read_text()

    def test_microphone_permission_and_call_audio_gate_remain(self):
        self.assertIn("requestRecordPermission", self.controller)
        self.assertGreaterEqual(self.controller.count("CallManager.shared.hasPhoneAudioSession"), 4)

    def test_waveform_is_metered_not_synthetic(self):
        self.assertIn("isMeteringEnabled = true", self.controller)
        self.assertIn("recorder.updateMeters()", self.controller)
        self.assertIn("averagePower(forChannel: 0)", self.controller)
        self.assertIn("dictationBar.update(level:", self.controller)
        self.assertNotIn("random", self.bar.lower())

    def test_transcription_does_not_send(self):
        block = self.controller.split("private func transcribeDictation()", 1)[1].split("private func cancelDictation()", 1)[0]
        self.assertNotIn("sendChatMessage", block)
        self.assertNotIn("self.send(", block)
        self.assertIn("composer.becomeFirstResponder()", block)

    def test_cancellation_includes_transport_and_audio_cleanup(self):
        block = self.controller.split("private func cancelDictation()", 1)[1].split("private func updateDictationUI()", 1)[0]
        for text in ("recognitionTask?.cancel()", "meterTimer?.invalidate()", "recorder?.stop()", "removeItem", "pendingDictationAudio = nil", "dictation.cancel()"):
            self.assertIn(text, block)
        self.assertIn("Task.checkCancellation()", self.controller)

    def test_context_guard_has_all_three_dimensions(self):
        for field in ("ownerId", "conversationId", "draftRevision"):
            self.assertIn("let " + field, self.state)
        self.assertIn("capture?.context == context", self.state)

    def test_single_flight_and_retry_are_explicit(self):
        self.assertIn("guard phase == .recording || phase == .failed", self.state)
        self.assertIn("phase == .recognizing && attemptId == id", self.state)
        self.assertIn("guard phase == .idle", self.state)

    def test_orb_cannot_launch_and_is_separate(self):
        self.assertIn("orbButton.isEnabled = false", self.controller)
        self.assertNotRegex(self.controller, r"orbButton\.(?:addTarget|addAction)")
        self.assertIn('iconButton("mic"', self.controller)
        self.assertIn('orbButton.setImage(UIImage(systemName: "waveform")', self.controller)

    def test_background_and_interruptions_cancel(self):
        for name in ("UIApplication.didEnterBackgroundNotification", "AVAudioSession.interruptionNotification"):
            self.assertIn(name, self.controller)
        self.assertIn("self?.cancelDictation()", self.controller)

    def test_camera_and_photos_honestly_disabled(self):
        menu = self.controller.split("let menu = UIAlertController", 1)[1].split("func documentPicker", 1)[0]
        self.assertIn('["chat.attach.camera", "chat.attach.photos"]', menu)
        self.assertIn("action.isEnabled = false", menu)
        self.assertIn("UIDocumentPickerViewController", menu)
        self.assertNotIn("requestAuthorization", menu)

    def test_draft_and_attachments_are_persisted_not_raw_audio(self):
        outbox = (CHAT / "ChatOutbox.swift").read_text()
        self.assertIn("var composerDrafts:", outbox)
        self.assertIn("var attachments: [ChatAttachment]", outbox)
        self.assertNotIn("audio", outbox.lower())

    def test_strings_match_all_five_languages_without_duplicates(self):
        tables = []
        for lang in ("en", "ru", "es", "kk", "uk"):
            text = (ROOT / f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings").read_text()
            pairs = re.findall(r'^"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)";', text, re.M)
            keys = [key for key, _ in pairs]
            self.assertEqual(len(keys), len(set(keys)), lang)
            tables.append({key: value for key, value in pairs})
        for table in tables[1:]:
            self.assertEqual(set(tables[0]), set(table))
        used = set(re.findall(r'"(chat\.(?:dictation|orb|attach)\.[^"]+)"', self.controller + self.bar))
        self.assertTrue(used <= set(tables[0]), used - set(tables[0]))

    def test_mic_usage_description_exists(self):
        data = plistlib.loads((ROOT / "ios/TalkHint/Info.plist").read_bytes())
        self.assertTrue(data.get("NSMicrophoneUsageDescription"))

    def test_existing_dictation_limit_not_live_call_limit(self):
        self.assertIn("for _ in 0..<120", self.controller)  # existing 120 x 0.5s
        self.assertNotIn("180", self.controller)


if __name__ == "__main__":
    unittest.main(verbosity=2)
