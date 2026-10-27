"""Offline contract checks; HTTP is an in-process fake, sockets are forbidden."""
import json
import socket
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from openai import OpenAI
from pydantic import ValidationError

from workers.hint_lab.pipeline import (
    Analysis, Finding, QA, Letter, LLM, make_agent, single_pass, stage_pass,
    failure_diagnostic,
)


RUBRIC = ["верная", "бесполезная", "ошибочная", "выдумка", "дубль", "пропуск", "неизвестно"]
PAYLOAD = {
    "summary_ru": "Искусственный пример, не реальный звонок",
    "findings": [{"category": "верная", "event_id": "fixture-1",
                  "evidence": "Искусственное основание", "explanation": "Проверка контракта"}],
    "limitations": ["Нет реального звонка"], "proposals": [],
}


class OutputContractTests(unittest.TestCase):
    def setUp(self):
        self.no_socket = patch.object(socket.socket, "connect", side_effect=AssertionError("NETWORK_FORBIDDEN"))
        self.no_socket.start()
        self.addCleanup(self.no_socket.stop)

    def model(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        sdk = OpenAI(api_key="offline-test-not-a-key", base_url="https://offline.invalid/v1",
                     http_client=client, max_retries=0)
        self.addCleanup(sdk.close)
        # The pinned provider builds sync and async clients from shared parameters;
        # a sync http_client cannot be passed to both. Replace only its sync getter.
        model = LLM(model="openai/gpt-5.2", api_key="offline-test-not-a-key",
                    base_url="https://offline.invalid/v1", max_retries=0)
        getter = patch.object(type(model), "_get_sync_client", return_value=sdk)
        getter.start()
        self.addCleanup(getter.stop)
        return model

    def test_all_rubric_values_and_only_those_values_are_valid(self):
        for category in RUBRIC:
            self.assertEqual(Finding(**{**PAYLOAD["findings"][0], "category": category}).category, category)
        for category in ["правильная", "без полноты", "good", "верная ", "", None, 1]:
            with self.subTest(category=category), self.assertRaises(ValidationError):
                Finding(**{**PAYLOAD["findings"][0], "category": category})

    def test_nested_and_top_level_extra_fields_are_rejected(self):
        for payload in [
            {**PAYLOAD, "qa_status": "QA: принято"},
            {**PAYLOAD, "findings": [{**PAYLOAD["findings"][0], "override": True}]},
        ]:
            with self.assertRaises(ValidationError):
                Analysis.model_validate(payload)
        for schema in (Finding, Analysis, QA, Letter):
            self.assertFalse(schema.model_json_schema()["additionalProperties"])

    def test_task_requests_native_schema_without_converter_fallback(self):
        model = self.model(lambda _: self.fail("kickoff must be stubbed"))
        agent = make_agent("offline author", "contract only", model)
        agent.agent_executor = SimpleNamespace(
            state=SimpleNamespace(current_answer=SimpleNamespace(output=Analysis.model_validate(PAYLOAD))))
        with patch("workers.hint_lab.pipeline.Crew.kickoff",
                   return_value=SimpleNamespace(raw=json.dumps(PAYLOAD), pydantic=None,
                                                json_dict=None, token_usage=None)) as kickoff:
            with patch("workers.hint_lab.pipeline.Task", wraps=__import__(
                    "workers.hint_lab.pipeline", fromlist=["Task"]).Task) as task_factory:
                parsed, _ = single_pass(agent, "Искусственный пример", Analysis)
        self.assertEqual(parsed.summary_ru, PAYLOAD["summary_ru"])
        self.assertIs(task_factory.call_args.kwargs["response_model"], Analysis)
        self.assertNotIn("output_pydantic", task_factory.call_args.kwargs)
        self.assertNotIn("output_json", task_factory.call_args.kwargs)
        kickoff.assert_called_once()

    def test_installed_provider_emits_strict_enum_to_mock_http(self):
        requests = []

        def handler(request):
            self.assertEqual(request.url.host, "offline.invalid")
            body = json.loads(request.content)
            requests.append(body)
            return httpx.Response(200, json={
                "id": "offline-completion", "object": "chat.completion", "created": 0,
                "model": "gpt-5.2", "choices": [{"index": 0, "finish_reason": "stop",
                    "message": {"role": "assistant", "content": json.dumps(PAYLOAD)}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })

        model = self.model(handler)
        parsed = model.call([{"role": "user", "content": "offline fixture"}], response_model=Analysis)
        self.assertIsInstance(parsed, Analysis)
        self.assertEqual(len(requests), 1)
        contract = requests[0]["response_format"]
        self.assertEqual(contract["type"], "json_schema")
        self.assertTrue(contract["json_schema"]["strict"])
        schema = contract["json_schema"]["schema"]
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["$defs"]["Finding"]["properties"]["category"]["enum"], RUBRIC)
        self.assertFalse(schema["$defs"]["Finding"]["additionalProperties"])

    def test_invalid_response_still_fails_without_repair_or_category_replacement(self):
        model = self.model(lambda _: self.fail("No provider request allowed in parser test"))
        invalid = {**PAYLOAD, "findings": [{**PAYLOAD["findings"][0], "category": "правильная"}]}
        agent = make_agent("offline author", "contract only", model)
        try:
            Analysis.model_validate(invalid)
        except ValidationError as error:
            provider_error = error
        with patch("workers.hint_lab.pipeline.Crew.kickoff", side_effect=provider_error) as kickoff:
            with self.assertRaises(ValidationError) as error:
                stage_pass("analysis", agent, "Искусственный пример", Analysis)
        details = failure_diagnostic(error.exception)
        self.assertEqual(details["schema"], "Analysis")
        self.assertEqual(details["schema_issues"], [{
            "fields": ["findings", 0, "category"], "type": "literal_error",
        }])
        self.assertEqual(invalid["findings"][0]["category"], "правильная")
        kickoff.assert_called_once()

    def test_valid_json_without_native_result_is_not_accepted(self):
        model = self.model(lambda _: self.fail("No provider request allowed in fallback test"))
        agent = make_agent("offline author", "contract only", model)
        agent.agent_executor = SimpleNamespace(
            state=SimpleNamespace(current_answer=SimpleNamespace(output=json.dumps(PAYLOAD))))
        with patch("workers.hint_lab.pipeline.Crew.kickoff",
                   return_value=SimpleNamespace(raw=json.dumps(PAYLOAD), pydantic=None,
                                                json_dict=None, token_usage=None)) as kickoff:
            with self.assertRaisesRegex(ValueError, "^NATIVE_OUTPUT_REQUIRED$"):
                single_pass(agent, "Искусственный пример", Analysis)
        kickoff.assert_called_once()

    def test_real_crew_path_reaches_native_provider_schema_offline(self):
        requests = []

        def handler(request):
            body = json.loads(request.content)
            requests.append(body)
            self.assertLessEqual(len(requests), 6, "Unexpected framework request loop")
            content = json.dumps(PAYLOAD)
            if not body.get("response_format"):
                content = "Thought: Ready.\nFinal Answer: " + content
            return httpx.Response(200, json={
                "id": "offline-crew", "object": "chat.completion", "created": 0,
                "model": "gpt-5.2", "choices": [{"index": 0, "finish_reason": "stop",
                    "message": {"role": "assistant", "content": content}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })

        agent = make_agent("offline author", "contract only", self.model(handler))
        parsed, _ = single_pass(agent, "Искусственный пример", Analysis)
        self.assertEqual(parsed.findings[0].category, "верная")
        native_requests = [r for r in requests if r.get("response_format", {}).get("type") == "json_schema"]
        self.assertEqual(len(native_requests), 1)
        self.assertTrue(native_requests[0]["response_format"]["json_schema"]["strict"])

    def test_provider_rejects_invalid_enum_without_an_untyped_repair_request(self):
        requests = []
        invalid = {**PAYLOAD, "findings": [{**PAYLOAD["findings"][0], "category": "правильная"}]}

        def handler(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={
                "id": "offline-invalid", "object": "chat.completion", "created": 0,
                "model": "gpt-5.2", "choices": [{"index": 0, "finish_reason": "stop",
                    "message": {"role": "assistant", "content": json.dumps(invalid)}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })

        with self.assertRaises(ValidationError):
            self.model(handler).call([{"role": "user", "content": "offline fixture"}], response_model=Analysis)
        self.assertEqual(len(requests), 1)

    def test_unsupported_native_schema_is_an_error_not_a_plain_text_fallback(self):
        requests = []

        def handler(request):
            requests.append(json.loads(request.content))
            return httpx.Response(400, json={"error": {
                "message": "Offline fixture: schema unsupported", "type": "invalid_request_error",
                "param": "response_format", "code": "unsupported_parameter",
            }})

        from openai import BadRequestError
        with self.assertRaises(BadRequestError):
            self.model(handler).call([{"role": "user", "content": "offline fixture"}], response_model=Analysis)
        self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()
