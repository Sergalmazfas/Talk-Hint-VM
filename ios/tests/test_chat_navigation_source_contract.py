"""Source contracts only. Runtime/keyboard/phone behavior requires native XCTest."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ChatNavigationSourceContracts(unittest.TestCase):
    def setUp(self):
        self.scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.nav = (ROOT / "ios/TalkHint/Chat/ChatNavigation.swift").read_text()
        self.chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()

    def test_existing_shell_keeps_all_five_identifiers_and_phone_roots(self):
        for tag in range(5):
            self.assertIn(f"tag: {tag}", self.scene)
        for entry in ("HomeViewController()", "HomeViewController(mode: .translator)", "HomeViewController(secretary: true)", "CallHistoryViewController()"):
            self.assertIn(entry, self.scene)
        self.assertIn("let chat = ChatEntryViewController()", self.scene)
        self.assertNotIn("selectedViewController = chatTab", self.scene)

    def test_actual_chat_is_fullscreen_not_embedded_tab(self):
        self.assertIn("modalPresentationStyle = .fullScreen", self.nav)
        self.assertIn("return false", self.nav)
        self.assertIn("chatOrigin = selectedViewController", self.nav)
        self.assertNotIn("let chat = ChatViewController()", self.scene)

    def test_same_chat_instance_is_retained(self):
        self.assertIn("if retainedChatNavigation == nil", self.nav)
        self.assertIn("present(navigation", self.nav)
        self.assertNotIn("retainedChatNavigation = nil", self.nav)

    def test_back_and_menu_are_distinct(self):
        self.assertIn('action: #selector(closeChat)', self.chat)
        self.assertIn('action: #selector(toggleDrawer)', self.chat)
        self.assertIn("[back, topTitle, menu]", self.chat)

    def test_existing_settings_reused_without_migration(self):
        self.assertIn("SettingsViewController(api: api)", self.chat)
        self.assertIn("viewController === viewControllers.first", self.nav)
        settings = (ROOT / "ios/TalkHint/UI/SettingsViewController.swift").read_text()
        self.assertNotIn("ChatViewController", settings)

    def test_phone_overlay_is_never_dismissed_by_chat(self):
        self.assertIn("navigation.presentedViewController == nil", self.nav)
        self.assertIn("dismissChatForExternalTabSelection()", self.nav)

    def test_return_does_not_reload_and_replace_composer(self):
        self.assertIn("if hasLoadedChat {", self.chat)
        self.assertIn("refreshVisibleConversation()", self.chat)
        self.assertIn("savedScrollPosition = scroll.contentOffset", self.chat)
        self.assertIn("restoreScrollPosition(position)", self.chat)

    def test_drawer_is_scrollable_future_sections_are_disabled(self):
        self.assertIn("let menuScroll = UIScrollView()", self.chat)
        block = self.chat.split('for future in [', 1)[1].split("let settings =", 1)[0]
        self.assertIn("item.isEnabled = false", block)
        self.assertIn('"chat.contacts"', block)
        self.assertNotIn("chat.projects", self.chat)
        self.assertIn('NSLocalizedString("chat.futureNote"', self.chat)

    def test_keyboard_recording_and_future_orb_are_preserved(self):
        self.assertIn("view.keyboardLayoutGuide.topAnchor", self.chat)
        self.assertIn("cancelDictation()", self.chat)
        self.assertIn("orbButton.isEnabled = false", self.chat)
        self.assertIn("isMeteringEnabled = true", self.chat)


if __name__ == "__main__":
    unittest.main(verbosity=2)
