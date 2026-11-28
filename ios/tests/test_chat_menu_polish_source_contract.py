"""Static guards; these do NOT replace UIKit layout / editing XCTest on Mac."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ChatMenuPolishContracts(unittest.TestCase):
    def test_placeholder_is_a_noneditable_decoration_not_a_text_value(self):
        composer = (ROOT / "ios/TalkHint/Chat/ChatComposerTextView.swift").read_text()
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        self.assertIn("private let hint = UILabel()", composer)
        self.assertIn("hint.isUserInteractionEnabled = false", composer)
        self.assertIn("hint.isAccessibilityElement = false", composer)
        self.assertIn("UITextView.textDidChangeNotification", composer)
        self.assertIn('private let composer = ChatComposerTextView()', chat)
        self.assertIn('composer.placeholder = NSLocalizedString("chat.message.placeholder"', chat)
        self.assertNotRegex(chat, r'composer\.text\s*=.*NSLocalizedString\("chat.message.placeholder"')
        self.assertNotIn('composer.text == NSLocalizedString("chat.message.placeholder"', chat)
        self.assertNotIn('textView.text = NSLocalizedString("chat.message.placeholder"', chat)

    def test_unavailable_group_has_note_above_all_rows_separate_from_history(self):
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        block = chat.split("let unavailableGroup = UIStackView()", 1)[1].split("let settings =", 1)[0]
        self.assertLess(block.index("unavailableGroup.addArrangedSubview(note)"),
                        block.index("func unavailable("))
        self.assertIn("unavailableGroup.addArrangedSubview(item)", block)
        self.assertIn("list.addArrangedSubview(unavailableGroup)", block)
        self.assertIn("recentGroup.addArrangedSubview(recent)", block)
        self.assertIn("recentGroup.addArrangedSubview(item)", block)
        self.assertLess(block.index('"chat.about"'), block.index("for conversation in conversations"))
        self.assertNotIn('list.addArrangedSubview(note)', chat)

    def test_settings_controls_stack_below_full_width_wrapping_labels(self):
        settings = (ROOT / "ios/TalkHint/UI/SettingsViewController.swift").read_text()
        self.assertEqual(settings.count("layoutSegmentedControl(control, in: cell)"), 3)
        layout = settings.split("private func layoutSegmentedControl", 1)[1].split(
            "@objc private func liveHintsChanged", 1)[0]
        for contract in ("label.numberOfLines = 0", "label.lineBreakMode = .byWordWrapping",
                         "[label, control]", "stack.axis = .vertical",
                         "control.accessibilityLabel = label.text",
                         "stack.trailingAnchor.constraint(equalTo: margins.trailingAnchor)"):
            self.assertIn(contract, layout)

    def test_old_title_cleanup_is_display_only_and_localized(self):
        title = (ROOT / "ios/TalkHint/Chat/ChatConversationTitle.swift").read_text()
        self.assertIn("title.hasPrefix(hint)", title)
        self.assertNotIn("replacingOccurrences", title)
        for hint in ("Write a message…", "Напишите сообщение…", "Escribe un mensaje…",
                     "Хабарлама жазыңыз…", "Напишіть повідомлення…"):
            self.assertIn(hint, title)
        self.assertIn('NSLocalizedString("chat.new"', title)
        self.assertNotIn("APIClient", title)

    def test_new_native_regressions_are_registered(self):
        tests = (ROOT / "ios/TalkHintTests/ChatNavigationTests.swift").read_text()
        registry = (ROOT / "ios/scripts/verify-xcresult.py").read_text()
        for name in ("testDrawerSeparatesUnavailableGroupAndRecentChats",
                     "testComposerPlaceholderIsNotEditableTextOrDraft",
                     "testOldConversationTitlesLoseOnlyLeadingHint",
                     "testSettingsFullWidthLabelsAndLightDarkSnapshots"):
            self.assertIn("func " + name, tests)
            self.assertIn('"' + name + '"', registry)
        self.assertIn('snapshot("Menu-grouping-', tests)
        self.assertIn('snapshot("Settings-full-labels-', tests)

    def test_short_notice_in_all_five_languages(self):
        for lang in ("en", "ru", "es", "kk", "uk"):
            strings = (ROOT / f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings").read_text()
            value = re.search(r'"chat.futureNote"\s*=\s*"([^"]*)";', strings).group(1)
            self.assertLess(len(value), 28, lang)
        english = (ROOT / "ios/TalkHint/Resources/en.lproj/Localizable.strings").read_text()
        self.assertIn('"chat.futureNote" = "Not connected yet";', english)
