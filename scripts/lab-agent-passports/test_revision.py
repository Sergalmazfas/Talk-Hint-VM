"""Proposal-only R1-R5 regression checks; no model requests."""
import hashlib
import json
import socket
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from jsonschema import Draft202012Validator, ValidationError
from revise import expand

OUT = Path("generated-artifacts/lab-agent-passports-v2")
OLD = Path("generated-artifacts/lab-agent-passports")


def load(file):
    return json.loads(Path(file).read_text())


class RevisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guard = patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden"))
        cls.guard.start()
        cls.revision = load(OUT / "REVISION.json")
        cls.documents = {d["id"]: json.loads(d["text"]) for d in cls.revision["documents"]}
        cls.index = load(OUT / "PACKAGE.json")
        cls.roles = [load(OUT / (code + ".json")) for code in ("P.LAB", "P.LG.QA")]
        cls.source = load(OUT / "source-model.json")
        cls.sources = {d["id"]: d for d in cls.source["documents"]}
        cls.base = json.loads(cls.sources[cls.index["baselineRef"]]["text"])

    @classmethod
    def tearDownClass(cls):
        cls.guard.stop()

    def test_r1_mission_precedes_unchanged_common_guards(self):
        for role in self.roles:
            text = role["prompt"]["backstory"]
            self.assertTrue(text.startswith("МИССИЯ"))
            self.assertIn(self.base["commonBackstoryVerbatim"], text)
            self.assertIn("1–3 конкретных улучшения", text)
            self.assertIn("Одно главное слабое звено", text)
            self.assertLess(text.index("1. Время от конца"), text.index("2. Доля использованных"))
            self.assertLess(text.index("2. Доля использованных"), text.index("3. Ведёт ли"))
            self.assertLess(text.index("3. Ведёт ли"), text.index("4. Можно ли"))
            self.assertLess(text.index("4. Можно ли"), text.index("5. Перевод"))
            self.assertIn("не сочиняй дефект", text)

    def test_r2_is_contract_not_fake_resource_activation(self):
        contract = self.index["problemHistoryInputContract"]
        self.assertIn("not_implemented", contract["status"])
        self.assertEqual(contract["sameBlockTo"], ["P.LAB", "P.LG.QA"])
        self.assertFalse(self.index["activationGate"]["allowed"])
        self.assertIn("before", contract["fields"])
        self.assertIn("after", contract["fields"])
        self.assertIn("source_revision", contract["fields"])
        for code in ("P.LAB", "P.LG.QA"):
            text = load(OUT / (code + ".json"))["prompt"]["backstory"]
            self.assertIn("истори", text.lower())
        resource = next(r for r in self.index["resources"] if r["id"] == "proposal:verified-lesson-context")
        self.assertIn("not_implemented_or_granted", resource["status"])

    def test_r3_shared_schema_voice_and_negative_examples(self):
        schema = self.index["visualPassportSchema"]
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
        for role in self.roles:
            visual = role["visualPassport"]
            validator.validate(visual)
            self.assertTrue(visual["character"]["howISpeak"]["examplesAreIllustrative"])
            bad = json.loads(json.dumps(visual))
            del bad["character"]["howISpeak"]
            with self.assertRaises(ValidationError):
                validator.validate(bad)
        self.assertIn("не говори «так не бывает", self.roles[0]["prompt"]["backstory"])

    def test_r4_and_r2_only_pending_decisions(self):
        self.assertEqual([d["id"] for d in self.index["ownerDecisions"]], ["R2", "R4"])
        for d in self.index["ownerDecisions"]:
            self.assertIsNone(d["decision"])
            self.assertIn("Dev", d["scopeOfYes"])
        evidence = load(OUT / "QA_MODEL_EVIDENCE.json")
        self.assertEqual(evidence["model"], "gpt-5.4-2026-03-05")
        self.assertEqual(evidence["calibrationMatched"], 20)
        self.assertIn("не новая", evidence["scope"])
        self.assertEqual(evidence["newCalls"], 0)

    def test_r5_names_no_status_colour_meaning(self):
        self.assertEqual(self.roles[0]["visualPassport"]["roleColor"]["value"], "#1E4E79")
        for r in self.roles:
            self.assertIsNone(r["visualPassport"]["selectedName"])
            self.assertEqual(r["visualPassport"]["roleColor"]["status"], "proposed")
            self.assertIsNone(r["visualPassport"]["portrait"]["asset"])

    def test_exact_expansion_and_unchanged_runtime_contracts(self):
        for role in self.roles:
            stored = self.documents[role["documentId"]]
            actual = expand(stored, self.base["commonBackstoryVerbatim"], self.index["lessons"])
            self.assertEqual(actual, role["prompt"]["backstory"])
            self.assertEqual(hashlib.sha256(actual.encode()).hexdigest(),
                             stored["prompt"]["backstory"]["expandedSha256"])
            old = load(OLD / (role["roleCode"] + ".json"))
            self.assertEqual(role["prompt"]["configuration"], old["prompt"]["configuration"])
            self.assertEqual(role["prompt"]["tasks"], old["prompt"]["tasks"])
            self.assertEqual(role["actionBindings"], old["actionBindings"])
            self.assertEqual(role["visualPassport"]["reportsTo"], old["visualPassport"]["reportsTo"])
            self.assertEqual(role["visualPassport"]["reviewedBy"], old["visualPassport"]["reviewedBy"])
            self.assertFalse(role["runtimeActivation"])
            self.assertEqual(role["trialProtocol"], [])
            self.assertIsNone(role["manualAcceptance"])
        self.assertEqual(self.index["lessons"], load(OLD / "LESSONS.json"))

    def test_pass_preserved_new_protocol_empty(self):
        upload = Path("attached_assets/0_Prompts_pass_rev904_v1_1793220762393.zip")
        with zipfile.ZipFile(upload) as z:
            self.assertEqual(z.read("TRIAL_PROTOCOL_PASS.json"), (OUT / "TRIAL_PROTOCOL_PASS_v1.json").read_bytes())
            self.assertEqual(z.read(next(n for n in z.namelist() if n.endswith(".md"))),
                             (OUT / "01_Проход_промптов_v1.md").read_bytes())
        self.assertEqual(load(OUT / "TRIAL_PROTOCOL.json")["trialProtocol"], [])
        self.assertIsNone(self.index["manualAcceptance"])

    def test_only_existing_proposal_ids_current_revision(self):
        self.assertEqual(self.revision["sourceRevision"], self.source["revision"])
        self.assertEqual(set(self.documents), {self.index["documentId"],
            "DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"})
        for id, doc in self.documents.items():
            self.assertIn(id, self.sources)
            self.assertEqual(doc["version"], 2)
            self.assertFalse(doc["runtimeActivation"])
            self.assertLess(len(json.dumps(doc, ensure_ascii=False)), 50_000)
        evidence = load(OLD / "EVIDENCE.json")
        for file, digest in evidence["sourceFiles"].items():
            self.assertEqual(hashlib.sha256(Path(file).read_bytes()).hexdigest(), digest, file)


if __name__ == "__main__":
    unittest.main(verbosity=2)
