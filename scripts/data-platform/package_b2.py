"""Build the review ZIP; never include raw model/call text, grants or private failure dumps."""
import csv
import hashlib
import io
import json
import pathlib
import subprocess
import zipfile

ROOT = pathlib.Path(".")
OUT = ROOT / "generated-artifacts/data-platform-B2"
load = json.loads((OUT / "LOAD_20_WRITES.json").read_text())
final = json.loads((OUT / "FINAL_VERIFICATION.json").read_text())
integration = json.loads((OUT / "INTEGRATION_TESTS.json").read_text())
transport = json.loads((OUT / "TRANSPORT_TESTS.json").read_text())
tests = json.loads(pathlib.Path("/tmp/b2-vitest.json").read_text())
assert load["complete"] and len(load["rows"]) == 20
assert final["passed"] and integration["passed"] and transport["passed"]
assert tests["success"] and tests["numFailedTests"] == 0
assert not final["productionTouched"] and not final["sourceActivated"]
assert final["retained"]["retain_until_owner_review"]
manifest = json.loads((OUT / "RETAINED_WORKSPACE.json").read_text())
assert final["workspace"] == manifest["workspace"], "Stale final verification from another workspace"
assert final["currentRevision"] == load["rows"][-1]["revision"]
assert final["currentV3SemanticHash"] == load["rows"][-1]["semanticHash"]
previous_manifest = json.loads((OUT / "previous-run/RETAINED_WORKSPACE.json").read_text())
assert previous_manifest["workspace"] != manifest["workspace"], "Final run must have its own full copy"

files = {}
for name in ["RETAINED_WORKSPACE.json", "INITIAL_READBACK.json", "BASE_FINALIZATION.json",
             "INTEGRATION_TESTS.json", "TRANSPORT_TESTS.json", "LOAD_20_WRITES.json",
             "FINAL_VERIFICATION.json", "schema-v3.sql"]:
    files[name] = (OUT / name).read_bytes()
for name in ["RETAINED_WORKSPACE.json", "LOAD_20_WRITES.json", "FINAL_VERIFICATION.json"]:
    files["previous-run/" + name] = (OUT / "previous-run" / name).read_bytes()
