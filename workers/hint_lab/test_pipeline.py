"""Offline flow tests. They do not call a model or send mail."""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from crewai import LLM
from workers.hint_lab.pipeline import (
    Analysis, Finding, Letter, QA, run, validate_source, failure_diagnostic,
    RUBRIC_CONTRACT, RUBRIC_TEXT, rubric_contract,
)

SOURCE = json.loads(Path("workers/hint_lab/synthetic.json").read_text())
ANALYSIS = Analysis(summary_ru="Синтетический разбор", findings=[
    Finding(category="ошибочная", event_id="hint-2", evidence="Отказ от выезда",
            explanation="Подсказка противоречит цели")], limitations=["Нет reference"], proposals=[])
LETTER = Letter(summary_ru="Проверочный отчёт", quality_ru="Одна AI-оценка", limitations_ru=["Нет reference"], proposals_ru=[])


class FlowTests(unittest.TestCase):
    def call(self, values):
        with patch("socket.socket.connect", side_effect=AssertionError("NETWORK_FORBIDDEN")), \
                patch("workers.hint_lab.pipeline.single_pass", side_effect=values) as mocked:
            model = LLM(model="openai/gpt-5.2", api_key="offline-test-not-a-key")
            result = run(copy.deepcopy(SOURCE), llm=model)
        return result, mocked

    def test_happy_path_has_independent_agents_and_no_email(self):
        result, mocked = self.call([(ANALYSIS.model_copy(deep=True), {}), (QA(verdict="accepted", issues=[]), {}), (LETTER, {})])
        self.assertEqual(result["qa_status"], "QA: принято")
        self.assertIsNot(mocked.call_args_list[0].args[0], mocked.call_args_list[1].args[0])
        self.assertIs(mocked.call_args_list[0].args[0], mocked.call_args_list[2].args[0])
        self.assertEqual(result["mail_status"], "file_only")
        self.assertFalse(result["delivery_confirmed"])
        self.assertIsNone(result["metrics"]["wer"])
        self.assertIsNone(result["metrics"]["confirmed_missed_hints"])
        self.assertIn("не выполнен", mocked.call_args_list[1].args[1])

    def test_rubric_labels_and_meanings_match_schema_exactly(self):
        categories = Finding.model_json_schema()["properties"]["category"]["enum"]
        self.assertEqual(RUBRIC_CONTRACT["allowed_categories"], categories)
        self.assertEqual(list(RUBRIC_CONTRACT["meanings"]), categories)
        self.assertEqual(len(categories), 7)
        self.assertEqual(RUBRIC_CONTRACT["insufficient_data_category"], "неизвестно")
        self.assertIn("неизвестно", categories)
        self.assertNotIn("без полноты", categories)
        self.assertEqual(RUBRIC_CONTRACT["not_categories"], ["без полноты"])
        self.assertTrue(all(RUBRIC_CONTRACT["meanings"].values()))

    def test_author_reviewer_and_letter_get_identical_explicit_rubric(self):
        _, mocked = self.call([(ANALYSIS.model_copy(deep=True), {}),
                               (QA(verdict="accepted", issues=[]), {}), (LETTER, {})])
        for call in mocked.call_args_list:
            agent, prompt, _ = call.args
            self.assertEqual(prompt.count(RUBRIC_TEXT), 1)
            self.assertIn(RUBRIC_TEXT, agent.backstory)
            self.assertIn("НЕ отдельная категория", prompt)
            self.assertIn("Допустимая категория не гарантирует правильности оценки", prompt)

    def test_manual_diagnostic_brief_reaches_both_independent_roles(self):
        from workers.hint_lab import pipeline
        source = copy.deepcopy(SOURCE)
        source["manual_diagnostic"] = {"version": 1, "answers": [{"id": "D1", "answer": "неизвестно"}]}
        source["deterministic"] = {"recorded_attempts": 24}
        with patch("socket.socket.connect", side_effect=AssertionError("NETWORK_FORBIDDEN")), \
                patch("workers.hint_lab.pipeline.single_pass", side_effect=[
                    (ANALYSIS.model_copy(deep=True), {}), (QA(verdict="accepted", issues=[]), {}), (LETTER, {}),
                ]) as mocked:
            result = pipeline.run(source, llm=LLM(model="openai/gpt-5.2", api_key="offline-test-not-a-key"))
        self.assertEqual(result["qa_status"], "QA: принято")
        self.assertIn("Ответь в summary_ru отдельно на все D1–D5", mocked.call_args_list[0].args[1])
        self.assertIn("Независимо проверь ответы D1–D5", mocked.call_args_list[1].args[1])
        self.assertNotIn("Ответь в summary_ru отдельно на все D1–D5", mocked.call_args_list[1].args[1])
        self.assertNotIn("D1–D5", mocked.call_args_list[2].args[1])

    def test_schema_and_rubric_drift_fails_before_any_model_request(self):
        schema = copy.deepcopy(Finding.model_json_schema())
        schema["properties"]["category"]["enum"].append("без полноты")
        with patch.object(Finding, "model_json_schema", return_value=schema):
            with self.assertRaisesRegex(ValueError, "^RUBRIC_SCHEMA_MISMATCH$"):
                rubric_contract()

    def test_unknown_category_is_valid_but_acceptance_still_comes_from_qa(self):
        unknown = ANALYSIS.model_copy(deep=True)
        unknown.findings[0].category = "неизвестно"
        unknown.findings[0].explanation = "Нет достаточных проверяемых данных."
        result, _ = self.call([(unknown, {}), (QA(verdict="accepted", issues=[]), {}), (LETTER, {})])
        self.assertEqual(result["analysis"]["findings"][0]["category"], "неизвестно")
        self.assertEqual(result["qa_status"], "QA: принято")

    def test_disputed_rubric_objection_is_preserved_not_overruled_into_acceptance(self):
        issue = "Категория неизвестно недопустима, заменить на без полноты"
        values = []
        for _ in range(3):
            values += [(ANALYSIS.model_copy(deep=True), {}), (QA(verdict="returned", issues=[issue]), {})]
        result, mocked = self.call(values + [(LETTER, {})])
        self.assertEqual(result["qa_status"], "QA: расхождения не устранены")
        self.assertEqual(result["qa_issues"], [issue])
        self.assertEqual(result["qa_returns"], 2)
        self.assertEqual(mocked.call_count, 7)

    def test_qa_failure_does_not_block_letter(self):
        result, _ = self.call([(ANALYSIS.model_copy(deep=True), {}), RuntimeError("offline QA failure"), (LETTER, {})])
        self.assertEqual(result["qa_status"], "НЕ ПРОВЕРЕНО QA")
        self.assertEqual(result["qa_returns"], 0)

    def test_two_returns_then_unresolved_no_endless_loop(self):
        values = []
        for _ in range(3):
            values += [(ANALYSIS.model_copy(deep=True), {}), (QA(verdict="returned", issues=["Вернуть"]), {})]
        result, mocked = self.call(values + [(LETTER, {})])
        self.assertEqual(result["qa_returns"], 2)
        self.assertEqual(mocked.call_count, 7)
        self.assertEqual(result["qa_status"], "QA: расхождения не устранены")

    def test_unknown_mode_and_other_owner_rejected_before_model(self):
        for overrides in [{"mode": "translator"}, {"owner_verified": False}, {"processing_authorized": False},
                          {"owner_verified": "true"}, {"ended_at": None}]:
            with self.assertRaises(ValueError):
                validate_source({**SOURCE, **overrides})

    def test_invented_reference_to_event_fails(self):
        bad = ANALYSIS.model_copy(deep=True)
        bad.findings[0].event_id = "made-up"
        with self.assertRaisesRegex(ValueError, "UNKNOWN_EVIDENCE_EVENT"):
            self.call([(bad, {})])

    def test_false_missed_hint_is_explicitly_rejected_not_counted(self):
        bad = ANALYSIS.model_copy(deep=True)
        bad.findings[0].category = "пропуск"
        result, _ = self.call([(bad, {}), (QA(verdict="accepted", issues=[]), {}), (LETTER, {})])
        self.assertEqual(result["analysis"]["findings"][0]["category"], "неизвестно")
        self.assertIn("отклонена", result["analysis"]["limitations"][-1])
        self.assertIsNone(result["metrics"]["confirmed_missed_hints"])

    def test_safe_diagnostics_never_include_exception_text(self):
        for error, code in [(TimeoutError("PRIVATE"), "MODEL_TIMEOUT"),
                            (ValueError("UNKNOWN_EVIDENCE_EVENT"), "UNKNOWN_EVIDENCE_EVENT"),
                            (RuntimeError("PRIVATE token and prompt"), "MODEL_OR_INPUT_FAILURE")]:
            value = failure_diagnostic(error)
            self.assertEqual(value["code"], code)
            self.assertNotIn("PRIVATE", json.dumps(value))

    def test_schema_diagnostics_identify_fields_without_echoing_model_input(self):
        try:
            Analysis.model_validate({"summary_ru": "PRIVATE source"})
        except Exception as error:
            error.lab_schema = "Analysis"
            error.lab_output_shape = "object"
            error.lab_output_chars = 10626
            details = failure_diagnostic(error)
        self.assertEqual(details["schema"], "Analysis")
        self.assertEqual(details["output_shape"], "object")
        self.assertEqual(details["output_chars"], 10626)
        self.assertIn("findings", str(details["schema_issues"]))
        self.assertNotIn("PRIVATE", json.dumps(details))


if __name__ == "__main__":
    unittest.main()
