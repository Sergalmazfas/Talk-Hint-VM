"""Freeze references to the existing 36 audio/VAD artifacts; no paid requests."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path

source = Path("generated-artifacts/hint-bench-repair")
target = Path("generated-artifacts/hint-polygon")
target.mkdir(exist_ok=True, parents=True, mode=0o700)
out = target / "private-manifest.json"
if out.exists():
    raise SystemExit("Manifest already frozen: refusing overwrite")
provenance = list(csv.DictReader(io.StringIO(json.loads((source / "audio-provenance-private.json").read_text())["output"])))
goals = {r["id"]: r.get("goal", "") for r in csv.DictReader(io.StringIO(json.loads((target / "private-goals.json").read_text())["output"])) if r.get("id")}
def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()
fixtures = []
for row in provenance:
    if len(row.get("id", "")) != 36:
        continue
    raw = (source / "vad" / (row["id"] + ".json")).read_bytes()
    vad = json.loads(raw)
    assert vad["fixtureWavMd5"] == row["wav_md5"]
    assert vad["automaticallyGenerated"] and not vad["humanVerified"]
    assert row["id"] in goals
    fixtures.append({
        "id": row["id"], "recordingSid": row["recording_sid"], "wavMd5": row["wav_md5"],
        "audioSha256": vad["audioSha256"], "goal": goals[row["id"]],
        "goalHash": sha(goals[row["id"]]), "durationMs": vad["durationMs"],
        "roles": json.loads(row["channel_roles"]), "vad": vad["channels"], "vadHash": sha(raw),
    })
assert len(fixtures) == len({r["id"] for r in fixtures}) == 36
identity = sorted([{"id": f["id"], "audio": f["audioSha256"], "vad": f["vadHash"], "goal": f["goalHash"], "roles": f["roles"]} for f in fixtures], key=lambda f: f["id"])
corpus_hash = sha(json.dumps(identity, ensure_ascii=False, separators=(",", ":")))
# Shortest recordings WITH a frozen goal first. All 36 remain in the corpus.
fixtures.sort(key=lambda f: (not bool(f["goal"]), f["durationMs"], f["id"]))
payload = {"format": "talkhint.hint-polygon.corpus.v1", "corpusHash": corpus_hash, "fixtures": fixtures,
           "consent": "Owner authorized these existing 36 recordings for internal lab; no new calls, no public audio export.",
           "vad": "Automatic, not human verified; original unpadded per-channel offsets."}
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    json.dump(payload, handle, ensure_ascii=False)
print(json.dumps({"fixtures": 36, "corpusHash": corpus_hash, "missingGoals": sum(not f["goal"] for f in fixtures),
                  "durationMinutes": sum(f["durationMs"] for f in fixtures)/60000}))
