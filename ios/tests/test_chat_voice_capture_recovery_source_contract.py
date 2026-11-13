"""Offline wiring guards. These do NOT execute Swift or validate an iPhone route."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "ios/TalkHint/Chat"


class ChatVoiceCaptureRecoverySourceContract(unittest.TestCase):
    def test_session_and_voice_processing_precede_tap_and_engine_start(self):
        source = (CHAT / "ChatVoiceCapture.swift").read_text()
        start = source.split("private func ensureEngine()", 1)[1].split("private var captureAllowed", 1)[0]
        order = ["session.setCategory(", "session.setActive(true)",
                 "setVoiceProcessingEnabled(true)", "try installInputTap(audio)", "try audio.start()"]
        offsets = [start.index(item) for item in order]
        self.assertEqual(offsets, sorted(offsets))
        self.assertIn(".allowBluetooth", start)
        self.assertNotIn("overrideOutputAudioPort", source)
        tap = source.split("private func installInputTap", 1)[1].split("private func restartInput", 1)[0]
        self.assertIn("outputFormat(forBus: 0)", tap)
        self.assertIn("format.sampleRate > 0", tap)
        self.assertIn("format.channelCount > 0", tap)
        self.assertIn("format: format", tap)

    def test_notification_watchdog_and_routes_share_one_bounded_supervisor(self):
        capture = (CHAT / "ChatVoiceCapture.swift").read_text()
        health = (CHAT / "ChatVoiceCaptureHealth.swift").read_text()
        self.assertIn("object: audio, name: .AVAudioEngineConfigurationChange", capture)
        for reason in ["newDeviceAvailable", "oldDeviceUnavailable", "override",
                       "routeConfigurationChange", "noSuitableRouteForCategory", "wakeFromSleep"]:
            self.assertIn(f"RouteChangeReason.{reason}", capture)
        self.assertIn("recoveries == 0", health)
        self.assertIn("now - since >= 2", health)
        self.assertIn("self.check()", health.replace("owner.check()", "self.check()"))
        self.assertIn("if let observer { center.removeObserver(observer) }", health)
        self.assertIn("self.epoch == revision", health)
        self.assertNotIn("routeChangeNotification", (CHAT / "ChatVoiceViewController.swift").read_text())

    def test_recovery_discards_partial_input_and_never_replays_output(self):
        source = (CHAT / "ChatVoiceCapture.swift").read_text()
        restart = source.split("private func restartInput()", 1)[1].split("func start()", 1)[0]
        for item in ["captureAllowed", "!isPlaying", "sink.end()", "recordingID = nil",
                     "removeItem(at: file)", "removeTap", "try installInputTap(audio)",
                     "try beginRecording(audio)"]:
            self.assertIn(item, restart)
        self.assertNotIn("onUtterance", restart)
        self.assertNotIn("play(", restart)
        self.assertIn("self.tapID == tapID", source)
        self.assertIn("supervisor?.stop(); supervisor = nil", source)

    def test_voice_ui_uses_localized_header_and_one_utterance_not_history(self):
        source = (CHAT / "ChatVoiceViewController.swift").read_text()
        self.assertIn('title.text = "TalkHint"', source)
        self.assertIn('NSLocalizedString("chat.voiceMode.open"', source)
        self.assertIn("ChatVoicePresentation.latestUtterance", source)
        self.assertNotIn('joined(separator: "\\n\\n")', source)
        self.assertIn("screenActive: viewIfLoaded?.window != nil", source)
        for language in ["ru", "en", "es", "kk", "uk"]:
            raw = (ROOT / f"ios/TalkHint/Resources/{language}.lproj/Localizable.strings").read_text()
            voice = re.findall(r'^"chat\.voiceMode\.[^"]+"\s*=\s*"([^"]*)";', raw, re.M)
            self.assertEqual(len(voice), 30, language)
            self.assertFalse(any("ElevenLabs" in text or "Flash" in text or "Dev:" in text for text in voice), language)

    def test_native_recovery_fixture_uses_notifications_and_fake_operations(self):
        source = (ROOT / "ios/TalkHintTests/ChatVoiceCaptureHealthTests.swift").read_text()
        for item in ["center.post(name: .AVAudioEngineConfigurationChange",
                     "testClosingCancelsQueuedRecoveryAndRemovesObserver",
                     "testRestartErrorTerminatesAndDoesNotLoop",
                     "testWatchdogFailsWithoutAnyNotificationOrAudioCallback",
                     "testLostOwnershipDuringRecoveryNeverRestartsInput",
                     "automaticWatchdog: false"]:
            self.assertIn(item, source)
        for forbidden in ["AVAudioEngine()", "AVAudioSession.sharedInstance()", "APIClient("]:
            self.assertNotIn(forbidden, source)
        # The restart closure refers back to this property; inference alone is circular in Swift.
        self.assertIn("lazy var supervisor: ChatVoiceCaptureSupervisor =", source)

    def test_listening_animation_has_foreground_and_accessibility_guards(self):
        source = (CHAT / "ChatVoiceOrbView.swift").read_text()
        self.assertIn("screenActive ?? (scenePhase == .active)", source)
        self.assertIn("TimelineView(.animation", source)
        self.assertIn("paused: effectiveReduceMotion || !active || phase != .listening", source)
        self.assertIn("Self.scale(phase: phase, level: level) + pulse", source)
        self.assertNotIn("Double.random", source)


if __name__ == "__main__":
    unittest.main()