files["READING_NOTES.md"] = (ROOT / "docs/data-platform/B2_REVIEW.md").read_bytes()
files["prerequisites/checkpoint-A.sql"] = (ROOT / "docs/data-platform/checkpoint-A.sql").read_bytes()
files["APP_CHECK.json"] = json.dumps({
    "workflowRestartedOnceAfterCodeBatch": True, "devServerPort": 5000,
    "databaseSchemaDrift": False, "publicLandingScreenshot": "passed",
    "signedInBookUiVerified": False, "authBypassed": False,
    "existingDevWarning": "WriteHealthAlert has no delivery channel; logs only. Not changed in B2; monitoring remains checkpoint D.",
    "productionTouched": False,
}, ensure_ascii=False, indent=2).encode()
files["TESTS.json"] = json.dumps({k: tests[k] for k in [
    "success", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"]},
    ensure_ascii=False, indent=2).encode()

rows = io.StringIO()
w = csv.writer(rows)
w.writerow(["step", "kind", "revision", "inserted_rows", "updated_rows", "json_transport_bytes",
            "scoped_tuple_growth_bytes", "physical_table_growth_bytes_all_workspaces",
            "writer_ms", "delta_flush_and_check_ms", "independent_full_check_ms",
            "previous_revision_check_ms", "direct_journal_read_ms", "full_semantic_sha256"])
per_table = io.StringIO()
pt = csv.writer(per_table)
pt.writerow(["step", "table", "inserted", "updated", "json_transport_bytes",
             "scoped_tuple_growth_bytes", "physical_table_growth_bytes_all_workspaces"])
prev = load["before"]
for r in load["rows"]:
    delta = r["delta"]
    now = r["inventory"]
    w.writerow([r["step"], r["kind"], r["revision"], sum(v["inserted"] for v in delta.values()),
                sum(v["updated"] for v in delta.values()), sum(v["logicalBytes"] for v in delta.values()),
                now["workspaceTupleBytes"] - prev["workspaceTupleBytes"],
                now["physicalTablesAllWorkspaces"] - prev["physicalTablesAllWorkspaces"],
                round(r["writerMs"], 2), round(r["verificationMs"], 2), round(r["fullVerificationMs"], 2),
                round(r["historyVerificationMs"], 2), round(r["journalReadMs"], 2), r["semanticHash"]])
    for table in sorted(set(delta) | set(now["tables"])):
        a, b = prev["tables"].get(table, {}), now["tables"].get(table, {})
        d = delta.get(table, {"inserted": 0, "updated": 0, "logicalBytes": 0})
        pt.writerow([r["step"], table, d["inserted"], d["updated"], d["logicalBytes"],
                     b.get("tupleBytes", 0) - a.get("tupleBytes", 0),
                     b.get("tableAndIndexAndToastBytesAllWorkspaces", 0) - a.get("tableAndIndexAndToastBytesAllWorkspaces", 0)])
    prev = now
files["20_WRITES.csv"] = rows.getvalue().encode("utf-8-sig")
files["20_WRITES_PER_TABLE.csv"] = per_table.getvalue().encode("utf-8-sig")

source = sorted((ROOT / "server/companyData/v3").glob("*.ts"))
source += [ROOT / p for p in ["server/companyData/active.ts", "server/companyData/relational.ts"]]
source += sorted((ROOT / "scripts/data-platform").glob("*b2*"))
diff = subprocess.run(["git", "diff", "--", "server/companyData/active.ts",
                       "server/companyData/relational.ts"], text=True, capture_output=True, check=True).stdout
for p in source:
    if p.suffix not in [".ts", ".py"]:
        continue
    files["source/" + str(p)] = p.read_bytes()
    if "v3/" in str(p) or "b2" in p.name:
        patch = subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", str(p)],
                               text=True, capture_output=True)
        assert patch.returncode in (0, 1)
        diff += patch.stdout
files["DIFF_FROM_B.patch"] = diff.encode()

def fmt(value): return f"{value:,}".replace(",", " ")
table = ["| Срез | Строки в измеренных таблицах | Байты строк workspace | Физические таблицы + индексы/TOAST | Вся Dev-база, физические байты |",
         "|---|---:|---:|---:|---:|"]
for key, title in [("beforeB", "B (не меняется)"), ("before", "B2 до 20 правок"), ("after", "B2 после 20 правок")]:
    r = load[key]
    table.append(f"| {title} | {fmt(r['workspaceRows'])} | {fmt(r['workspaceTupleBytes'])} | "
                 f"{fmt(r['physicalTablesAllWorkspaces'])} | {fmt(r['devDatabasePhysicalBytes'])} |")
readme = f"""# TalkHint — пакет B2 v2 для ручной сверки

**Заменяет первый ZIP B2 v1.** Исправлена потеря старого изменения в пакете
update + append и индекс добавленного документа. Финальные 20 правок повторены
на новой полной копии; первая копия и её исходные измерения сохранены.

**Статус:** инженерные проверки пройдены; приёмка владельцем/Claude ещё не выполнена.
Publish, production import и переключение источника НЕ выполнялись.

## Итог

- 20 последовательных правок на полной изолированной копии B.
- После каждой: semantic SHA полного JSON = прежнему движку; предыдущая ревизия
  читается с прежним SHA; прямой журнал совпадает по UTF-8 SHA и UTF-16 длине.
- Правка трёх ролей: шаг 8. Новая operatingModel в начале массива: шаг 20.
- Прирост: **{fmt(load['after']['workspaceRows'] - load['before']['workspaceRows'])} строк**,
  **{fmt(load['after']['workspaceTupleBytes'] - load['before']['workspaceTupleBytes'])} байт строк**.
- Исходный B повторно прочитан из SQL и совпал с принятым SHA.
- Все 242 исходных архивных payload перепроверены; исходная ревизия 912 и
  архивная 908 читаются; после прогона проверены прямые readers документов.
- Тесты: {tests['numPassedTests']} пройдены, {tests['numPendingTests']} пропущены,
  {tests['numFailedTests']} ошибок; TypeScript и diff-check выполнены отдельно.

## Объём: фактические измерения

{chr(10).join(table)}

Счёт строк выше включает измеренные таблицы company, но не одну строку реестра
workspace. С ней B2: {fmt(load['before']['workspaceRows'] + 1)} → {fmt(load['after']['workspaceRows'] + 1)}.
Общие словари контрактов не распределены по владельцам. Это не полный счёт
всех строк звонков/сессий проекта. Физические таблицы включают старые страницы,
индексы и TOAST всех workspace; вся Dev-база — отдельная колонка, **не** размер
копии B2. Вся Dev-база содержит B, обе копии и прочие системы. Создание новой
копии не выдано за прирост от 20 правок.

## Что открыть

1. README и READING_NOTES.md — устройство, границы и ограничения.
2. 20_WRITES.csv — итог по каждому шагу.
3. 20_WRITES_PER_TABLE.csv — вставки/обновления и байты каждой таблицы.
4. LOAD_20_WRITES.json — полные исходные измерения и SHA каждого шага.
5. FINAL_VERIFICATION.json — сохранность B, ID, архивов и документов.
6. DIFF_FROM_B.patch, schema-v3.sql, source/ — изменения кода и DDL.
7. INTEGRATION_TESTS/TRANSPORT_TESTS/TESTS — проверки и их границы.

## Сохранённая копия

- Workspace: `{manifest['workspace']}`.
- Метка: `{manifest['label']}`.
- Начальная ревизия: {manifest['sourceRevision']}; после 20 правок: {final['currentRevision']}.
- Полный инвентарь таблиц — `LOAD_20_WRITES.json → after.tables`.
- `retain_until_owner_review=true`. Автоочистки нет.
- Будущее удаление — отдельное разрешение и точный список только этой копии.
  Принятый B, legacy и shared contracts не включать.
- Предыдущая копия тоже сохранена. Её идентификатор и инвентарь — в
  previous-run/RETAINED_WORKSPACE.json и previous-run/LOAD_20_WRITES.json.

## Не выполнялось

- Реальный production import/Publish/активация источника; Dev→production binding
  ещё подтверждает владелец. Подготовленная служба переноса не опубликована
  отдельным HTTP endpoint; проверена на синтетических владельцах.
- Авторизованная визуальная проверка web-книги; auth не обходили. Проверены
  protected repository и существующий get_document, а не подставная страница.
- Изменение Hint, Copilot, агентов, промптов, писем/дежурного или вызовы моделей.
- Проверка тысяч будущих ревизий; эта нагрузочная проверка — ровно 20.

Далее — ручной проход этого ZIP. Никакого собственного разрешения на Publish
по результатам этих инженерных тестов пакет не даёт.
"""
files["README.md"] = readme.encode()
files["CHECKSUMS.sha256"] = ("\n".join(hashlib.sha256(body).hexdigest() + "  " + name
                                    for name, body in sorted(files.items())) + "\n").encode()
target = OUT / "TalkHint_data_platform_B2_v2.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
    for name, body in files.items(): z.writestr(name, body)
print(json.dumps({"zip": str(target), "files": len(files), "bytes": target.stat().st_size,
                  "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}, ensure_ascii=False))
