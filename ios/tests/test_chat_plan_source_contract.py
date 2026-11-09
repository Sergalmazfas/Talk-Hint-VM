from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ChatPlanSourceContractTests(unittest.TestCase):
    def test_native_confirmation_and_keyboard_contracts(self):
        api = (ROOT / "ios/TalkHint/Chat/ChatAPI.swift").read_text()
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        self.assertIn("/messages/\\(messageId)/confirm-plan", api)
        self.assertIn('"planHash": planHash', api)
        self.assertIn("let currentAction = current.action, currentAction.planHash == planHash", chat)
        self.assertIn("result.dialed == false", chat)
        self.assertIn("SecretaryTaskReviewViewController(phoneNumber:", chat)
        self.assertIn("messageTap.cancelsTouchesInView = false", chat)
        self.assertIn("composer.inputAccessoryView = keyboardToolbar", chat)
        self.assertIn("guard !dictation.isBusy else { return }", chat)
        self.assertIn('message.status == "complete"', chat)
        self.assertIn("button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)", chat)
        self.assertIn("button.titleLabel?.lineBreakMode = .byWordWrapping", chat)
        self.assertIn('["PLAN_STALE", "PLAN_CHANGED"].contains(detail)', chat)
        self.assertNotIn("localizedCaseInsensitiveContains", chat)
        self.assertNotIn("confirmationToken =", (ROOT / "ios/TalkHint/Chat/ChatOutbox.swift").read_text())

    def test_secretary_review_separates_human_display_from_canonical_instruction(self):
        source = (ROOT / "ios/TalkHint/UI/SecretaryViewController.swift").read_text()
        review = source[source.index("final class SecretaryTaskReviewViewController"):
                        source.index("private enum SecretaryPhoneNumber")]
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        self.assertIn("displayInstruction: String? = nil", review)
        self.assertIn("instructionCard.text = displayInstruction ?? instruction", review)
        self.assertIn("instruction: instruction, confirmationToken: confirmationToken", review)
        self.assertIn("phoneNumber: draft.phoneNumber ?? number, instruction: draft.instruction", review)
        self.assertIn("displayInstruction: planReviewSummary(currentAction.plan)", chat)

    def test_locales_have_same_new_chat_plan_keys(self):
        locales = ("en", "es", "ru", "kk", "uk")
        prefix = '"chat.plan.'
        sets = []
        for locale in locales:
            source = (ROOT / f"ios/TalkHint/Resources/{locale}.lproj/Localizable.strings").read_text()
            sets.append({line.split('"')[1] for line in source.splitlines()
                         if line.startswith(prefix)})
            self.assertIn('"chat.keyboard.done"', source)
        self.assertTrue(all(keys == sets[0] for keys in sets[1:]))


if __name__ == "__main__":
    unittest.main()
