"""Offline review packager. Reads evidence/files only. No DB or environment access."""
import csv
import hashlib
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path

out = Path("generated-artifacts/data-platform-postpublish1")
sha = lambda b: hashlib.sha256(b).hexdigest()
old_diff = json.loads(Path("generated-artifacts/data-platform-publish-1/SCHEMA_DIFF.json").read_text())
statements = old_diff["statementsToExecute"]
names = sorted({m.group(1) for sql in statements
                if (m := re.search(r'CREATE TABLE (?:IF NOT EXISTS )?"?(company_[a-z0-9_]+)"?', sql))})
assert len(names) == 85
counts = {r["table_name"]: int(r["row_count"]) for r in
          csv.DictReader(io.StringIO((out / "PRODUCTION_COUNTS.txt").read_text()))}
assert all(counts[n] == 0 for n in names)
comparison = {}
constraint_differences = []
for part in ["COLUMNS", "CONSTRAINTS", "INDEXES"]:
    snapshots = {}
    for env in ["DEV", "PRODUCTION"]:
        lines = (out / f"{env}_{part}.txt").read_text().splitlines()[1:]
        relevant = sorted(line for line in lines if line.split(",", 1)[0] in names)
        assert relevant
        snapshots[env] = "\n".join(relevant) + "\n"
    comparison[part.lower()] = {
        "equal": snapshots["DEV"] == snapshots["PRODUCTION"],
        "devSha256": sha(snapshots["DEV"].encode()),
        "productionSha256": sha(snapshots["PRODUCTION"].encode()),
        "rows": len(snapshots["PRODUCTION"].splitlines()),
    }
    if part != "CONSTRAINTS":
        assert comparison[part.lower()]["equal"]
    else:
        parsed = {}
        for env in ["DEV", "PRODUCTION"]:
            parsed[env] = {(r[0], r[1]): r[2] for r in csv.reader(io.StringIO(snapshots[env]))}
        assert parsed["DEV"].keys() == parsed["PRODUCTION"].keys()
        for key, definition in parsed["DEV"].items():
            other = parsed["PRODUCTION"][key]
            if definition != other:
                assert not key[0].startswith("company_v3_")
                assert definition == other + " DEFERRABLE INITIALLY DEFERRED"
                constraint_differences.append({"table": key[0], "constraint": key[1],
                                               "dev": definition, "production": other})
    v3_dev = "\n".join(x for x in snapshots["DEV"].splitlines() if x.startswith("company_v3_"))
    v3_prod = "\n".join(x for x in snapshots["PRODUCTION"].splitlines() if x.startswith("company_v3_"))
    comparison[part.lower()]["v3Equal"] = v3_dev == v3_prod
    assert comparison[part.lower()]["v3Equal"]
