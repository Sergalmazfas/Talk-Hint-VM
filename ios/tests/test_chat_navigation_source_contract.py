"""Source contracts only. Runtime/keyboard/phone behavior requires native XCTest."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ChatNavigationSourceContracts(unittest.TestCase):
    def setUp(self):
        self.scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.nav = (ROOT / "ios/TalkHint/Chat/ChatNavigation.swift").read_text()
        self.chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()

    def test_native_view_search_keeps_descending_after_a_container_matches(self):
        native = (ROOT / "ios/TalkHintTests/ChatNavigationTests.swift").read_text()
        helper = native.split("private func descendants<T: UIView>", 1)[1].split(
            "private func button", 1)[0]
        self.assertIn("((view as? T).map { [$0] } ?? []) +", helper)
        self.assertIn("view.subviews.flatMap { descendants($0, as: type) }", helper)
        self.assertNotIn("?? view.subviews", helper)

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
        self.assertIn("[menu, topTitle, back]", self.chat)

    def test_settings_entry_is_only_in_chat_and_reference_glyph_has_no_fake_badge(self):
        home = (ROOT / "ios/TalkHint/UI/HomeViewController.swift").read_text()
        self.assertNotIn("SettingsViewController", home)
        self.assertNotIn("button-open-settings", home)
        self.assertNotIn("settingsTapped", home)
        glyph = (ROOT / "ios/TalkHint/Chat/ChatMenuButton.swift").read_text()
        self.assertIn("Two short lines and an accent dot", glyph)
        self.assertIn("not an unread/status indicator", glyph)
        self.assertIn("UIColor.systemBlue.setFill()", glyph)
        self.assertIn("UIColor.label.setStroke()", glyph)
        self.assertIn("override func traitCollectionDidChange", glyph)
        self.assertIn("UIAccessibility.isReduceMotionEnabled", self.chat)

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
        self.assertIn("savedScrollPosition = pendingScrollRestore ?? scroll.contentOffset", self.chat)
        self.assertIn("scheduleReadingRestore()", self.chat)
        self.assertIn("anchorY ?? savedPosition.y", self.chat)

    def test_refresh_captures_message_anchor_before_replacing_rows(self):
        refresh = self.chat.split("private func refreshVisibleConversation()", 1)[1].split(
            "private func restoreScrollPosition", 1)[0]
        self.assertLess(refresh.index("captureReadingPosition()"),
                        refresh.index("messages = ChatOutbox.merge"))
        capture = self.chat.split("private func captureReadingPosition()", 1)[1].split(
            "private func scheduleReadingRestore()", 1)[0]
        self.assertIn("guard readingMessageAnchor == nil else { return }", capture)
        self.assertIn("let position = pendingScrollRestore ?? scroll.contentOffset", capture)
        self.assertIn("to: scroll).y - position.y", capture)
        self.assertIn("if !shouldStickToBottom { captureReadingPosition() }", self.chat)

    def test_native_anchor_regression_waits_for_real_restore_without_relaxing_assertion(self):
        native = (ROOT / "ios/TalkHintTests/ChatApprovedScreenTests.swift").read_text()
        helper = native.split("private func readingLayoutSettled", 1)[1].split(
            "func testReadingAnchorSurvivesGrowthAboveIt", 1)[0]
        self.assertIn("offlineReadingRestorePending", helper)
        self.assertIn("Task.sleep", helper)
        self.assertIn('throw NSError(domain: "OfflineChatReadingRestoreTimeout"', helper)
        anchor = native.split("func testReadingAnchorSurvivesGrowthAboveIt", 1)[1].split(
            "private func snapshot", 1)[0]
        self.assertIn("for count in [30, 60]", anchor)
        self.assertIn("try await readingLayoutSettled(chat)", anchor)
        self.assertIn("offset, accuracy: 2)", anchor)
        self.assertNotIn("await Task.yield()", anchor)

    def test_drawer_is_scrollable_future_sections_are_disabled(self):
        self.assertIn("let menuScroll = UIScrollView()", self.chat)
        helper = self.chat.split('func unavailable(', 1)[1].split('// Menu destinations', 1)[0]
        self.assertIn("item.isEnabled = false", helper)
        self.assertIn('NSLocalizedString("chat.coming"', helper)
        block = self.chat.split('// Menu destinations', 1)[1].split("let settings =", 1)[0]
        for key in ("calendar", "tasks", "notebook", "contacts", "files", "mail",
                    "connections", "card", "tariff", "help", "about"):
            self.assertIn(f'"chat.{key}"', block)
        self.assertEqual(block.count("unavailable(key, symbol)"), 2)
        self.assertNotIn("chat.projects", self.chat)
        self.assertIn('NSLocalizedString("chat.futureNote"', self.chat)

    def test_keyboard_recording_and_future_orb_are_preserved(self):
        self.assertIn("view.keyboardLayoutGuide.topAnchor", self.chat)
        self.assertIn("cancelDictation()", self.chat)
        self.assertIn("orbButton.isEnabled = false", self.chat)
        self.assertIn("isMeteringEnabled = true", self.chat)


if __name__ == "__main__":
    unittest.main(verbosity=2)
