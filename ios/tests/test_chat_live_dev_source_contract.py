"""Source checks only; these are not substitutes for the Mac native gate."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LiveChatDevSourceContracts(unittest.TestCase):
    def test_google_dev_callback_is_isolated_and_button_is_available(self):
        import plistlib
        config = (ROOT / "ios/TalkHint/Config/AppConfig.swift").read_text()
        api = (ROOT / "ios/TalkHint/Networking/APIClient.swift").read_text()
        login = (ROOT / "ios/TalkHint/UI/LoginViewController.swift").read_text()
        project = (ROOT / "ios/project.yml").read_text()
        plist = plistlib.loads((ROOT / "ios/TalkHint/Info.plist").read_bytes())
        self.assertIn('oauthCallbackScheme = "talkhint-chatdev"', config)
        self.assertIn('oauthCallbackScheme = "talkhint"', config)
        self.assertIn('URLQueryItem(name: "client", value: "chatdev")', api)
        self.assertIn("callbackURLScheme: AppConfig.oauthCallbackScheme", login)
        self.assertIn("callbackURL.scheme == AppConfig.oauthCallbackScheme", login)
        self.assertIn('callbackURL.host == "auth"', login)
        self.assertNotIn("googleButton.isHidden = true", login)
        self.assertEqual(plist["CFBundleURLTypes"][0]["CFBundleURLSchemes"],
                         ["$(TALKHINT_OAUTH_SCHEME)"])
        self.assertIn("TALKHINT_OAUTH_SCHEME: talkhint-chatdev", project)
        self.assertIn("TALKHINT_OAUTH_SCHEME: talkhint\n", project)

    def test_explicit_dev_origin_never_falls_back_to_production(self):
        config = (ROOT / "ios/TalkHint/Config/AppConfig.swift").read_text()
        live = config.split("#elseif TALKHINT_CHAT_LIVE_DEV", 1)[1].split("#else", 1)[0]
        self.assertIn('host.hasSuffix(".replit.dev")', live)
        self.assertIn("preconditionFailure", live)
        self.assertNotIn("https://talkhint.app", live)

    def test_separate_install_and_compilation_flag(self):
        project = (ROOT / "ios/project.yml").read_text()
        self.assertIn("TALKHINT_CHAT_LIVE_DEV", project)
        self.assertIn("PRODUCT_BUNDLE_IDENTIFIER: app.talkhint.chatdev", project)
        self.assertIn("TalkHintChatLiveDev:", project)

    def test_live_login_path_does_not_register_push_or_open_main_tabs(self):
        scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()
        live = scene.split("private func showLiveChat(", 1)[1].split("#endif", 1)[0]
        self.assertIn("LoginViewController()", live)
        self.assertIn("liveApprovedScreen()", live)
        self.assertNotIn("PushManager", live)
        self.assertNotIn("CallManager", live)
        self.assertNotIn("makeMainTabController", live)
        app = (ROOT / "ios/TalkHint/App/AppDelegate.swift").read_text()
        self.assertIn("|| TALKHINT_CHAT_LIVE_DEV", app)

    def test_live_chat_uses_real_transport_and_owner_scoping(self):
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        live = chat.split("static func liveApprovedScreen()", 1)[1].split("#endif", 1)[0]
        self.assertIn("makeChatClient(scope:", live)
        self.assertIn("SessionStore.shared.token", live)
        self.assertIn("AppConfig.baseURL.absoluteString", live)
        self.assertIn("appearance: .approvedReference", live)
        self.assertNotIn("offline-preview", live)

    def test_mac_fixes_keep_shared_ancestor_and_loading_draft(self):
        chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        render = chat.split("let row = UIStackView(arrangedSubviews:", 1)[1]
        self.assertLess(render.index("messagesStack.addArrangedSubview(row)"),
                        render.index("bubble.widthAnchor.constraint"))
        self.assertIn("let unopenedDraft", chat)
        self.assertIn("messagesStack.translatesAutoresizingMaskIntoConstraints = false", chat)


if __name__ == "__main__":
    unittest.main()
