"""Offline source/provenance checks, not Swift compilation or executed UIKit tests."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "ios/TalkHint/Vendor/Orb"

# Hashes of upstream source at a48fc3382ad40905ca4aa9691c6b504004740ad1,
# excluding #Preview blocks and whitespace. Local availability annotations are
# the only permitted declaration change. Tests never use the network.
UPSTREAM = {
    "OrbConfiguration.swift": "af59089822e3e2bdae5338c255a61b44fb972f609ecad032e9e3d0a50441af82",
    "RealisticShadows.swift": "5b97b2e3e42a670925e060ab68cfd4fcf659071f3b2022f703817414dc1f5e02",
    "OrbView.swift": "5b8464ece0b986ff6de7f5833b4c24e183c19a5812f0c937686508e7b59b4233",
    "ParticlesView.swift": "1b51c02e4da04f7e46f5f34db354a9e088d6bffc87dd49a4cb6b18b5f7b52172",
    "RotatingGlowView.swift": "2b201cd89f2f74ceecb07ea140efc9792ccbb2cc8f7779cf8352a7dc11ba4ad0",
    "WavyBlobView.swift": "d8af7594ac1c088e692186ccbfecd16350563cf195d247696cdfd2c46418b6dd",
}


class VoiceOrbSourceContracts(unittest.TestCase):
    def test_vendored_source_matches_pinned_upstream(self):
        self.assertEqual({p.name for p in VENDOR.glob("*.swift")}, set(UPSTREAM))
        for name, expected in UPSTREAM.items():
            text = (VENDOR / name).read_text()
            self.assertNotIn("#Preview", text, name)
            text = re.sub(r"@available\(iOS 17.0, \*\)\s*", "", text)
            digest = hashlib.sha256(re.sub(r"\s+", "", text).encode()).hexdigest()
            self.assertEqual(digest, expected, name)

    def test_all_vendored_types_are_availability_guarded(self):
        for path in VENDOR.glob("*.swift"):
            text = path.read_text()
            declarations = re.findall(
                r"(?m)^((?:public )?(?:struct|class|enum) \w+)", text
            )
            self.assertTrue(declarations, path.name)
            for declaration in declarations:
                self.assertIn("@available(iOS 17.0, *)\n" + declaration, text)

    def test_original_license_and_author_are_present(self):
        text = (VENDOR / "LICENSE").read_text()
        self.assertIn("Copyright (c) 2024 Siddhant Mehta", text)
        self.assertIn("Permission is hereby granted, free of charge", text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', text)
        self.assertIn("metasidd", (VENDOR / "README.md").read_text())

    def test_target_and_packages_remain_unchanged(self):
        project = (ROOT / "ios/project.yml").read_text()
        self.assertIn('iOS: "15.0"', project)
        self.assertNotIn("metasidd", project)
        self.assertFalse((VENDOR / "Package.swift").exists())
        for path in (ROOT / "ios/TalkHint").rglob("*.swift"):
            self.assertNotRegex(path.read_text(), r"(?m)^import Orb\s*$")

    def test_application_reference_is_guarded_and_fallback_is_independent(self):
        text = (ROOT / "ios/TalkHint/Chat/ChatVoiceOrbView.swift").read_text()
        self.assertIn("if #available(iOS 17, *)", text)
        self.assertEqual(text.count("OrbView(configuration:"), 1)
        fallback = text.split("private struct ChatVoiceFallbackCircle", 1)[1].split("#if DEBUG", 1)[0]
        self.assertNotIn("OrbView", fallback)
        self.assertIn("Circle()", fallback)
        self.assertIn("TimelineView", fallback)
        for forbidden in ["URLSession", "AVAudioSession", "AVAudioRecorder", "APIClient"]:
            self.assertNotIn(forbidden, text)

    def test_real_levels_and_accessibility_contract(self):
        text = (ROOT / "ios/TalkHint/Chat/ChatVoiceOrbView.swift").read_text()
        for value in ["value.isFinite", "min(1, max(0, value))", "accessibilityReduceMotion",
                      "scenePhase == .active", "paused: !pulsing", "showParticles: false"]:
            self.assertIn(value, text)
        self.assertNotIn("Double.random", text)


if __name__ == "__main__":
    unittest.main()
