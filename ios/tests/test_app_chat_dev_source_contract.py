"""Read-only source checks. The new configuration still requires Xcode on Mac."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AppChatDevSourceContracts(unittest.TestCase):
    def test_full_app_has_distinct_scheme_with_same_isolated_dev_identity(self):
        project = (ROOT / "ios/project.yml").read_text()
        self.assertIn("TalkHintAppDev:", project)
        self.assertIn("config: AppDev", project)
        self.assertIn("TALKHINT_CHAT_LIVE_DEV TALKHINT_APP_DEV", project)
        target = project.split("        AppDev:", 1)[1].split("    dependencies:", 1)[0]
        self.assertIn("app.talkhint.chatdev", target)
        self.assertIn("TALKHINT_OAUTH_SCHEME: talkhint-chatdev", target)

    def test_full_app_does_not_route_to_standalone_chat(self):
        scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.assertIn("#if TALKHINT_APP_DEV\n        showAppDev(", scene)
        full = scene.split("private func showAppDev(", 1)[1].split("private func showLiveChat(", 1)[0]
        self.assertIn("makeMainTabController(chatFactory:", full)
        self.assertIn("ChatViewController.liveApprovedScreen()", full)
        self.assertIn("self?.showAppDev(loggedIn: true)", full)
        self.assertNotIn("PushManager", full)
        self.assertNotIn("SecretaryAlertManager", full)

    def test_no_new_phone_startup_and_retained_fullscreen_chat(self):
        app = (ROOT / "ios/TalkHint/App/AppDelegate.swift").read_text()
        self.assertIn("|| TALKHINT_CHAT_LIVE_DEV", app)
        nav = (ROOT / "ios/TalkHint/Chat/ChatNavigation.swift").read_text()
        self.assertIn("modalPresentationStyle = .fullScreen", nav)
        self.assertIn("if retainedChatNavigation == nil", nav)
        self.assertIn("navigation.presentedViewController == nil", nav)

    def test_existing_phone_roots_and_localized_chat_remain(self):
        scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        for entry in ["HomeViewController()", "HomeViewController(mode: .translator)",
                      "HomeViewController(secretary: true)", "CallHistoryViewController()",
                      'NSLocalizedString("tab.chat"', "ChatEntryViewController()"]:
            self.assertIn(entry, scene)
        calls = (ROOT / "ios/TalkHint/Calls/CallManager.swift").read_text()
        mode = calls.split("private static func selectedIncomingMode()", 1)[1].split("// MARK:", 1)[0]
        if "selectedIndex == 2" in mode:
            self.assertLess(mode.index("tab is TalkHintTabBarController"),
                            mode.index("selectedIndex == 2"))
        else:
            self.assertIn("return .hint", mode)


if __name__ == "__main__":
    unittest.main()
