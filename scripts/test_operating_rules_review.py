"""Offline tests for the proposal package, not tests or acceptance of TalkHint."""
import copy
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

from operating_rules_review import prepare, apply_patch, build, OPS, FORM, FACTS


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = Path(os.environ.get("REVIEW_SNAPSHOT", "/tmp/talkhint-484-model.json"))
        cls.state = json.loads(cls.snapshot.read_text())
        cls.docs = {d["id"]: d for d in cls.state["documents"]}
        cls.origin = "https://example.replit.dev"

    def test_preparation_does_not_mutate_source(self):
        before = copy.deepcopy(self.state)
        prepare(self.state, self.origin)
        self.assertEqual(before, self.state)

    def test_uses_original_document_and_action_identities(self):
        patch, _, _ = prepare(self.state, self.origin)
        self.assertEqual({d["id"] for d in patch["documents"]}, {OPS, FORM})
        ids = {n["id"] for n in self.state["operatingModel"]["revisions"][-1]["data"]["nodes"]}
        self.assertTrue(all(n["id"] in ids for n in patch["nodeChanges"]))
        self.assertTrue(all(l["from"] in ids and l["to"] in ids for l in patch["linkAdditions"]))

    def test_periodic_handoffs_have_existing_receivers_and_returns(self):
        patch, _, _ = prepare(self.state, self.origin)
        links = self.state["operatingModel"]["revisions"][-1]["data"]["links"] + patch["linkAdditions"]
        for period in ["week", "month"]:
            receiver = "management-action-report-engineering-" + period
            self.assertTrue(any(l["from"] == "oncall-action-period-out" and l["to"] == receiver
                                and l["kind"] == "handoff" for l in links))
            self.assertTrue(any(l["from"] == receiver and l["to"] == "oncall-action-period"
                                and l["kind"] == "return" for l in links))

    def test_patch_preserves_actual_manual_pass_and_protocol(self):
        patch, _, _ = prepare(self.state, self.origin)
        old = json.loads(self.docs[OPS]["text"])
        new = apply_patch(old, patch["documents"][0]["jsonPatch"])
        self.assertEqual(new["manualPass"], old["manualPass"])
        self.assertEqual(new["trialProtocol"], old["trialProtocol"])
        self.assertFalse(new["reviewBasis"]["storedManualPassFound"])
        self.assertEqual(new["version"], 3)

    def test_forms_have_single_canonical_home(self):
        patch, _, _ = prepare(self.state, self.origin)
        packet = apply_patch(json.loads(self.docs[OPS]["text"]), patch["documents"][0]["jsonPatch"])
        form = apply_patch(json.loads(self.docs[FORM]["text"]), patch["documents"][1]["jsonPatch"])
        self.assertEqual(packet["dailyReportForm"]["documentId"], FORM)
        self.assertNotIn("shortReport", packet["dailyReportForm"])
        self.assertIn("week", form["periodicReports"])
        self.assertIn("month", form["periodicReports"])
        self.assertEqual(len(form["coverageMap"]["domains"]), 10)
        self.assertTrue(all(s["status"] == "не проверено" for s in form["coverageMap"]["systems"]))
        self.assertIsNone(form["calculationRules"]["deliveryHour"])

    def test_historical_measurements_are_not_reinvented(self):
        _, journal, _ = prepare(self.state, self.origin)
        facts = json.loads(self.docs[FACTS]["text"])
        for call, case in zip(facts["calls"], journal["cases"]):
            self.assertEqual(case["sourceCallId"], call["callSid"])
            self.assertEqual(case["evidence"]["sentAck"], call["latency"]["hintsSent"])
            self.assertIsNone(case["acceptance"])
            self.assertFalse(case["newRunPerformed"])
        self.assertEqual(journal["cases"][2]["ownerUsedHints"], 0)
        self.assertFalse(journal["decisionsOrAcceptancesCreated"])

    def test_stale_model_and_document_versions_fail_closed(self):
        changed = copy.deepcopy(self.state)
        changed["revision"] += 1
        with self.assertRaises(AssertionError):
            prepare(changed, self.origin)
        with self.assertRaises(AssertionError):
            apply_patch({"version": 3}, [{"op": "test", "path": "/version", "value": 2}])

    def test_candidate_reading_budget(self):
        text = Path("docs/reviews/operating-rules-v3/replit.candidate.md").read_text()
        rules = text.split("## Краткий технический обзор")[0]
        self.assertLessEqual(len(rules.split()), 850)
        self.assertLess(len(text), 15000)
        self.assertIn("Правила v3 прочитаны", rules)

    def test_export_zip_valid_and_no_independent_forms(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = build(self.snapshot, Path(tmp) / "package", self.origin)
            with zipfile.ZipFile(path) as z:
                self.assertIsNone(z.testzip())
                self.assertIn("ops.proposed.patch.json", z.namelist())
                self.assertNotIn("daily-report.json", z.namelist())
                manifest = json.loads(z.read("manifest.json"))
                self.assertFalse(manifest["modelWritten"])
                self.assertFalse(manifest["mailSent"])
                for name in z.namelist():
                    if name.endswith(".json"):
                        json.loads(z.read(name))


if __name__ == "__main__":
    unittest.main()
