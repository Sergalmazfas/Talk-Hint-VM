"""Voice wiring safety checks. These are NOT a Mac build or real microphone tests."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "ios/TalkHint/Chat"


class ChatVoiceSessionSourceContract(unittest.TestCase):
    def test_entry_is_native_fullscreen_and_origin_and_server_gated(self):
        parent = (CHAT / "ChatViewController.swift").read_text()
        voice = (CHAT / "ChatVoiceViewController.swift").read_text()
        policy = (CHAT / "ChatVoiceClientPolicy.swift").read_text()
        self.assertIn("#if TALKHINT_NATIVE_VALIDATION || TALKHINT_CHAT_PREVIEW", policy)
        self.assertIn("#elseif TALKHINT_CHAT_LIVE_DEV || TALKHINT_APP_DEV", policy)
        self.assertIn('host == "talkhint.app"', policy)
        self.assertIn('host.hasSuffix(".replit.dev")', policy)
        self.assertIn("ChatVoiceClientPolicy.allows(origin: AppConfig.baseURL", parent)
        self.assertEqual(parent.count("guard Self.voiceClientEnabled, capabilities?.voiceMode?.available == true"), 2)
        self.assertIn("orbButton.isEnabled = Self.voiceClientEnabled && capabilities?.voiceMode?.available == true", parent)
        self.assertIn("modalPresentationStyle = .fullScreen", voice)
        self.assertIn('button("xmark"', voice)
        self.assertIn("dismiss(animated: true)", voice)
        self.assertNotIn("UITabBar", voice)

    def test_same_conversation_stt_outbox_and_retry_payload(self):
        parent = (CHAT / "ChatViewController.swift").read_text()
        voice = (CHAT / "ChatVoiceViewController.swift").read_text()
        self.assertIn("conversationID: id", parent)
        self.assertIn('requestId: requestID, mode: "voice"', parent)
        self.assertIn("context: saved.context, mode: saved.mode", parent)
        self.assertIn("context: item.context, mode: item.mode", parent)
        self.assertIn("api.prepareTranscribe(audio: data", voice)
        self.assertIn("pendingSend = (text, UUID())", voice)
        self.assertIn("submit(pending.text, pending.id)", voice)
        self.assertIn("outbox.setState(.uncertain", parent)

    def test_audio_is_metered_and_does_not_own_callkit(self):
        text = (CHAT / "ChatVoiceCapture.swift").read_text()
        for term in ["AVAudioEngine()", "setVoiceProcessingEnabled(true)",
                     "CallManager.shared.hasPhoneAudioSession", "removeItem(at: file)",
                     "try? session.setCategory(previous.0"]:
            self.assertIn(term, text)
        self.assertNotIn("Twilio", text.split("final class", 1)[1])
        self.assertNotIn("CXCall", text)
        self.assertNotIn("AVAudioRecorder", text)
        self.assertIn(".dataPlayedBack", text)
        self.assertIn("player.stop()", text)

    def test_speech_is_capability_gated_and_cannot_start_a_call(self):
        voice = (CHAT / "ChatVoiceViewController.swift").read_text()
        for term in ["audio.speech", "streamSpeech(", "AVSpeechSynthesizer",
                     "confirmChatPlan(", "createSecretaryTask(", "didFinishAudibleReadback("]:
            self.assertNotIn(term, voice)
        self.assertIn("chat.voiceMode.noOutput", voice)
        self.assertIn("caps.voiceMode?.speech.available == true", voice)
        self.assertIn("streamChatSpeech(", voice)
        self.assertLess(voice.index("stopSpeech() // Immediate local stop"), voice.index("api.cancelChatVoice("))

    def test_barge_in_waits_for_actual_generation_abort(self):
        voice = (CHAT / "ChatVoiceViewController.swift").read_text()
        self.assertIn("capture.onSpeechBegan", voice)
        self.assertIn("api.cancelChatVoice(", voice)
        self.assertIn("try await cancellation.value", voice)
        self.assertIn("session.interrupt()", voice)
        self.assertIn("operation?.cancel()", voice)
        self.assertIn("AVAudioSession.interruptionNotification", voice)
        self.assertIn("UIApplication.didEnterBackgroundNotification", voice)

    def test_pause_is_a_proposal_only_and_does_not_touch_phone_timers(self):
        state = (CHAT / "ChatVoiceSpeechState.swift").read_text()
        capture = (CHAT / "ChatVoiceCapture.swift").read_text()
        self.assertIn("currentSeconds: Double = 1.2", state)
        self.assertIn("proposedSeconds: Double = 0.8", state)
        self.assertIn("threshold: ChatVoicePausePolicy.currentSeconds", capture)
        self.assertNotIn("RetellClient", state)

    def test_translated_keys_are_identical_in_all_existing_languages(self):
        keys = []
        for language in ["en", "ru", "es", "kk", "uk"]:
            text = (ROOT / f"ios/TalkHint/Resources/{language}.lproj/Localizable.strings").read_text()
            values = re.findall(r'^"(chat\.voiceMode\.[^"]+)"\s*=', text, re.M)
            self.assertEqual(len(values), len(set(values)), language)
            self.assertEqual(len(values), 29, language)
            keys.append(set(values))
        for other in keys[1:]:
            self.assertEqual(keys[0], other)


if __name__ == "__main__":
    unittest.main()
