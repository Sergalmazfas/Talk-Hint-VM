"""Structural checks of A plus owner-approved B additions. No SQL is sent to a database."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "generated-artifacts/data-platform-A"
SQL = (ROOT / "docs/data-platform/checkpoint-A.sql").read_text()
CLEAN = re.sub(r"--[^\n]*", "", SQL)

def segments(text, delimiter=","):
    result, start, depth, quoted = [], 0, 0, False
    i = 0
    while i < len(text):
        c = text[i]
        if c == "'":
            if quoted and i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            depth += (c == "(") - (c == ")")
            if c == delimiter and depth == 0:
                result.append(text[start:i].strip())
                start = i + 1
        assert depth >= 0, "Unbalanced SQL parentheses"
        i += 1
    assert depth == 0 and not quoted
    if text[start:].strip():
        result.append(text[start:].strip())
    return result

STATEMENTS = segments(CLEAN, ";")
TABLES = {}
for statement in STATEMENTS:
    match = re.fullmatch(r"CREATE TABLE (\w+)\s*\((.*)\)", statement, re.S)
    if match:
        name, body = match.groups()
        assert name not in TABLES
        parts = segments(body)
        cols = [p.split()[0] for p in parts if not re.match(r"^(PRIMARY|FOREIGN|CHECK|UNIQUE|CONSTRAINT)\b", p)]
        assert len(cols) == len(set(cols))
        TABLES[name] = {"body": body, "columns": cols}

class CheckpointA(unittest.TestCase):
    def test_schema_is_review_only_and_non_destructive(self):
        self.assertEqual(len(TABLES), 40)
        self.assertTrue(all(name.startswith("company_") for name in TABLES))
        self.assertNotRegex(CLEAN, r"\b(DROP|DELETE|TRUNCATE|CREATE\s+EXTENSION)\b")
        self.assertNotRegex(CLEAN, r"\bjsonb\b")
        for s in STATEMENTS:
            self.assertRegex(s, r"^(BEGIN$|COMMIT$|CREATE TABLE company_|CREATE INDEX company_|ALTER TABLE company_)")

    def test_each_table_has_primary_key_and_scope(self):
        for name, table in TABLES.items():
            self.assertIn("workspace_id", table["columns"], name)
            pk = re.search(r"PRIMARY KEY\s*\(([^)]+)\)", table["body"])
            if pk is None:
                self.assertRegex(table["body"], r"workspace_id text PRIMARY KEY", name)
                columns = ["workspace_id"]
            else:
                columns = pk.group(1).split(",")
            for column in columns:
                self.assertIn(column.strip(), table["columns"], name)

    def test_foreign_key_columns_and_targets_exist(self):
        external = {
            "talkhint_project_models": ["owner_key", "revision", "state", "updated_at"],
            "talkhint_project_model_history": ["owner_key", "key", "payload"],
        }
        schemas = {**external, **{k: v["columns"] for k, v in TABLES.items()}}
        for match in re.finditer(r"REFERENCES (\w+)\s*\(([^)]+)\)", CLEAN):
            name, columns = match.groups()
            self.assertIn(name, schemas)
            for column in columns.split(","):
                self.assertIn(column.strip(), schemas[name], name)
        for name, table in TABLES.items():
            for match in re.finditer(r"FOREIGN KEY\s*\(([^)]+)\)", table["body"]):
                for column in match.group(1).split(","):
                    self.assertIn(column.strip(), table["columns"], name)

    def test_observed_field_inventory_is_typed_and_has_destination(self):
        fields = json.loads((OUT / "FIELD_INVENTORY.json").read_text())
        self.assertEqual(len(fields), 1423)
        self.assertEqual(len({f["path"] for f in fields}), len(fields))
        for f in fields:
            self.assertTrue(f["types"] and f["target"] and f["observations"] > 0)
        history = json.loads((OUT / "HISTORY_FIELD_INVENTORY.json").read_text())
        self.assertEqual(len(history), 1967)
        self.assertTrue(all("company_source_archives" in f["target"] for f in history))

    def test_manifest_scope_and_reference_checks(self):
        m = json.loads((OUT / "SOURCE_MANIFEST.json").read_text())
        self.assertEqual(m["sourceRevision"], 912)
        self.assertEqual(m["databaseWrites"], 0)
        self.assertTrue(m["readOnlyTransaction"])
        self.assertEqual(m["findings"], [])
        for item in m["materialReferences"]:
            self.assertNotEqual(item.get("namespace"), "declared_unresolved")
            self.assertNotIn("declared_unresolved", item.get("materialReferenceCounts", {}))
        self.assertEqual(m["history"]["entries"], 242)
        hashes = json.loads((OUT / "HISTORY_HASHES.json").read_text())
        self.assertEqual(len(hashes), 242)
        self.assertEqual(len({h["key"] for h in hashes}), 242)
        self.assertTrue(all(re.fullmatch("[a-f0-9]{64}", h["canonicalSemanticHash"]) for h in hashes))

    def test_documents_are_exact_versioned_text_not_normalized_strings(self):
        docs = json.loads((OUT / "DOCUMENT_INVENTORY.json").read_text())
        self.assertEqual(len(docs), 84)
        self.assertEqual(len({(d["hypothesis"], d["id"]) for d in docs}), 84)
        self.assertTrue(all(re.fullmatch("[a-f0-9]{64}", d["sha256"]) for d in docs))
        self.assertEqual(sum(len(d["fields"]) for d in docs), 5939)
        self.assertIn("text_body text NOT NULL", TABLES["company_document_versions"]["body"])

    def test_no_runtime_project_files_in_this_checkpoint(self):
        inventory = (ROOT / "scripts/data-platform/inventory.ts").read_text()
        self.assertIn("REPEATABLE READ READ ONLY", inventory)
        self.assertNotRegex(inventory, r"await db\.query\([`\"'](?:INSERT|UPDATE|DELETE|CREATE|ALTER)")
        self.assertIn('assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium"', inventory)

if __name__ == "__main__":
    unittest.main(verbosity=2)
