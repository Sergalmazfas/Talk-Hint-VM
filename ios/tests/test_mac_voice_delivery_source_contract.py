"""Unpaid source checks only; this does not compile or run XCTest."""
import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def required_tests():
    tree = ast.parse((ROOT / "ios/scripts/verify-xcresult.py").read_text())
    return next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "REQUIRED_TESTS" for t in node.targets)
    )


class MacVoiceDeliverySourceContract(unittest.TestCase):
    def test_reduce_motion_fixture_does_not_write_read_only_environment(self):
        view = (ROOT / "ios/TalkHint/Chat/ChatVoiceOrbView.swift").read_text()
        fixture = (ROOT / "ios/TalkHintTests/ChatVoiceOrbTests.swift").read_text()
        self.assertIn("var reduceMotionOverride: Bool? = nil", view)
        self.assertIn("reduceMotionOverride ?? reduceMotion", view)
        self.assertIn("reduceMotionOverride: true", fixture)
        self.assertNotIn(r".environment(\.accessibilityReduceMotion", fixture)
        self.assertEqual(view.count("effectiveReduceMotion"), 5)

    def test_mac_scene_fixture_uses_real_session_and_cleans_up(self):
        source = (ROOT / "ios/TalkHintTests/SceneLaunchTests.swift").read_text()
        self.assertIn('save(token: "native-fixture"', source)
        self.assertEqual(source.count("defer { SessionStore.shared.clear() }"), 2)
        self.assertIn("testLoggedInFlagWithoutStoredSessionShowsLogin", source)
        scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.assertIn("loggedIn && SessionStore.shared.isLoggedIn", scene)

    def test_accepted_chat_api_and_outbox_gates_are_not_removed(self):
        tests = required_tests()
        self.assertEqual(len(tests["ChatAPITests"]), 3)
        self.assertEqual(len(tests["ChatOutboxTests"]), 4)
        self.assertEqual(len(tests["SceneLaunchTests"]), 2)

    def test_every_voice_fixture_is_required_by_xcresult_gate(self):
        tests = required_tests()
        for path in sorted((ROOT / "ios/TalkHintTests").glob("ChatVoice*Tests.swift")):
            methods = re.findall(r"^\s*func (test\w+)\(", path.read_text(), re.M)
            self.assertTrue(methods)
            self.assertEqual(set(tests[path.stem]), set(methods), path.name)

    def test_all_required_tests_still_exist_in_native_sources(self):
        for suite, methods in required_tests().items():
            path = ROOT / "ios/TalkHintTests" / (suite + ".swift")
            self.assertTrue(path.is_file(), suite)
            source = path.read_text()
            for method in methods:
                self.assertRegex(source, rf"\bfunc\s+{re.escape(method)}\s*\(", f"{suite}/{method}")
