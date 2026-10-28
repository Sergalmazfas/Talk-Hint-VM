"""Offline artifact validation, not a human/manual pass or model-based QA."""
import copy
import hashlib
import json
import re
import socket
import unittest
from pathlib import Path
from unittest.mock import patch

from jsonschema import Draft202012Validator, ValidationError

ROOT = Path("generated-artifacts/lab-agent-passports")


def load(name):
    return json.loads((ROOT / name).read_text())


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.network = patch.object(socket.socket, "connect", side_effect=AssertionError("NETWORK_FORBIDDEN"))
        cls.network.start()
        cls.current = load("CURRENT.json")
        cls.package = load("PACKAGE.json")
        cls.roles = [load("P.LAB.json"), load("P.LG.QA.json")]
        cls.model = load("source-model.json")
        cls.nodes = {n["id"]: n for n in cls.model["operatingModel"]["data"]["nodes"]}
        cls.validator = Draft202012Validator(load("visual-passport.schema.json"))

    @classmethod
    def tearDownClass(cls):
        cls.network.stop()

    def test_worker_and_export_are_byte_identical(self):
        data = Path("workers/hint_lab/pipeline.py").read_bytes()
        self.assertEqual(data, (ROOT / "pipeline.current.py").read_bytes())
        self.assertEqual(hashlib.sha256(data).hexdigest(), self.current["sha256"])
        self.assertEqual(self.current["externalModelCalls"], 0)

    def test_common_rubric_and_schemas_are_unchanged(self):
        from workers.hint_lab import pipeline as p
        self.assertEqual(self.current["commonBackstoryVerbatim"], p.BASE)
        self.assertEqual(self.current["rubricTextVerbatim"], p.RUBRIC_TEXT)
        self.assertEqual(self.current["rubric"], p.RUBRIC_CONTRACT)
        for name in ("Analysis", "QA", "Finding", "Letter"):
            self.assertEqual(self.current["schemas"][name], getattr(p, name).model_json_schema())
        self.assertEqual(len(self.current["rubric"]["allowed_categories"]), 7)
        self.assertEqual(self.current["qaReturns"], 2)

    def test_proposals_keep_guards_and_do_not_grant_tools(self):
        for r in self.roles:
            self.assertEqual(r["prompt"]["configuration"], self.current["agentConfiguration"])
            self.assertEqual(r["prompt"]["configuration"]["tools"], [])
            self.assertFalse(r["prompt"]["configuration"]["memory"])
            self.assertFalse(r["prompt"]["configuration"]["allow_delegation"])
            self.assertTrue(r["prompt"]["backstory"].startswith(self.current["commonBackstoryVerbatim"]))
            self.assertIn("23958", r["prompt"]["backstory"])
            for task in r["prompt"]["tasks"].values():
                self.assertTrue(task["nativeResponseModelRequired"])
                self.assertEqual(task["expectedOutput"], self.current["expectedOutputVerbatim"])

    def test_shared_visual_schema_valid_and_exactly_two_examples(self):
        Draft202012Validator.check_schema(load("visual-passport.schema.json"))
        self.assertEqual(len(self.roles), 2)
        for r in self.roles:
            self.validator.validate(r["visualPassport"])
            self.assertIsNone(r["visualPassport"]["selectedName"])
            self.assertIsNone(r["visualPassport"]["portrait"]["asset"])
            self.assertEqual(r["visualPassport"]["portrait"]["styleId"],
                             self.package["portraitStyle"]["id"])

    def test_visual_schema_rejects_trait_count_color_and_extra_fields(self):
        original = self.roles[0]["visualPassport"]
        for change in ("traits", "color", "extra"):
            bad = copy.deepcopy(original)
            if change == "traits":
                bad["character"]["traits"].append("Четвёртая черта")
            elif change == "color":
                bad["roleColor"]["value"] = "blue"
            else:
                bad["grantAllTools"] = True
            with self.assertRaises(ValidationError):
                self.validator.validate(bad)

    def test_hierarchy_is_source_bound_and_independent(self):
        for r in self.roles:
            self.assertEqual(r["visualPassport"]["reportsTo"]["roleId"],
                             self.nodes[r["roleId"]]["managerId"])
            check = r["visualPassport"]["reviewedBy"][0]
            self.assertNotEqual(check["roleId"], r["roleId"])
        self.assertEqual(self.roles[0]["visualPassport"]["reviewedBy"][0]["roleId"], "lg-qa-role")
        self.assertEqual(self.roles[1]["visualPassport"]["reviewedBy"][0]["roleId"],
                         self.nodes["lab-action-qa"]["acceptorId"])

    def test_actions_and_recipients_reuse_existing_ids(self):
        for r in self.roles:
            for a in r["actionBindings"]:
                original = self.nodes[a["id"]]
                for field in ("code", "roleId", "recipientId", "acceptorId", "inputs", "schedule"):
                    self.assertEqual(a[field], original.get(field))
            for id in r["activePipelineActionIds"]:
                self.assertEqual(self.nodes[id]["roleId"], r["roleId"])

    def test_lessons_are_dated_source_linked_and_not_claimed_accepted(self):
        lessons = {l["id"]: l for l in self.package["lessons"]}
        for r in self.roles:
            self.assertEqual(set(r["visualPassport"]["learnedLessons"]["lessonIds"]), set(lessons))
        for lesson in lessons.values():
            self.assertTrue(lesson["documentedAt"])
            self.assertTrue(lesson["sources"])
            self.assertFalse(lesson["ownerAcceptedAsNewLesson"])
            self.assertFalse(lesson["runtimeInjected"])
        evidence = load("EVIDENCE.json")
        self.assertIn("×4", evidence["method"]["requests"][0]["answer"])
        self.assertIn("REALTIME_ACCEL = 4", evidence["earHarnessExcerpt"])
        self.assertEqual(evidence["compact"]["revision"], 837)
        self.assertTrue(evidence["compact"]["historicalDocumentFound"])
        self.assertIn("photos", evidence["compact"]["manualEngineeringReview"]["issues"][0]["text"])
        self.assertFalse(evidence["compact"]["historicalIndependentQa"])

    def test_current_templates_reproduce_captured_tasks(self):
        captures = load("CURRENT_TASK_CAPTURES.json")
        self.assertEqual(set(captures), {"standard", "manual_diagnostic", "returned_twice", "qa_unavailable"})
        for name, c in captures.items():
            source = c["source"]
            diagnostic = (
                "\nЭто заказанный ручной диагностический разбор D1–D5: "
                "подавление, ACK без UI, задержка, потеря I see, перевод собеседника. "
                "Сверь manual_diagnostic с исходными hints/ui_visibility/latency_summary и deterministic. "
                "Это инженерные наблюдения, не готовая приёмка. Различай подтверждённый факт, "
                "гипотезу и неизвестную причину. Отсутствие отметки не доказывает непоказ; "
                "нет сравнимой базы — не утверждай рост задержки. Не придумывай тексты подавленных кандидатов."
                if name == "manual_diagnostic" else "")
            feedback = ""
            for e in c["tasks"]:
                values = {
                    "backstory": self.current["commonBackstoryVerbatim"],
                    "source_json": json.dumps(source, ensure_ascii=False),
                    "hint_ids_json": json.dumps([h["id"] for h in source.get("hints", [])]),
                    "author_brief": diagnostic + ("\nОтветь в summary_ru отдельно на все D1–D5." if diagnostic else ""),
                    "qa_brief": diagnostic + ("\nНезависимо проверь ответы D1–D5 и основания; ошибки перечисли в issues." if diagnostic else ""),
                    "qa_feedback_json": feedback,
                    **c["renderBindings"],
                }
                text = self.current["taskTemplates"][e["stage"]]
                for k, v in values.items():
                    text = text.replace("{{" + k + "}}", v)
                self.assertEqual(text, e["descriptionBeforeSchema"])
                self.assertTrue(e["taskDescriptionWithSchema"].startswith(e["descriptionBeforeSchema"]))
                self.assertIn(self.current["schemaSuffixVerbatim"], e["taskDescriptionWithSchema"])
                self.assertFalse(c["acceptanceEvidence"])
                if e["stage"] == "qa" and name == "returned_twice":
                    feedback = json.dumps(["SYNTHETIC FEEDBACK"], ensure_ascii=False)
            self.assertEqual(len(c["tasks"]), 7 if name == "returned_twice" else 3)

    def test_future_resources_do_not_claim_grants_or_browsing(self):
        resources = {r["id"]: r for r in self.package["resources"]}
        web = resources["proposal:public-doc-reader"]
        self.assertIn("not_granted", web["status"])
        self.assertTrue(all(s["availability"] == "not_fetched" for s in web["sources"]))
        history = resources["model-resource"]
        self.assertIn("после AI", history["access"])
        self.assertFalse(self.package["runtimeActivation"])

    def test_no_manual_pass_or_acceptance_fabricated(self):
        for obj in [self.package, *self.roles]:
            self.assertEqual(obj["trialProtocol"], [])
            self.assertIsNone(obj["manualAcceptance"])
            self.assertFalse(obj["runtimeActivation"])
            self.assertEqual(obj["status"], "proposed_not_active")

    def test_registration_does_not_replace_existing_passports(self):
        registration = load("REGISTRATION.json")
        old_ids = {d["id"] for d in self.model["documents"]}
        self.assertFalse(registration["runtimeActivation"])
        for d in registration["documents"]:
            self.assertNotIn(d["id"], old_ids)
            self.assertLessEqual(len(d["text"]), 50_000)
        self.assertEqual(registration["sourceRevision"], self.model["revision"])

    def test_canonical_shared_blocks_expand_to_exact_proposals(self):
        docs = {d["id"]: json.loads(d["text"]) for d in load("REGISTRATION.json")["documents"]}
        common = docs[self.package["baselineRef"]]["commonBackstoryVerbatim"]
        lessons = docs[self.package["documentId"]]["lessons"]
        for r in self.roles:
            c = docs[r["documentId"]]
            block = c["prompt"]["backstory"]
            expanded = common + "\n\n" + block["expertiseText"] + block["lessonHeader"] + "\n".join(
                f'{l["id"]} [{l["documentedAt"]}]: {l["rule"]}' for l in lessons)
            self.assertEqual(expanded, r["prompt"]["backstory"])
            self.assertEqual(hashlib.sha256(expanded.encode()).hexdigest(), block["expandedSha256"])
            self.assertEqual(c["actionBindings"]["nodeIds"], [a["id"] for a in r["actionBindings"]])

    def test_no_secret_patterns_in_deliverable_json(self):
        for name in ["CURRENT.json", "PACKAGE.json", "P.LAB.json", "P.LG.QA.json",
                     "EVIDENCE.json", "MODEL_LINKS.json", "RESOURCES.json"]:
            text = (ROOT / name).read_text()
            self.assertIsNone(re.search(r"sk-(?:proj-)?[A-Za-z0-9_-]{24,}|SG\.[\w-]{15,}\.|"
                                        r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|"
                                        r"postgres(?:ql)?://[^\s\"]+@", text), name)
        # Variable names and deliberately fake offline tokens are not credentials.


if __name__ == "__main__":
    unittest.main(verbosity=2)
