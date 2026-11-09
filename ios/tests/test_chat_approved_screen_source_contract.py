"""Static contracts only; these do not compile Swift or prove UIKit rendering."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ApprovedChatSourceContracts(unittest.TestCase):
    def setUp(self):
        self.chat = (ROOT / "ios/TalkHint/Chat/ChatViewController.swift").read_text()
        self.style = (ROOT / "ios/TalkHint/Chat/ChatScreenAppearance.swift").read_text()
        self.preview = (ROOT / "ios/TalkHint/Chat/ChatApprovedPreview.swift").read_text()
        self.scene = (ROOT / "ios/TalkHint/App/SceneDelegate.swift").read_text()

    def test_source_authority_is_the_large_owner_reference(self):
        spec = (ROOT / "docs/chat-1a/APPROVED_SCREEN_MEASUREMENTS.md").read_text()
        self.assertIn("0_IMG_4200_1793933763767.jpeg", spec)
        self.assertIn("assumption", spec)
        self.assertIn("not an exact", spec)

    def test_new_appearance_is_opt_in_not_connected_to_working_tabs(self):
        self.assertIn("appearance = .existing", self.chat)
        self.assertIn("appearance: ChatScreenAppearance = .existing", self.chat)
        self.assertIn("appearance: .approvedReference", self.preview)
        tabs = self.scene.split("func makeMainTabController(", 1)[1]
        self.assertNotIn("approvedReference", tabs)
        self.assertNotIn("ChatApprovedPreview", tabs)
        self.assertIn("#elseif TALKHINT_CHAT_PREVIEW", self.scene)

    def test_preview_is_native_local_and_explicitly_read_only(self):
        self.assertIn("APIClient(transport:", self.preview)
        self.assertNotIn("URLSession.shared", self.preview)
        self.assertIn('request.httpMethod == "GET"', self.preview)
        self.assertIn('"OFFLINE_PREVIEW_READ_ONLY"', self.preview)
        self.assertIn('"voice": ["available": false]', self.preview)
        self.assertIn('"ai": ["available": false]', self.preview)
        self.assertIn("app.talkhint.chat-reference-preview", self.preview)

    def test_menu_has_no_action_in_reference_screen(self):
        block = self.chat.split("// Match the reference's more glyph", 1)[1].split("for button in [back, menu]", 1)[0]
        self.assertIn("menu.removeTarget", block)
        self.assertIn("menu.isEnabled = false", block)
        self.assertIn('menu.accessibilityIdentifier = "chat-more-unavailable"', block)

    def test_readable_fonts_and_large_orb_are_concrete(self):
        self.assertIn("systemFont(ofSize: 20)", self.style)
        self.assertIn("systemFont(ofSize: 19)", self.style)
        self.assertIn("isApprovedReference ? 48 : 44", self.style)
        self.assertIn("UIFontMetrics", self.style)
        self.assertIn("lessThanOrEqualTo: scroll.frameLayoutGuide.widthAnchor", self.chat)

    def test_orb_is_outside_capsule_and_never_launches(self):
        self.assertIn("inputCard.trailingAnchor.constraint(equalTo: orb.leadingAnchor, constant: -10)", self.chat)
        self.assertIn("orbButton.isEnabled = false", self.chat)
        self.assertNotIn("orbButton.addTarget", self.chat)
        self.assertNotIn("orbButton.addAction", self.chat)
        self.assertIn("view.keyboardLayoutGuide.topAnchor", self.chat)

    def test_existing_dictation_pipeline_is_still_used(self):
        for value in ("requestRecordPermission", "isMeteringEnabled = true",
                      "recorder.updateMeters()", "api.prepareTranscribe",
                      "dictation.finish", "composer.becomeFirstResponder()"):
            self.assertIn(value, self.chat)
        self.assertIn("Visual state fixture only", self.chat)
        self.assertIn("#if DEBUG", self.chat)

    def test_preview_configuration_skips_phone_and_push_startup(self):
        app = (ROOT / "ios/TalkHint/App/AppDelegate.swift").read_text()
        project = (ROOT / "ios/project.yml").read_text()
        self.assertIn("#if TALKHINT_NATIVE_VALIDATION || TALKHINT_CHAT_PREVIEW", app)
        self.assertIn("TalkHintChatPreview:", project)
        self.assertIn("config: ChatPreview", project)
        self.assertIn("DEBUG TALKHINT_CHAT_PREVIEW", project)

    def test_native_checks_are_registered_not_claimed_executed(self):
        verifier = (ROOT / "ios/scripts/verify-xcresult.py").read_text()
        self.assertIn('"ChatApprovedScreenTests":', verifier)
        tests = (ROOT / "ios/TalkHintTests/ChatApprovedScreenTests.swift").read_text()
        self.assertIn("XCTAttachment(image: image)", tests)
        self.assertIn("attachment.lifetime = .keepAlways", tests)
        self.assertIn("testSeparateOrbAndLargeControlsFitSmallScreen", tests)


if __name__ == "__main__":
    unittest.main()
