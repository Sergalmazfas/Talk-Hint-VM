"""Source contracts only; these do not compile Swift or prove device playback."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]


class AgataRecoverySourceTests(unittest.TestCase):
    def test_localized_keys_match_and_generic_error_does_not_blame_connection(self):
        keys = []
        for language in ("en", "ru", "es", "kk", "uk"):
            source = (ROOT / f"ios/TalkHint/Resources/{language}.lproj/Agata.strings").read_text()
            pairs = re.findall(r'^"([^"]+)" = "([^"]*)";$', source, re.M)
            self.assertEqual(len(pairs), len({key for key, _ in pairs}))
            keys.append({key for key, _ in pairs})
            self.assertTrue({"checkPrevious", "reviewRequired", "recoveryReady"} <= keys[-1])
            self.assertFalse("Check your connection" in dict(pairs)["error"])
        for actual in keys[1:]:
            self.assertEqual(keys[0], actual)

    def test_recovery_is_explicit_authenticated_and_never_starts_voice(self):
        source = (ROOT / "ios/TalkHint/Chat/ChatAgataViewController.swift").read_text()
        method = source.split("@objc private func checkPrevious() {")[1].split("override func viewWillDisappear")[0]
        self.assertIn("recoveryButton.isEnabled = false", method)
        self.assertIn("self.validOwner()", method)
        self.assertIn("!Task.isCancelled", method)
        self.assertIn("self.api.recoverChatAgata()", method)
        self.assertNotIn("voice.start(", method)
        self.assertNotIn("requestRecordPermission", method)
        api = (ROOT / "ios/TalkHint/Chat/ChatAgataAPI.swift").read_text()
        method = api.split("func recoverChatAgata()")[1].split("func createChatAgata")[0]
        self.assertIn('"/api/chat-v1/agata/recovery"', method)
        self.assertIn("authenticated: true", method)
        self.assertNotIn("createChatAgata(", method)
        self.assertIn("enum State: String, Decodable", api)


if __name__ == "__main__":
    unittest.main()
