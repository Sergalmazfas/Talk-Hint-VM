"""Offline source checks. Native compilation/device validation still runs on Mac."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]

class CopilotFreezeTests(unittest.TestCase):
    def test_four_tabs_and_no_copilot_entry(self):
        source = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.assertIn("let roots: [UIViewController] = [calls, translator, secretary, history]", source)
        self.assertIn("navigation.tabBarItem = root.tabBarItem", source)
        self.assertNotIn("HomeViewController(mode: .copilot)", source)

    def test_incoming_mode_does_not_depend_on_tab_index(self):
        source = (ROOT / "ios/TalkHint/Calls/CallManager.swift").read_text()
        incoming = source.split("private static func selectedIncomingMode()", 1)[1].split("\n    }", 1)[0]
        self.assertNotIn("selectedIndex", incoming)
        self.assertIn("return .hint", incoming)
        outgoing = source.split("func startOutgoingCall(to number:", 1)[1]
        self.assertLess(outgoing.index("mode != .copilot"), outgoing.index("prepareAudioDevice(for:"))
        self.assertIn("static let copilotAvailable = false", source)

    def test_stream_and_hidden_screen_fail_before_network(self):
        source = (ROOT / "ios/TalkHint/Calls/CopilotStream.swift").read_text()
        start = source.split("func start()", 1)[1].split("func stop()", 1)[0]
        self.assertLess(start.index("CallManager.copilotAvailable"), start.index("URLComponents("))
        self.assertIn("copilot.disabled", start)

    def test_preserved_settings_and_localization(self):
        for lang in ["en", "ru", "es", "uk", "kk"]:
            source = (ROOT / f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings").read_text()
            self.assertEqual(source.count('"copilot.disabled" ='), 1)
        for name in ["CopilotAudioDevice.m", "CopilotHoldGate.h", "CopilotCallCoordinator.swift",
                     "CopilotCloneSpeechOutput.swift"]:
            self.assertTrue((ROOT / "ios/TalkHint/Calls" / name).is_file())
        source = (ROOT / "ios/TalkHint/Auth/SessionStore.swift").read_text()
        self.assertIn('talkhint.copilot.language', source)

    def test_direct_api_helpers_reject_copilot_not_other_modes(self):
        source = (ROOT / "ios/TalkHint/Networking/APIClient.swift").read_text()
        accept = source.split("func acceptCall(callSid:", 1)[1].split("\n    }", 1)[0]
        self.assertIn("guard !copilot || CallManager.copilotAvailable", accept)
        speech = source.split("func copilotCloneSpeech(", 1)[1].split("\n    }", 1)[0]
        self.assertLess(speech.index("guard CallManager.copilotAvailable"),
                        speech.index("URLRequest("))

    def test_history_and_secretary_notifications_use_stable_tags(self):
        for name in ["UI/HomeViewController.swift", "UI/SecretaryViewController.swift",
                     "Push/SecretaryAlertManager.swift"]:
            source = (ROOT / "ios/TalkHint" / name).read_text()
            self.assertNotIn("selectedIndex = 4", source)
            self.assertNotIn("selectedIndex = 3", source)
            self.assertNotIn("viewControllers?[3]", source)
            self.assertNotIn("viewControllers?[4]", source)
            self.assertIn("selectedViewController =", source)
        alerts = (ROOT / "ios/TalkHint/Push/SecretaryAlertManager.swift").read_text()
        self.assertEqual(alerts.count("tabBarItem.tag == 3"), 2)

if __name__ == "__main__":
    unittest.main()
