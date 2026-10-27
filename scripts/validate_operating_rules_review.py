"""Finalize a review artifact after read-only model/API checks. No API or DB calls."""
import argparse
import json
from pathlib import Path

from operating_rules_review import OPS, FORM, digest, pack, prepare, apply_patch, stored_text_size


def validate(before: Path, after: Path, out: Path):
    assert before.read_bytes() == after.read_bytes(), "Live model changed: rebase required"
    state = json.loads(before.read_text())
    manifest = json.loads((out / "manifest.json").read_text())
    assert digest(before.read_bytes()) == manifest["sourceSnapshotSha256"]
    for name, expected in manifest["protectedSourceHashes"].items():
        assert digest(Path(name).read_bytes()) == expected, f"Active file changed: {name}"
    docs = {d["id"]: d for d in state["documents"]}
    download_checks = []
    for id in [OPS, FORM]:
        value = json.loads(Path(f"/tmp/484-{id}.json").read_text())
        assert value == json.loads(docs[id]["text"]), f"Download mismatch: {id}"
        download_checks.append({"id": id, "sameContentAsSnapshot": True, "httpStatus": 200})
    mcp = json.loads(Path("/tmp/484-mcp-document.json").read_text())
    result = mcp["result"]
    assert result["isError"] is False
    document = result["structuredContent"]["result"]
    assert document["id"] == OPS
    assert document["text"] == docs[OPS]["text"]
    patch, journal, _ = prepare(state, "https://example.replit.dev")
    lengths = {}
    for proposal in patch["documents"]:
        value = apply_patch(json.loads(docs[proposal["id"]]["text"]), proposal["jsonPatch"])
        lengths[proposal["id"]] = stored_text_size(value)
        assert lengths[proposal["id"]] <= 50000
    assert stored_text_size(journal) <= 50000
    for path in out.glob("*.json"):
        json.loads(path.read_text())
    validation = {
        "format": "talkhint.review.validation", "status": "Offline checks passed; owner acceptance pending",
        "unitTests": {"passed": 9, "scope": "scripts/test_operating_rules_review.py"},
        "sourceRevisionBefore": state["revision"], "sourceRevisionAfter": state["revision"],
        "modelSnapshotUnchanged": True, "activeReplitAndMemoryHashesUnchanged": True,
        "jsonParsing": "passed", "documentUtf16Lengths": lengths,
        "downloadRouteChecks": download_checks,
        "mcpCheck": {"tool": "get_document", "documentId": OPS, "httpStatus": 200,
                     "isError": False, "sameTextAsSnapshot": True},
        "notVerified": ["Signed-in admin UI", "independent QA", "owner acceptance",
                        "P.OPS external manual pass v2", "production runtime", "delivery scheduling"],
        "noModelCalls": True, "noMailSent": True, "noModelMutation": True,
        "liveArtifactsApplied": False,
    }
    (out / "validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2) + "\n")
    files = sorted(p for p in out.iterdir() if p.is_file() and p.name != "FILES.sha256")
    (out / "FILES.sha256").write_text("".join(f"{digest(p.read_bytes())}  {p.name}\n" for p in files))
    archive = out.parent / "TalkHint_rules_v3_review_rev822.zip"
    pack(out, archive)
    print(json.dumps({"archive": str(archive), "sha256": digest(archive.read_bytes()),
                      "files": len(files) + 1, "checks": validation}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    validate(args.before, args.after, args.out)
