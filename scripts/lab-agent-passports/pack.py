"""Final durable ZIP and machine-readable checks; requires successful registration."""
import hashlib
import json
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("generated-artifacts/lab-agent-passports")
registered = json.loads((ROOT / "REGISTERED.json").read_text())
assert registered["readerVerified"] and not registered["runtimeActivation"]
assert registered["activePassportsUnchanged"] and registered["operatingModelUnchanged"]
assert registered["oldCasesPreserved"]
evidence = json.loads((ROOT / "EVIDENCE.json").read_text())
for file, digest in evidence["sourceFiles"].items():
    assert hashlib.sha256(Path(file).read_bytes()).hexdigest() == digest, file

package_log = Path("/tmp/lab-agent-package-tests.log").read_text()
worker_log = Path("/tmp/lab-agent-existing-tests.log").read_text()
assert "Ran 14 tests" in package_log and package_log.rstrip().endswith("OK")
assert "Ran 23 tests" in worker_log and worker_log.rstrip().endswith("OK")
(ROOT / "package-tests.log").write_text(package_log)
(ROOT / "worker-tests.log").write_text(worker_log)
validation = {
    "checkedAt": datetime.now(timezone.utc).isoformat(),
    "sourceRevision": registered["sourceRevision"], "registeredRevision": registered["revision"],
    "packageVersion": 1, "runtimeActivation": False, "externalModelCalls": 0,
    "calls": 0, "emails": 0, "productionWrites": 0,
    "offlinePackageTests": {"passed": 14, "failed": 0, "network": "socket forbidden"},
    "existingWorkerTests": {"passed": 23, "failed": 0, "provider": "mock only"},
    "typeScript": "npm run check passed",
    "currentWorkerBytesUnchanged": True, "sourceFilesUnchanged": list(evidence["sourceFiles"]),
    "visualSchema": "Draft 2020-12 valid; both examples valid; invalid mutations rejected",
    "canonicalPromptExpansion": "exact text + SHA-256 verified for both roles",
    "allCapturedTaskTemplates": "standard/manual diagnostic/QA returns/QA unavailable reproduce original descriptions",
    "sourceReader": "ProductCrewService.get_document text equality before and after",
    "manualTrialProtocol": "empty; not executed", "independentNewQA": "not executed",
    "ownerAcceptance": None, "productionReadiness": "not checked",
    "publicLandingScreenshot": "loaded; existing application unchanged",
    "signedInUI": "not verified; authentication unchanged",
    "notAProof": ["No live quality improvement measured", "No screen/portrait generated",
                  "No resource or automatic memory enabled", "No claimed provider-wire inspection"],
}
(ROOT / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
readme = (ROOT / "README.md").read_text()
readme += (
    f"\n## Сохранено и выдано\nПредложение v1 зарегистрировано в new-country rev{registered['revision']}; "
    f"исходный снимок rev{registered['sourceRevision']}. "
    "Нормализованные документы с общими блоками — REGISTRATION.json; сохранение и чтение — REGISTERED.json. "
    "Верхнеуровневые JSON/TXT — точно проверенное развёртывание тех же блоков для ручного чтения, "
    "не отдельная живая модель. Старые случаи и активные паспорта сохранены.\n"
    "Полный ZIP: P_LAB_P_LG_QA_passports_v1.zip. Откройте READ_FIRST.html или README.md. "
    "Публикация сервера для чтения пакета не требуется.\n")
(ROOT / "README.md").write_text(readme)
schema = json.loads((ROOT / "PACKAGE.json").read_text())
(ROOT / "TRIAL_PROTOCOL.json").write_text(json.dumps({
    "format": "talkhint.lab-agent-prompts.manual-pass", "packageVersion": 1,
    "sourceRevision": registered["sourceRevision"], "registeredRevision": registered["revision"],
    "status": "not_started", "trialProtocol": [], "manualAcceptance": None,
    "rowFields": schema["trialProtocolRowSchema"], "checklist": schema["manualPassChecklist"],
    "instruction": "Заполняет владелец/независимый Claude; actual и evidence не имитировать.",
}, ensure_ascii=False, indent=2))
files = [
    "README.md", "READ_FIRST.html", "CURRENT.json", "pipeline.current.py", "CURRENT_TASK_CAPTURES.json",
    "PACKAGE.json", "P.LAB.json", "P.LG.QA.json", "P.LAB.proposed.txt", "P.LG.QA.proposed.txt",
    "P.LAB.diff", "P.LG.QA.diff", "visual-passport.schema.json", "LESSONS.json", "RESOURCES.json",
    "EVIDENCE.json", "MODEL_LINKS.json", "REGISTRATION.json", "REGISTERED.json",
    "TRIAL_PROTOCOL.json", "VALIDATION.json", "package-tests.log", "worker-tests.log",
]
hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
(ROOT / "SHA256SUMS.json").write_text(json.dumps(hashes, indent=2))
output = ROOT / "P_LAB_P_LG_QA_passports_v1.zip"
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in [*files, "SHA256SUMS.json"]:
        archive.write(ROOT / file, file)
    assert archive.testzip() is None
    for file, digest in hashes.items():
        assert hashlib.sha256(archive.read(file)).hexdigest() == digest
print(json.dumps({"file": str(output), "bytes": output.stat().st_size,
                  "sourceRevision": registered["sourceRevision"], "registeredRevision": registered["revision"],
                  "runtimeActivation": False}))
