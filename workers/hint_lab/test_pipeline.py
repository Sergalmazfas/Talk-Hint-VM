"""Offline flow tests. They do not call a model or send mail."""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from crewai import LLM
from workers.hint_lab.pipeline import Analysis, Finding, Letter, QA, run, validate_source

SOURCE = json.loads(Path("workers/hint_lab/synthetic.json").read_text())
ANALYSIS = Analysis(summary_ru="Синтетический разбор", findings=[
    Finding(category="ошибочная", event_id="hint-2", evidence="Отказ от выезда",
            explanation="Подсказка противоречит цели")], limitations=["Нет reference"], proposals=[])
LETTER = Letter(summary_ru="Проверочный отчёт", quality_ru="Одна AI-оценка", limitations_ru=["Нет reference"], proposals_ru=[])


class FlowTests(unittest.TestCase):
    def call(self, values):
        model = LLM(model="openai/gpt-5.2", api_key="offline-test-not-a-key")
        with patch("workers.hint_lab.pipeline.single_pass", side_effect=values) as mocked:
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


if __name__ == "__main__":
    unittest.main()
