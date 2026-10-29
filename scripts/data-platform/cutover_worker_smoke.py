"""Offline production-worker entry tests. No DB connections, operations or app boot."""
import hashlib
import json
import pathlib
import subprocess

out = pathlib.Path("generated-artifacts/cutover-recovery")
worker = out / "dist/company-cutover-worker.js"
assert worker.is_file()
cases = []
for name, heap, prefix, expected in [
    ("production_2304_DATA_3GiB", 2304, ["env", "NODE_ENV=production"], 0),
    ("production_2048_DATA_3GiB", 2048, ["env", "NODE_ENV=production"], 0),
    ("missing_NODE_ENV", 2304, ["env", "-u", "NODE_ENV"], 1),
    ("missing_DATABASE_URL", 2304, ["env", "-u", "DATABASE_URL", "NODE_ENV=production"], 1),
]:
    command = prefix + ["python", "-I", "workers/hint_lab/limited_exec.py", "--kind", "import",
                        "--", "node", f"--max-old-space-size={heap}", str(worker), "--cutover-preflight"]
    result = subprocess.run(command, text=True, capture_output=True, timeout=30)
    diagnostics = []
    for line in result.stderr.splitlines():
        if line.startswith("CUTOVER_DIAGNOSTIC "):
            diagnostics.append(json.loads(line[len("CUTOVER_DIAGNOSTIC "):]))
    cases.append({"name": name, "heapMiB": heap, "DATABytes": 3 * 1024 ** 3,
                  "exitCode": result.returncode, "expectedExitCode": expected, "diagnostics": diagnostics,
                  "rawStderrIncluded": False, "stdoutIncluded": False,
                  "noDatabaseConnection": True, "noModelOrProviderCalls": True})
    assert result.returncode == expected, (name, result.returncode, diagnostics)
    assert diagnostics
assert any(d["stage"] == "preflight_complete" for d in cases[0]["diagnostics"])
assert cases[2]["diagnostics"][-1]["exceptionCode"] == "CUTOVER_NOT_APPROVED"
assert cases[3]["diagnostics"][-1]["exceptionCode"] == "CUTOVER_DATABASE_URL_UNAVAILABLE"
report = {"passed": True, "productionTouched": False, "source": str(worker),
          "workerSha256": hashlib.sha256(worker.read_bytes()).hexdigest(), "cases": cases,
          "limitation": "Offline entry/limits/env check, not production memory-at-failure or real production activation"}
(out / "WORKER_SMOKE.json").write_text(json.dumps(report, indent=2))
print(json.dumps({"passed": True, "cases": len(cases), "sourceBytes": worker.stat().st_size}))
