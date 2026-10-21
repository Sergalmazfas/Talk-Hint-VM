"""These are helper tests, NOT evidence of an iOS build or XCTest execution."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    path = Path(__file__).resolve().parents[1] / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sources = load("verify-project-sources")
results = load("verify-xcresult")


class SourceMembershipTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.objects = {}
        for name in ("TalkHint", "TalkHintTests"):
            folder = self.root / name
            folder.mkdir()
            (folder / "Example.swift").write_text("// fixture")
            self.objects[name] = dict(isa="PBXNativeTarget", name=name, buildPhases=[name + "phase"])
            self.objects[name + "group"] = dict(isa="PBXGroup", path=name, children=[name + "file"])
            self.objects[name + "file"] = dict(isa="PBXFileReference", path="Example.swift")
            self.objects[name + "build"] = dict(fileRef=name + "file")
            self.objects[name + "phase"] = dict(isa="PBXSourcesBuildPhase", files=[name + "build"])
        self.project = dict(objects=self.objects)

    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()):
            sources.verify(self.project, self.root)

    def test_complete_target_membership_passes(self):
        self.verify()

    def test_new_file_not_in_generated_project_fails(self):
        (self.root / "TalkHint" / "New.swift").write_text("// omitted")
        with self.assertRaisesRegex(ValueError, "missing="):
            self.verify()

    def test_duplicate_compile_sources_fails(self):
        self.objects["TalkHintphase"]["files"] *= 2
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.verify()

    def test_test_file_exclusion_fails(self):
        self.objects["TalkHintTestsphase"]["files"] = []
        with self.assertRaisesRegex(ValueError, "missing="):
            self.verify()

    def test_foreign_target_file_fails(self):
        self.objects["TalkHintphase"]["files"].append("TalkHintTestsbuild")
        with self.assertRaisesRegex(ValueError, "unexpected="):
            self.verify()


class XCTestEvidenceTests(unittest.TestCase):
    def run_evidence(self, status="succeeded", test_status="Success", omit=False, omit_cards=False):
        root = {"actions": {"_values": [{"actionResult": {
            "status": {"_value": status}, "testsRef": {"id": {"_value": "tests"}}
        }}]}}
        tests = [{"identifier": {"_value": suite}, "subtests": {"_values": [
            {"identifier": {"_value": method + "()"}, "testStatus": {"_value": test_status}}
            for method in methods[(1 if omit and suite == "CallProfilesTests" else 0):]
        ]}} for suite, methods in results.REQUIRED_TESTS.items()
            if not (omit_cards and suite == "KnowledgeCardsTests")]
        with patch.object(results, "read_result", side_effect=[root, tests]):
            with contextlib.redirect_stdout(io.StringIO()):
                results.verify("fixture.xcresult")

    def test_successful_required_tests_pass(self):
        self.run_evidence()

    def test_skipped_tests_are_not_success(self):
        with self.assertRaisesRegex(ValueError, "Missing successful"):
            self.run_evidence(test_status="Skipped")

    def test_missing_isolation_test_fails(self):
        with self.assertRaisesRegex(ValueError, "Missing successful"):
            self.run_evidence(omit=True)

    def test_missing_cards_suite_fails(self):
        with self.assertRaisesRegex(ValueError, "Missing successful KnowledgeCardsTests"):
            self.run_evidence(omit_cards=True)

    def test_failed_action_fails(self):
        with self.assertRaisesRegex(ValueError, "did not succeed"):
            self.run_evidence(status="failed")

    def test_missing_tests_reference_fails(self):
        root = {"actions": {"_values": [{"actionResult": {"status": {"_value": "succeeded"}}}]}}
        with patch.object(results, "read_result", return_value=root):
            with self.assertRaisesRegex(ValueError, "Missing successful"):
                results.verify("fixture.xcresult")


if __name__ == "__main__":
    unittest.main()
