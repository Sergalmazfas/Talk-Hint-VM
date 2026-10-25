"""The owner's phone run is production; native validation remains isolated."""
import pathlib
import re
import unittest


class ProductionRunProfileTests(unittest.TestCase):
    def test_phone_run_does_not_inherit_a_dev_backend(self):
        project = pathlib.Path(__file__).resolve().parents[2] / "project.yml"
        schemes = project.read_text().split("\nschemes:\n", 1)[1]
        run = schemes.split("\n  TalkHint:\n", 1)[1]
        self.assertRegex(run, r"run:\s*\n\s+config: Debug")
        self.assertIn("TALKHINT_API_BASE_URL: https://talkhint.app", run)
        self.assertNotIn("replit.dev", run)

    def test_validation_scheme_does_not_inherit_production_run_environment(self):
        project = pathlib.Path(__file__).resolve().parents[2] / "project.yml"
        schemes = project.read_text().split("\nschemes:\n", 1)[1]
        validation = schemes.split("  TalkHintValidation:\n", 1)[1].split("\n  TalkHint:\n", 1)[0]
        self.assertIn("config: NativeValidation", validation)
        self.assertNotIn("https://talkhint.app", validation)
        self.assertNotIn("TALKHINT_API_BASE_URL", validation)


if __name__ == "__main__":
    unittest.main()
