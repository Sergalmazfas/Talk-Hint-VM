"""Offline review pack only: no DB connection, migration or activation."""
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import zipfile

OUT = Path("generated-artifacts/data-platform-publish-1")
diff = json.loads((OUT / "SCHEMA_DIFF.json").read_text())
assert diff["success"] and diff["hasDiff"]
for key in ("hasStructuralDataLoss", "maybeNonBackwardsCompatible"):
    assert not diff[key], key
for key in ("tablesToRemove", "tablesToTruncate", "columnsToRemove",
            "schemasToRemove", "matViewsToRemove", "warnings"):
    assert not diff.get(key), key
statements = diff["statementsToExecute"]
tables = sorted(re.match(r'^CREATE TABLE "([^"]+)"', sql).group(1)
                for sql in statements if sql.startswith("CREATE TABLE "))
assert len(tables) == len(set(tables)) == 85
assert all(t.startswith("company_") for t in tables)
v2 = [t for t in tables if not t.startswith("company_v3_")]
v3 = [t for t in tables if t.startswith("company_v3_")]
assert len(v2) == 40 and len(v3) == 45
counts = {"CREATE TABLE": 0, "ALTER TABLE": 0, "CREATE INDEX": 0}
for sql in statements:
    prefix = next((p for p in counts if sql.startswith(p + " ")), None)
    assert prefix, "Unexpected SQL operation"
    counts[prefix] += 1
    if prefix == "ALTER TABLE":
        match = re.match(r'^ALTER TABLE "([^"]+)" ADD CONSTRAINT ', sql)
        assert match and match.group(1) in tables
assert counts == {"CREATE TABLE": 85, "ALTER TABLE": 106, "CREATE INDEX": 5}
service = {
    "company_v3_workspaces", "company_v3_contracts", "company_v3_business_contract",
    "company_v3_text_snapshots", "company_v3_frames", "company_v3_payload_text_refs",
    "company_v3_revision_heads", "company_v3_document_heads", "company_v3_archive_refs",
    "company_v3_import_grants", "company_v3_size_budgets",
}
assert service <= set(v3)
rows = []
for table in tables:
    group = "v2" if table in v2 else "v3-service" if table in service else "v3-business"
    status = ("пустой неиспользуемый архив совместимости B" if table in v2
              else "пустая структура, импорт отдельно")
    rows.append([table, group, status, "нет", "нет"])
buf = io.StringIO()
writer = csv.writer(buf)
writer.writerow(["table", "group", "after_publish", "copy_dev_rows", "activate"])
writer.writerows(rows)
markdown = "# Все таблицы предварительного diff Publish №1\n\n"
markdown += "| Таблица | Группа | После Publish |\n|---|---|---|\n"
markdown += "\n".join(f"| `{r[0]}` | {r[1]} | {r[2]} |" for r in rows) + "\n"
binding = json.loads((OUT / "ACCOUNT_BINDING_PROPOSAL.json").read_text())
assert binding["status"] == "PROPOSED_NOT_CONFIRMED"
assert not binding["importAuthorized"] and not binding["activationAuthorized"]
files = {
    "README.md": Path("docs/data-platform/PUBLISH_1_REVIEW.md").read_bytes(),
    "TABLES.csv": buf.getvalue().encode("utf-8-sig"),
    "TABLES.md": markdown.encode(),
}
for name in ("SCHEMA_DIFF.json", "PUBLISH_DIFF.sql", "ACCOUNT_BINDING_PROPOSAL.json"):
    files[name] = (OUT / name).read_bytes()
files["CHECKSUMS.sha256"] = "".join(
    hashlib.sha256(data).hexdigest() + "  " + name + "\n"
    for name, data in sorted(files.items())
).encode()
archive = OUT / "TalkHint_Publish_1_review_v1.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zip_file:
    for name, data in files.items():
        zip_file.writestr(name, data)
with zipfile.ZipFile(archive) as zip_file:
    assert zip_file.testzip() is None
    for line in zip_file.read("CHECKSUMS.sha256").decode().splitlines():
        digest, name = line.split("  ", 1)
        assert hashlib.sha256(zip_file.read(name)).hexdigest() == digest
print(json.dumps({"archive": str(archive), "tables": len(tables),
                  "operations": counts, "checksums": "PASS"}))
