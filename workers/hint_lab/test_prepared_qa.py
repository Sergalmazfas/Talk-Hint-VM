"""Offline preparation checks; fake LLMs and stage results, no provider requests."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from workers.hint_lab import pipeline as p
from workers.hint_lab.test_pipeline import SOURCE, ANALYSIS, LETTER


class PreparedQATests(unittest.TestCase):
    def call(self, values, qa=None, source=None):
        author = SimpleNamespace(model="offline-author")
        with patch("socket.socket.connect", side_effect=AssertionError("NETWORK_FORBIDDEN")), \
             patch.dict("os.environ", {"PLAB_QA_MODEL_OVERRIDE": ""}), \
             patch.object(p, "make_agent", side_effect=lambda role, goal, llm: SimpleNamespace(llm=llm)), \
             patch.object(p, "single_pass", side_effect=values) as stages:
            result = p.run(source or copy.deepcopy(SOURCE), llm=author, qa_llm=qa)
        return result, stages, author

    def test_separate_qa_only_when_explicit_same_author_for_letter(self):
        qa = SimpleNamespace(model="offline-qa")
        result, calls, author = self.call([(ANALYSIS, {}), (p.QA(verdict="accepted", issues=[]), {}), (LETTER, {})], qa)
        self.assertIs(calls.call_args_list[0].args[0].llm, author)
        self.assertIs(calls.call_args_list[1].args[0].llm, qa)
        self.assertIs(calls.call_args_list[2].args[0].llm, author)
        self.assertEqual(result["qa_model"], "injected_separate_llm")

    def test_default_still_same_llm_no_new_model_field(self):
        result, calls, author = self.call([(ANALYSIS, {}), (p.QA(verdict="accepted", issues=[]), {}), (LETTER, {})])
        self.assertIs(calls.call_args_list[1].args[0].llm, author)
        self.assertNotIn("qa_model", result)

    def test_qa_failure_never_falls_back_to_author(self):
        qa = SimpleNamespace(model="offline-qa")
        result, calls, _ = self.call([(ANALYSIS, {}), RuntimeError("OFFLINE_QA_FAILURE"), (LETTER, {})], qa)
        self.assertEqual(result["qa_status"], "НЕ ПРОВЕРЕНО QA")
        self.assertEqual(calls.call_count, 3)
        self.assertIs(calls.call_args_list[1].args[0].llm, qa)

    def test_both_roles_get_identical_frozen_problem_history(self):
        source = copy.deepcopy(SOURCE)
        source["problem_history"] = {"version": 1, "status": "partial", "source_revision": 908,
                                    "problems": [{"problem_id": "trigger", "attempts": []}]}
        _, calls, _ = self.call([(ANALYSIS, {}), (p.QA(verdict="accepted", issues=[]), {}), (LETTER, {})],
                                SimpleNamespace(model="offline-qa"), source)
        raw = json.dumps(source, ensure_ascii=False)
        self.assertIn(raw, calls.call_args_list[0].args[1])
        self.assertIn(raw, calls.call_args_list[1].args[1])

    def test_node_supplied_model_constructs_qa_with_same_provider_key(self):
        author, qa = SimpleNamespace(model="offline-author"), SimpleNamespace(model="offline-qa")
        with patch("socket.socket.connect", side_effect=AssertionError("NETWORK_FORBIDDEN")), \
             patch.dict("os.environ", {"PLAB_QA_MODEL_OVERRIDE": "gpt-5.4-2026-03-05",
                                      "LAB_MODEL": "gpt-5.2", "OPENAI_API_KEY": "offline-fake"}), \
             patch.object(p, "LLM", return_value=qa) as factory, \
             patch.object(p, "make_agent", side_effect=lambda role, goal, llm: SimpleNamespace(llm=llm)), \
             patch.object(p, "single_pass", side_effect=[(ANALYSIS, {}), (p.QA(verdict="accepted", issues=[]), {}), (LETTER, {})]):
            result = p.run(copy.deepcopy(SOURCE), llm=author)
        factory.assert_called_once_with(model="openai/gpt-5.4-2026-03-05", api_key="offline-fake",
                                        timeout=180, max_retries=0)
        self.assertEqual(result["qa_model"], "gpt-5.4-2026-03-05")

    def test_identical_injected_qa_rejected(self):
        same = SimpleNamespace(model="offline")
        with patch.dict("os.environ", {"PLAB_QA_MODEL_OVERRIDE": ""}):
            with self.assertRaisesRegex(ValueError, "QA_LLM_MUST_DIFFER"):
                p.run(copy.deepcopy(SOURCE), llm=same, qa_llm=same)

    def test_same_model_in_different_instances_is_not_separate_model(self):
        with self.assertRaisesRegex(ValueError, "QA_MODEL_MUST_DIFFER"):
            self.call([], SimpleNamespace(model="openai/offline-author"))

    def test_unknown_injected_model_identity_rejected(self):
        with self.assertRaisesRegex(ValueError, "QA_MODEL_IDENTITY_REQUIRED"):
            self.call([], SimpleNamespace())

    def test_unknown_or_author_equal_model_rejected_without_request(self):
        for model in ("unknown", "gpt-5.2"):
            with patch.dict("os.environ", {"PLAB_QA_MODEL_OVERRIDE": model, "LAB_MODEL": "gpt-5.2"}), \
                 patch.object(p, "LLM") as factory:
                with self.assertRaisesRegex(ValueError, "QA_MODEL_INVALID"):
                    p.run(copy.deepcopy(SOURCE), llm=SimpleNamespace(model="offline-author"))
                factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
