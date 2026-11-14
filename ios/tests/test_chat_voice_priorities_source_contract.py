"""Read-only guards; not a replacement for native XCTest/device audio."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "ios/TalkHint/Chat"

class VoicePrioritiesContract(unittest.TestCase):
    def test_output_gate_discards_unqualified_wavs_and_explicit_tap_stops(self):
        policy = (CHAT / "ChatVoiceInputPolicy.swift").read_text()
        capture = (CHAT / "ChatVoiceCapture.swift").read_text()
        screen = (CHAT / "ChatVoiceViewController.swift").read_text()
        for part in ["interruptionDB: Float = -25", "interruptionSeconds = 0.4", "minimumSpeechSeconds = 0.5"]:
            self.assertIn(part, policy)
        self.assertIn("guard inputPolicy.canSubmit", capture)
        self.assertIn("discardRecording(preservingPolicy: true)", capture)
        self.assertIn("#selector(stopByTap)", screen)
        self.assertIn("capture.discardInput()", screen)

    def test_readback_needs_actual_completed_output_and_matching_plan(self):
        screen = (CHAT / "ChatVoiceViewController.swift").read_text()
        for part in ["session.takeApproval(text:", "speechEnabled, !resultOutput, measuredFirstSound",
                     "action.voiceReadback != nil", "message.id == replyID", "confirmation.dialed == false",
                     "confirmation.message.action?.planHash == action.planHash"]:
            self.assertIn(part, screen)
        runner = (CHAT / "ChatVoicePlanRunner.swift").read_text()
        for part in ["store.pendingSecretaryCall == nil", "store.savePendingSecretaryCall(next)",
                     "clientRequestId: draft.clientRequestId", "draft.ownerId == store.userId"]:
            self.assertIn(part, runner)
        self.assertNotIn("Retell", runner)  # no direct provider SDK/config mutation

    def test_diagnostics_are_metadata_not_conversation(self):
        screen = (CHAT / "ChatVoiceViewController.swift").read_text()
        self.assertIn('language: hint', screen)
        self.assertIn('characters=\\(text.count, privacy: .public)', screen)
        self.assertNotIn('privacy: .public) text=', screen)
        for line in screen.splitlines():
            if "log." in line:
                self.assertNotIn(r"\(text,", line)
        self.assertIn("ChatVoiceHistoryRetryPolicy.shouldRetry", screen)
        history = screen.split("private func refreshHistory()", 1)[1].split("private func showPlanCard", 1)[0]
        self.assertNotIn('status.text = NSLocalizedString("chat.voiceMode.networkError"', history)

    def test_main_screen_starts_new_chat_and_in_chat_keeps_conversation(self):
        screen = (CHAT / "ChatViewController.swift").read_text()
        main = (ROOT / "ios/TalkHint/UI/HomeViewController.swift").read_text()
        self.assertIn("openChat(newVoice: true)", main)
        self.assertIn("createNewChat(preservingDraft: false, onCreated:", screen)
        self.assertIn("ChatVoiceViewController(api: api, conversation: conversation", screen)
        self.assertIn("caps.voiceRevision ?? 0", (CHAT / "ChatVoiceViewController.swift").read_text())

if __name__ == "__main__":
    unittest.main()
