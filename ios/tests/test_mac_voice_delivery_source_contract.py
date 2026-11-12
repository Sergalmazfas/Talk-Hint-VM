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
    def test_location_delegate_hops_to_main_actor_with_value_only_fix(self):
        source = (ROOT / "ios/TalkHint/Chat/ChatPhoneContext.swift").read_text()
        self.assertEqual(source.count("nonisolated func locationManager"), 3)
        self.assertIn("struct ChatPhoneLocationFix: Sendable", source)
        self.assertIn("locations.last.map(ChatPhoneLocationFix.init)", source)
        self.assertIn("Task { @MainActor [weak self] in self?.receivedLocation(fix) }", source)
        for suppression in ("@preconcurrency", "@unchecked Sendable", "assumeIsolated", "nonisolated(unsafe)"):
            self.assertNotIn(suppression, source)

    def test_recording_callback_transfers_immutable_owner_and_scalar_values(self):
        source = (ROOT / "ios/TalkHint/Chat/ChatVoiceCapture.swift").read_text()
        callback = source.split("let deliverSample:", 1)[1].split("audio.inputNode.installTap", 1)[0]
        self.assertIn("@Sendable (UUID, Float, Double, Bool) -> Void", callback)
        self.assertLess(callback.index("guard let owner = self"), callback.index("Task { @MainActor"))
        self.assertIn("guard id == owner.recordingID", callback)
        self.assertNotIn("Task { @MainActor [weak self]", callback)
        self.assertIn("result: deliverSample", source)

    def test_orb_render_fixture_checks_pixels_with_a_transparent_control(self):
        fixture = (ROOT / "ios/TalkHintTests/ChatVoiceOrbTests.swift").read_text()
        self.assertNotIn("host.view.subviews.isEmpty", fixture)
        self.assertIn("renderedPixelCount(Color.clear", fixture)
        self.assertIn("format.opaque = false", fixture)
        self.assertIn("afterScreenUpdates: true", fixture)
        self.assertIn("CGImageAlphaInfo.premultipliedLast", fixture)
        self.assertIn("window.rootViewController = nil", fixture)
        self.assertIn("previousKeyWindow?.makeKey()", fixture)

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
