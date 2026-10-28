"""Capture existing instructions with deterministic stubs; network is forbidden."""
import ast
import copy
import hashlib
import json
import socket
import subprocess
from pathlib import Path
from unittest.mock import patch

ROOT = Path("generated-artifacts/lab-agent-passports")


def capture():
    ROOT.mkdir(parents=True, exist_ok=True)
    with patch.object(socket.socket, "connect", side_effect=AssertionError("NETWORK_FORBIDDEN")):
        from crewai import LLM
        from workers.hint_lab import pipeline as p
        raw = Path("workers/hint_lab/pipeline.py").read_bytes()
        tree = ast.parse(raw.decode())
        parts = {n.name: ast.get_source_segment(raw.decode(), n)
                 for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        source = json.loads(Path("workers/hint_lab/synthetic.json").read_text())
        source["call_id"] = "SYNTHETIC_PROMPT_CAPTURE"
        source["synthetic"] = True
        schemas = {name: getattr(p, name).model_json_schema()
                   for name in ("Finding", "Analysis", "QA", "Letter")}
        baseline = {
            "format": "talkhint.lab-prompts.current", "version": 1,
            "sourceFile": "workers/hint_lab/pipeline.py",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "sourceScope": "Workspace source; deployed artifact/model/environment not inspected",
            "sourceGitRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
            "framework": {"name": "CrewAI", "pin": p.PIN, "cloud": False},
            "model": {"default": "gpt-5.2", "overrideVariable": "LAB_MODEL",
                      "actualProductionValue": None},
            "commonBackstoryVerbatim": p.BASE, "rubric": p.RUBRIC_CONTRACT,
            "rubricTextVerbatim": p.RUBRIC_TEXT, "schemas": schemas,
            "agentFactoryVerbatim": parts["make_agent"],
            "taskAndCrewFactoryVerbatim": parts["single_pass"],
            "runInstructionsVerbatim": parts["run"],
            "sourceValidationVerbatim": parts["validate_source"],
            "resultValidationVerbatim": parts["validate_findings"],
            "agentConfiguration": {"tools": [], "allow_delegation": False, "memory": False,
                                   "cache": False, "max_iter": 1, "max_retry_limit": 0,
                                   "max_execution_time": 240},
            "crewConfiguration": {"process": "sequential", "freshContextPerPass": True,
                                  "memory": False, "cache": False, "tracing": False,
                                  "share_crew": False, "planning": False},
            "expectedOutputVerbatim": "Только JSON по заданной схеме, без Markdown и лишних полей.",
            "schemaSuffixVerbatim": "\nВерни JSON, соответствующий этой схеме:\n",
            "taskTemplates": {
                "analysis": "{{backstory}}{{author_brief}}\nВходные данные:\n{{source_json}}\n"
                            "В findings разрешены только эти event_id: {{hint_ids_json}}. "
                            "Ограничения полноты/reference/latency писать только в limitations."
                            "\nПредыдущие замечания QA:\n{{qa_feedback_json}}",
                "qa": "{{backstory}}{{qa_brief}}\nНезависимо проверь исходные данные и разбор."
                      "\nСнимок:\n{{source_json}}\nLAB.8:\n{{replay_json}}\nРазбор:\n{{analysis_json}}",
                "letter": "{{backstory}}\nПодготовь краткое письмо. Не меняй статус QA."
                          "\nРазбор:\n{{analysis_json}}\nQA: {{qa_status}}"
                          "\nОграничения QA:\n{{qa_issues_json}}"
                          "\nLAB.8: не выполнен. WER и цена неизвестны.",
            },
            "qaReturns": 2, "nativeResponseModelRequired": True,
            "hiddenModelRepair": False, "replay": "not run",
            "roles": [], "captureIsSynthetic": True, "externalModelCalls": 0,
            "contextNotes": [
                "runInstructionsVerbatim preserves all dynamic interpolation and branches, unchanged.",
                "CURRENT_TASK_CAPTURES.json expands them with synthetic data, including feedback/QA failure.",
                "Task.description and Agent fields are captured, not alleged production provider-wire messages.",
                "CrewAI framework may add its own wrappers; no real provider request was made.",
                "Source builder provides owner-authorized text/telemetry; no audio/video/browser tool.",
                "productContext journal and previous reports attach after AI, not to its prompt.",
            ],
        }
        captures = {}
        for scenario in ("standard", "manual_diagnostic", "returned_twice", "qa_unavailable"):
            events = []
            sample = copy.deepcopy(source)
            if scenario == "manual_diagnostic":
                sample["manual_diagnostic"] = {"version": 1, "answers": []}
                sample["deterministic"] = {"recorded_attempts": 2}

            def fake(agent, description, schema):
                events.append({
                    "stage": p.CURRENT_STAGE, "role": agent.role, "goal": agent.goal,
                    "backstory": agent.backstory, "schemaName": schema.__name__,
                    "descriptionBeforeSchema": description,
                    "taskDescriptionWithSchema": description +
                        baseline["schemaSuffixVerbatim"] +
                        json.dumps(schema.model_json_schema(), ensure_ascii=False),
                    "expectedOutput": baseline["expectedOutputVerbatim"],
                    "synthetic": True,
                })
                if schema is p.Analysis:
                    return p.Analysis(summary_ru="SYNTHETIC CAPTURE, NOT A CALL REVIEW",
                                      findings=[], limitations=["Только перехват промпта"], proposals=[]), {}
                if schema is p.QA:
                    if scenario == "qa_unavailable":
                        raise RuntimeError("OFFLINE QA FIXTURE")
                    return p.QA(verdict="returned" if scenario == "returned_twice" else "accepted",
                                issues=["SYNTHETIC FEEDBACK"] if scenario == "returned_twice" else []), {}
                return p.Letter(summary_ru="SYNTHETIC", quality_ru="NOT EVALUATED",
                                limitations_ru=["OFFLINE CAPTURE"], proposals_ru=[]), {}

            with patch.object(p, "single_pass", side_effect=fake):
                result = p.run(sample, llm=LLM(model="openai/gpt-5.2", api_key="offline-test-not-a-key"))
            captures[scenario] = {"source": sample, "tasks": events, "fakeQaStatus": result["qa_status"],
                                  "renderBindings": {
                                      "analysis_json": p.Analysis(**result["analysis"]).model_dump_json(),
                                      "replay_json": json.dumps(result["replay"], ensure_ascii=False),
                                      "qa_status": result["qa_status"],
                                      "qa_issues_json": json.dumps(result["qa_issues"], ensure_ascii=False)},
                                  "acceptanceEvidence": False}
        for event in captures["standard"]["tasks"][:2]:
            baseline["roles"].append({k: event[k] for k in ("role", "goal", "backstory")})
        (ROOT / "CURRENT.json").write_text(json.dumps(baseline, ensure_ascii=False, indent=2))
        (ROOT / "CURRENT_TASK_CAPTURES.json").write_text(json.dumps(captures, ensure_ascii=False, indent=2))
        (ROOT / "pipeline.current.py").write_bytes(raw)
        return baseline


if __name__ == "__main__":
    result = capture()
    print(json.dumps({"sha256": result["sha256"], "externalModelCalls": 0, "runtimeChanged": False}))
