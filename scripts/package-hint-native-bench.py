"""Preparation evidence only. No audio, reference text, saved goals or credentials."""
import hashlib
import json
import zipfile
from pathlib import Path

root = Path("generated-artifacts/hint-native-bench")
source_files = sorted(Path("server/hintNativeBench").glob("*.ts")) + [
    Path("scripts/prepare-hint-native-bench.ts"),
    Path("scripts/package-hint-native-bench.py"),
    Path("docs/hint-native-bench-preparation.md"),
]
evidence_names = [
    "frozen-plan.json", "source-provenance.json", "protocol-registry.json",
    "series-ledger.json", "comparison.json", "comparison.csv",
    "checks/tests.json", "checks/tests.log", "checks/typecheck.log",
    "checks/script-typecheck.log", "checks/preparation.log",
    "checks/execute-blocked.json", "checks/isolation.json",
]
evidence = ([root / name for name in evidence_names] + sorted(root.glob("catalog-*.json"))
            + sorted((root / "preparation-history").glob("*.json")))
files = source_files + evidence
missing = [str(p) for p in files if not p.is_file()]
if missing:
    raise SystemExit("Evidence missing: " + ", ".join(missing))
plan = json.loads((root / "frozen-plan.json").read_text())
ledger = json.loads((root / "series-ledger.json").read_text())
tests = json.loads((root / "checks/tests.json").read_text())
isolation = json.loads((root / "checks/isolation.json").read_text())
if plan["paidExecutionAllowed"] or ledger["entries"]:
    raise SystemExit("Not a zero-spend preparation package")
if not tests["success"] or not isolation["oldFilesUnchanged"]:
    raise SystemExit("Local verification failed")
if (root / "checks/typecheck.log").read_text().strip() != "> rest-express@1.0.0 check\n> tsc":
    raise SystemExit("Typecheck did not finish cleanly")
if (root / "checks/script-typecheck.log").read_text().strip():
    raise SystemExit("Preparation script typecheck has output; reconcile before packaging")
manifest = {
    "status": "PREPARATION_ONLY_NOT_A_MODEL_COMPARISON",
    "paidRequests": 0,
    "sha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
}
archive = Path("generated-artifacts/Hint_native_bench_preparation.zip")
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for path in files:
        z.write(path, str(path))
    z.writestr("EVIDENCE-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    z.writestr("README.txt", (
        "Native Hint bench: PREPARATION ONLY.\n"
        "No paid requests, no measured latency/quality, no product activation.\n"
        "Start with docs/hint-native-bench-preparation.md.\n"
        "Gemini TEXT handshake NOT RUN. NOT_RUN is not UNSUPPORTED.\n"
        "The archive contains no source audio, reference texts or saved goals.\n"
    ))
print(json.dumps({"archive": str(archive), "files": len(files), "bytes": archive.stat().st_size}))
