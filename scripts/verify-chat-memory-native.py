#!/usr/bin/env python3
"""Offline source/Git checks ONLY. This does not compile Swift or execute XCTest."""
import argparse
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = "ios/TalkHint/Chat/"
LANGS = ("en", "ru", "es", "kk", "uk")
ALLOWED = {
    SWIFT + "ChatAPI.swift", SWIFT + "ChatViewController.swift",
    SWIFT + "ChatMemoryAction.swift", SWIFT + "ChatMemoryCardView.swift",
    "ios/TalkHintTests/ChatMemoryTests.swift", "ios/TalkHintTests/ChatMemoryScreenTests.swift",
    "scripts/verify-chat-memory-native.py", "docs/claude-mac-chat-memory-handoff.md",
} | {f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings" for lang in LANGS}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", help="Accepted permanent native branch base")
parser.add_argument("--ref", help="Check committed Git objects instead of the checkout")
args = parser.parse_args()


def git(*cmd):
    return subprocess.check_output(["git", *cmd], cwd=ROOT).decode()


def read(path):
    return git("show", f"{args.ref}:{path}") if args.ref else (ROOT / path).read_text()


def strings(text):
    return re.findall(r'^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";', text, re.M)


class MemorySourceChecks(unittest.TestCase):
    def test_localization_keys_match_and_memory_values_are_real(self):
        reference = None
        for lang in LANGS:
            pairs = strings(read(f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings"))
            keys = {k for k, _ in pairs}
            if reference is None:
                reference = keys
            self.assertEqual(keys, reference, lang)
            memory = [(k, v) for k, v in pairs if k.startswith("chat.memory.")]
            self.assertEqual(len(memory), 29)
            self.assertEqual(len(set(k for k, _ in memory)), 29)
            for key, value in memory:
                self.assertTrue(json.loads('"' + value + '"').strip(), (lang, key))

    def test_optional_field_and_separate_hash_endpoint(self):
        api = read(SWIFT + "ChatAPI.swift")
        memory = read(SWIFT + "ChatMemoryAction.swift")
        self.assertIn("var memoryAction: ChatMemoryAction? = nil", api)
        self.assertIn('/memory/\\(decision.rawValue)', memory)
        self.assertIn('json: ["memoryHash": memoryHash], authenticated: true', memory)
        self.assertNotRegex(memory, r'"(planHash|approvalText|confirmationToken|userId)"')
        self.assertNotIn("confirmChatPlan(", memory)
        self.assertIn("let dialed: Bool", memory)

    def test_expiry_is_server_based_and_fail_closed(self):
        model = read(SWIFT + "ChatMemoryAction.swift")
        self.assertIn('guard status == "proposed"', model)
        self.assertIn("Self.date(expiresAt)", model)
        self.assertIn("deadline <= now", model)
        self.assertIn('return "unavailable"', model)
        self.assertIn('"MEMORY_STALE": "stale"', model)
        self.assertIn('"MEMORY_EXPIRED": "expired"', model)

    def test_only_buttons_apply_and_no_call_launch(self):
        view = read(SWIFT + "ChatMemoryCardView.swift")
        self.assertIn("guard self?.canTap == true", view)
        self.assertIn("expiryTask?.cancel()", view)
        controller = read(SWIFT + "ChatViewController.swift")
        start = controller.index("private func decideMemory(")
        end = controller.index("\n    @objc", start)
        code = controller[start:end]
        self.assertIn("isCurrentOwner", code)
        self.assertIn("decidingMemoryMessageIDs.insert", code)
        self.assertIn("response.dialed == false", code)
        self.assertIn("api.chatMessage(", code)
        for forbidden in ("confirmChatPlan(", "SecretaryTaskReview", "startCall(", "saveHintPlan("):
            self.assertNotIn(forbidden, code)

    def test_native_tests_cover_transport_ui_and_owner(self):
        tests = read("ios/TalkHintTests/ChatMemoryTests.swift")
        ui = read("ios/TalkHintTests/ChatMemoryScreenTests.swift")
        self.assertEqual(len(re.findall(r"\bfunc test\w+\(", tests + ui)), 10)
        for name in ("testOwnerChangeRejectsOldCardBeforeTransport",
                     "testFullChatSaveIsButtonOnlyAndDoubleTapSendsOneRequest",
                     "testFullChatCancelAndServerStaleRefreshAreIndependentOfCallPlan"):
            self.assertIn(name, ui)
        self.assertIn("XCTAssertNil(new.action)", tests)
        self.assertIn("XCTAssertFalse(result.dialed)", tests)

    def test_ios_15_and_existing_audio_untouched(self):
        project = read("ios/project.yml")
        self.assertIn('iOS: "15.0"', project)
        if args.base and args.ref:
            subprocess.run(["git", "merge-base", "--is-ancestor", args.base, args.ref], cwd=ROOT, check=True)
            changed = set(git("diff", "--name-only", args.base, args.ref).splitlines())
            self.assertTrue(changed <= ALLOWED, changed - ALLOWED)
            for lang in LANGS:
                path = f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings"
                old = strings(git("show", f"{args.base}:{path}"))
                current = dict(strings(read(path)))
                self.assertTrue(all(current[k] == v for k, v in old), lang)


if __name__ == "__main__":
    print("Source/Git audit only: no Swift compiler, XCTest, network, microphone, or paid calls.")
    unittest.main(argv=["verify-chat-memory-native"], verbosity=2)
