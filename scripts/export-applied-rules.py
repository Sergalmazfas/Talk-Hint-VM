"""Export actual approved results and verify served data; no service writes."""
import difflib
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

before = json.loads(Path("/tmp/talkhint-rules-apply-before.json").read_text())
after = json.loads(Path("/tmp/talkhint-rules-final.json").read_text())
old_docs = {d["id"]: d for d in before["documents"]}
docs = {d["id"]: d for d in after["documents"]}
ids = ["DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-TALKHINT-PRODUCT-PASSPORT",
       "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d"]
checks = {}
for id in ids:
    rpc = json.loads(Path(f"/tmp/applied-{id}.json").read_text())["result"]
    assert not rpc["isError"]
    value = rpc["structuredContent"]["result"]
    assert value["text"] == docs[id]["text"]
    checks[id] = {"sameAsSaved": True, "tool": "get_document", "httpStatus": 200}
for id in ["DOC-POPS-WORK-PACKAGE", "DOC-POPS-DAILY-REPORT"]:
    assert docs[id] == old_docs[id]
old_nodes = {n["id"]: n for n in before["operatingModel"]["revisions"][-1]["data"]["nodes"]}
new_data = after["operatingModel"]["revisions"][-1]["data"]
for n in new_data["nodes"]:
    if n["id"].startswith("oncall-") or n["id"] == "management-role-operations-specialist" or n.get("roleId") == "management-role-operations-specialist":
        assert n == old_nodes[n["id"]]
assert new_data["links"] == before["operatingModel"]["revisions"][-1]["data"]["links"]
book = docs[ids[1]]
parsed = json.loads(book["text"].split("<!-- TALKHINT-PRODUCT-BOOK-V2 -->")[1].strip())
old_book = json.loads(old_docs[ids[1]]["text"].split("<!-- TALKHINT-PRODUCT-BOOK-V2 -->")[1].strip())
assert parsed["version"] == 14
assert parsed["features"] == old_book["features"]
assert parsed["previousPassport"] == old_book["previousPassport"]
journal = json.loads(docs[ids[0]]["text"])
assert journal["version"] == 2 and len(journal["cases"]) == 4
assert Path("replit.md").read_bytes() == Path("docs/reviews/operating-rules-v3/replit.candidate.md").read_bytes()
out = Path("generated-artifacts/operating-rules-applied/package")
out.mkdir(parents=True, exist_ok=True)
(out / "replit.md").write_bytes(Path("replit.md").read_bytes())
(out / "README.md").write_bytes(Path("docs/reviews/operating-rules-v3/APPLIED.md").read_bytes())
(out / "journal.json").write_text(json.dumps(journal, ensure_ascii=False, indent=2))
sha = lambda data: hashlib.sha256(data).hexdigest()
original_manifest = json.loads(Path("generated-artifacts/operating-rules-review/package/manifest.json").read_text())
for name in ["replit.md", ".agents/memory/project-model-direction.md",
             ".agents/memory/process-on-call.md", ".agents/memory/hint-lab-release-boundary.md"]:
    old = subprocess.check_output(["git", "show", "HEAD:" + name]).decode()
    assert sha(old.encode()) == original_manifest["protectedSourceHashes"][name], "Unexpected baseline"
    new = Path(name).read_text()
    diff = "".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), name + " before", name + " after"))
    (out / (Path(name).stem + ".diff")).write_text(diff)
origin = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
links = [{
    "id": id, "title": docs[id]["title"],
    "url": f"{origin}/api/product-crew/documents/{id}/download?format=json",
    "mcp": {"name": "get_document", "arguments": {"documentId": id}},
} for id in ids]
summary = {
    "fromRevision": before["revision"], "revision": after["revision"], "rulesVersion": 3,
    "operatingVersion": after["operatingModel"]["revisions"][-1]["version"],
    "journalVersion": 2, "bookVersion": 14, "roadmapVersion": 25,
    "opsDocumentsAndActionsUnchanged": True, "linksUnchanged": True,
    "bookReaderVersion": parsed["version"], "featureAndOriginalPassportPreserved": True,
    "documentReadChecks": checks, "testsPassed": 8,
    "runtimeChanged": False, "modelCalls": 0, "mailSent": False,
    "opsPassFileAvailable": False, "signedInUiVisuallyVerified": False,
}
(out / "application.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
(out / "links.json").write_text(json.dumps(links, ensure_ascii=False, indent=2))
assert not any(p.name == "ops.proposed.patch.json" for p in out.iterdir())
for p in out.glob("*.json"):
    json.loads(p.read_text())
(out / "FILES.sha256").write_text("".join(f"{sha(p.read_bytes())}  {p.name}\n" for p in sorted(out.iterdir()) if p.name != "FILES.sha256"))
archive = out.parent / "TalkHint_rules_v3_applied_rev828.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(out.iterdir()):
        z.write(p, p.name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(json.dumps({"file": str(archive), "sha256": sha(archive.read_bytes()), **summary}, ensure_ascii=False))
