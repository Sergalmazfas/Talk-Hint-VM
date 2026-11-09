from pathlib import Path
import re
import unittest
import plistlib

ROOT = Path(__file__).resolve().parents[2]


class ChatIPhoneSourceContracts(unittest.TestCase):
    def test_password_and_google_login_require_secure_save(self):
        login = (ROOT / "ios/TalkHint/UI/LoginViewController.swift").read_text()
        self.assertEqual(login.count("guard SessionStore.shared.save("), 2)
        self.assertEqual(login.count('NSLocalizedString("login.error.secure_storage"'), 2)

    def test_session_persistence_never_uses_defaults_for_token(self):
        secure = (ROOT / "ios/TalkHint/Auth/SessionCredentials.swift").read_text()
        self.assertIn("write(token, tokenKey), read(tokenKey) == token", secure)
        self.assertIn("guard userId != nil", secure)
        self.assertNotIn("defaults.set(token", secure)
        session = (ROOT / "ios/TalkHint/Auth/SessionStore.swift").read_text()
        self.assertIn("var token: String? { credentials.token }", session)

    def test_real_shell_has_chat_and_no_authentication_crash(self):
        scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        self.assertNotIn('preconditionFailure("AppDev chat', scene)
        self.assertIn("loggedIn && SessionStore.shared.isLoggedIn", scene)
        tabs = scene.split("func makeMainTabController(", 1)[1]
        self.assertIn("ChatEntryViewController()", tabs)
        self.assertNotIn("HomeViewController(mode: .copilot)", tabs)
        self.assertIn("ChatViewController.liveApprovedScreen()", tabs)

    def test_dev_launch_has_build_bound_origin_without_production_fallback(self):
        config = (ROOT / "ios/TalkHint/Config/AppConfig.swift").read_text()
        dev = config.split("#elseif TALKHINT_CHAT_LIVE_DEV", 1)[1].split("#else", 1)[0]
        self.assertIn('object(forInfoDictionaryKey: "TalkHintDevOrigin")', dev)
        self.assertNotIn("https://talkhint.app", dev)
        plist = plistlib.loads((ROOT / "ios/TalkHint/Info.plist").read_bytes())
        self.assertEqual(plist["TalkHintDevOrigin"], "$(TALKHINT_DEV_ORIGIN)")

    def test_new_error_is_localized_for_every_existing_language(self):
        for language in ("en", "es", "ru", "kk", "uk"):
            data = (ROOT / f"ios/TalkHint/Resources/{language}.lproj/Localizable.strings").read_text()
            self.assertEqual(len(re.findall(r'^"login.error.secure_storage"\s*=', data, re.M)), 1)


if __name__ == "__main__":
    unittest.main()