assert len(constraint_differences) == 11
schema = {
    "passed": False, "status": "REVIEW_REQUIRED: 11 B constraint differences; v3 exact",
    "newTables": names, "tableCount": len(names), "allNewTablesEmpty": True,
    "prepublishCommands": len(statements), "definitions": comparison,
    "schemaDigest": sha(json.dumps(comparison, sort_keys=True, separators=(",", ":")).encode()),
    "noRemainingPublishDiff": not json.loads((out / "PUBLISH_STATE.json").read_text())["diffAfterPublish"]["hasDiff"],
    "priorOldTableRowCountsAvailable": False,
    "oldRowCountEquality": "NOT_PROVEN; no pre-Publish counts",
    "constraintDifferences": constraint_differences,
    "v3DefinitionsMatch": True,
    "unusedBActivationAllowed": False,
}
assert schema["noRemainingPublishDiff"]
(out / "SCHEMA_CHECK.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2))
(out / "SCHEMA_DIFFERENCES.md").write_text(
    "# Отличия схем после Publish №1\n\n"
    "Обычный Publish diff пуст, но pg_constraint показывает 11 отличий.\n"
    "В Dev все перечисленные FK — DEFERRABLE INITIALLY DEFERRED;\n"
    "в production — немедленная проверка. Колонки/индексы совпадают.\n"
    "Все 45 таблиц v3 совпадают по проверенным определениям.\n"
    "Таблицы B остаются пустым неиспользуемым архивом; включать B нельзя.\n"
    "Полное совпадение 85 таблиц НЕ подтверждено. Исправлений DDL не выполняли.\n\n"
    "| Таблица B | Ограничение |\n|---|---|\n" +
    "".join(f"| {d['table']} | {d['constraint']} |\n" for d in constraint_differences) +
    "\nОфициальная документация не дала объяснения поддержки deferred-FK "
    "в Publish diff. Это наблюдаемое расхождение, а не доказанная причина "
    "или утверждение о неподдерживаемой возможности. Нужна отдельная сверка; "
    "production SQL-скриптом не исправлять.\n")
probe = json.loads((out / "DEV_PROBE.json").read_text())
assert probe["passed"] and all(x["fullResponseDigestMatches"] for x in probe["results"])
assert all(probe["checks"].values()) and not probe["productionTouched"]
baseline = json.loads(Path("generated-artifacts/data-platform-B2/INITIAL_READBACK.json").read_text())
assert probe["sourceProof"]["semanticHash"] == baseline["sourceHash"]
doc_counts = {}
for d in baseline["documents"]:
    doc_counts[d["hypothesis"]] = doc_counts.get(d["hypothesis"], 0) + 1
freshness = {
    "freshRead": probe["sourceProof"], "acceptedBaselineSameFullSemanticHash": True,
    "documentInventoryFromSameHashAcceptedBaseline": doc_counts,
    "totalDocuments": len(baseline["documents"]),
    "newCountryCountInFreshRead": probe["sourceProof"]["documents"],
    "notAProductionTransferManifest": True, "mustRecomputeBeforeImport": True,
}
assert freshness["totalDocuments"] == 84
(out / "SOURCE_FRESHNESS.json").write_text(json.dumps(freshness, ensure_ascii=False, indent=2))
tests = json.loads((out / "UNIT_TESTS.json").read_text())
assert tests["success"] and tests["numFailedTests"] == 0
validation = {
    "unitPassed": tests["numPassedTests"], "unitSkipped": tests["numPendingTests"],
    "unitFailed": tests["numFailedTests"], "scopedSuites": "companyData/projectModel/productCrew",
    "typescript": "PASS (whole project noEmit)", "gitDiffCheck": "PASS",
    "devWorkflowRestarted": True, "publicLandingScreenshot": "PASS",
    "signedInBookUiVerified": False, "productionImportRun": False,
    "schemaMatch": "V3_MATCH; 11 UNUSED_B_FK_DIFFERENCES_REQUIRE_REVIEW",
}
(out / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
readme = Path("docs/data-platform/POST_PUBLISH_1.md").read_bytes()
sources = [
    "server/companyData/v3/transport.ts", "server/companyData/v3/importApproval.ts",
    "server/companyData/v3/importRoutes.ts", "server/companyData/v3/importRoutes.test.ts",
    "server/companyData/v3/commands.ts", "server/companyData/v3/responseCache.ts",
    "server/companyData/v3/responseCache.test.ts", "server/projectModel/repository.ts",
    "server/projectModel/routes.ts", "server/projectModel/strategyRoutes.test.ts",
    "scripts/data-platform/postpublish1_probe.ts", "scripts/data-platform/test_b2_transport.ts",
    "scripts/data-platform/package_postpublish1.py",
]
entries = {"README.md": readme}
for name in [
    "PRODUCTION_COLUMNS.txt", "DEV_COLUMNS.txt", "PRODUCTION_CONSTRAINTS.txt",
    "DEV_CONSTRAINTS.txt", "PRODUCTION_INDEXES.txt", "DEV_INDEXES.txt",
    "PRODUCTION_COUNTS.txt", "PUBLISH_STATE.json", "RUNTIME_COUNTS.txt", "CONTROL_SUMMARY.txt",
    "RUNTIME_READINESS.md", "SCHEMA_CHECK.json", "SCHEMA_DIFFERENCES.md",
    "DEV_PROBE.json", "SOURCE_FRESHNESS.json", "VALIDATION.json",
]:
    entries[f"evidence/{name}"] = (out / name).read_bytes()
entries["evidence/UNIT_TEST_SUMMARY.json"] = json.dumps({
    k: tests[k] for k in ["success", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"]
}, indent=2).encode()
for source in sources:
    entries[f"code/{source}"] = Path(source).read_bytes()
tracked = subprocess.check_output(["git", "diff", "--", *sources, ".agents/memory/data-platform-direction.md"])
new = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "--", *sources]).decode().splitlines()
for source in new:
    p = subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", source], capture_output=True)
    assert p.returncode == 1
    tracked += p.stdout
entries["CODE_DIFF.patch"] = tracked
entries["CHECKSUMS.sha256"] = "".join(f"{sha(b)}  {n}\n" for n, b in sorted(entries.items())).encode()
archive = out / "TalkHint_post_Publish_1_review_v1.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for name, content in entries.items():
        z.writestr(name, content)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name, content in entries.items():
        assert sha(z.read(name)) == sha(content)
print(json.dumps({"archive": str(archive), "files": len(entries),
                  "sha256": sha(archive.read_bytes()), "schemaDigest": schema["schemaDigest"]}))
