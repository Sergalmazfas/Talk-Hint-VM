"""Run the complete configured test set in disjoint parts; retain every result."""
import json
import pathlib
import subprocess
import time

root = pathlib.Path(".")
out = root / "generated-artifacts/company-cutover-secure/tests"
out.mkdir(parents=True, exist_ok=True)
files = sorted(root.glob("server/**/*.test.ts")) + sorted(root.glob("client/src/lib/secretary-lab*.test.ts"))
groups = {}
for path in files:
    parts = path.parts
    key = parts[1] if len(parts) > 2 and parts[0] == "server" else "server-root"
    if parts[0] == "client":
        key = "client"
    groups.setdefault(key, []).append(str(path))
report = {"configuredFiles": len(files), "parts": [], "finished": False}
for name, paths in groups.items():
    start = time.monotonic()
    command = ["npx", "vitest", "run", *paths, "--maxWorkers=1", "--reporter=json",
               f"--outputFile={out / (name + '.json')}"]
    with (out / (name + ".log")).open("w") as log:
        try:
            code = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=1200).returncode
        except subprocess.TimeoutExpired:
            code = 124
    report["parts"].append({"name": name, "files": paths, "exitCode": code,
                            "seconds": round(time.monotonic() - start, 3)})
    (out / "RUN.json").write_text(json.dumps(report, indent=2))
    print(name, len(paths), code, round(time.monotonic() - start, 1), flush=True)
report["finished"] = True
totals = {"passed": 0, "failed": 0, "pending": 0, "todo": 0}
seen = []
for part in report["parts"]:
    result = out / (part["name"] + ".json")
    if result.exists():
        data = json.loads(result.read_text())
        for suite in data.get("testResults", []):
            seen.append(suite["name"])
            for assertion in suite.get("assertionResults", []):
                status = assertion["status"]
                totals[status] = totals.get(status, 0) + 1
report["totals"] = totals
report["resultFiles"] = len(seen)
report["uniqueResultFiles"] = len(set(seen))
report["allPartsExitedZero"] = all(p["exitCode"] == 0 for p in report["parts"])
(out / "RUN.json").write_text(json.dumps(report, indent=2))
print(json.dumps({k: report[k] for k in ["configuredFiles", "resultFiles", "uniqueResultFiles", "totals", "allPartsExitedZero"]}), flush=True)
raise SystemExit(0 if report["allPartsExitedZero"] and len(set(seen)) == len(files) else 1)
