"""One review ZIP. Does not execute SQL or connect to any application service."""
import hashlib
import html
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "generated-artifacts/data-platform-A"
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((OUT / "SOURCE_MANIFEST.json").read_text())
assert manifest["sourceRevision"] == 912 and manifest["databaseWrites"] == 0
assert manifest["findings"] == []
tests = subprocess.run(["python", "scripts/data-platform/check_package.py"], cwd=ROOT,
                       capture_output=True, text=True)
assert tests.returncode == 0, tests.stderr
(OUT / "CHECKS.txt").write_text(tests.stdout + tests.stderr)
shutil.copyfile(ROOT / "docs/data-platform/checkpoint-A.sql", OUT / "SCHEMA_v1.sql")
shutil.copyfile(ROOT / "docs/data-platform/CHECKPOINT_A.md", OUT / "IMPORT_AND_VERIFICATION.md")
contracts = [
    "shared/projectModel.ts", "shared/operatingModel.ts", "shared/projectStrategy.ts",
    "shared/projectCompetitors.ts", "shared/competitiveAnalyst.ts", "shared/productCrew.ts",
    "shared/productBook.ts", "shared/passportChapter.ts",
    "server/projectModel/operatingModel.ts", "server/projectModel/domain.ts",
    "server/projectModel/history.ts", "server/productCrew/service.ts",
]
for source in contracts:
    path = OUT / "source_contracts" / source
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / source, path)
for source in ["scripts/data-platform/inventory.ts", "scripts/data-platform/check_package.py",
               "scripts/data-platform/pack_a.py"]:
    path = OUT / "reproduce" / source
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / source, path)
production = {
    "environment": "production", "observationDate": "2026-10-28",
    "method": "Replit executeSql, read-only SELECT; no application control changes",
    "query": "SELECT count(*)::int AS model_rows, min(revision) AS min_revision, max(revision) AS max_revision, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a WHERE a->>'id'='new-country'))::int AS rows_with_new_country FROM talkhint_project_models",
    "result": {"model_rows": 0, "min_revision": None, "max_revision": None, "rows_with_new_country": 0},
    "implication": "Initial owner-approved promotion of the Dev company model is required, not backfill of an existing production model.",
    "notChecked": ["Hint runtime active state", "current jobs and outbox", "mail delivery", "phone calls"],
}
(OUT / "PRODUCTION_SOURCE_CHECK.json").write_text(json.dumps(production, ensure_ascii=False, indent=2))
validation = {
    "status": "checkpoint_A_prepared_for_owner_review", "schemaVersion": 1,
    "sourceRevision": 912, "ddlTables": 36,
    "checks": {"readOnlyInventory": "passed", "currentGraphReferences": "passed",
               "staticSchemaAndInventory": "7 tests passed", "typescript": "npm run check passed",
               "diffWhitespace": "git diff --check passed"},
    "databaseWrites": 0, "migrationStarted": False, "tablesCreated": 0,
    "ddlExecutedOrParsedByPostgreSQL": False,
    "ddlValidationLimit": "Static table/key/column/reference checks only. PostgreSQL execution, constraint behavior, import, shadow equality and reconstruction must be tested in B after approval.",
    "independentReview": "pending owner/Claude; own static checks are not independent acceptance",
    "canonicalModelDocumentsChanged": False,
    "runtimeFilesChanged": False, "workflowRestarted": False,
    "HintLabWatchdogMailChanged": False, "costWork": "removed by owner's latest instruction",
    "scope": "A only; B implementation and every Publish require the owner's approval",
}
(OUT / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
readme = """# TalkHint — пакет A: схема платформы данных v1

**Статус:** только схема и инвентарь. Ничего не переносилось.
**Источник:** Dev, root rev912; точное время и hashes — SOURCE_MANIFEST.json.
**Проектные таблицы не создавались. Hint, лаборатория, дежурный и письма не менялись.**

## Что смотреть по порядку
1. IMPORT_AND_VERIFICATION.md — схема, ограничения, импорт, production-перенос,
   приёмка B–E и откат. Можно читать READ_FIRST.html.
2. SCHEMA_v1.sql — конкретный DDL 36 новых company_* таблиц; **не запускать сейчас**.
3. SOURCE_MANIFEST.json — количества/ID-set hashes, версии, ссылки и границы.
4. FIELD_INVENTORY.json — все 1423 пути текущего состояния и его встроенных версий.
5. DOCUMENT_INVENTORY.json — 84 документа обеих гипотез, SHA-256 каждого текста,
   5939 путей внутри JSON-документов. Самого содержимого документов здесь нет.
6. HISTORY_FIELD_INVENTORY.json / HISTORY_HASHES.json — 1967 архивных путей
   и hashes всех 242 неизменяемых payload.
7. EXISTING_DB_SCHEMA.json — полный инвентарь 42 нынешних public-таблиц,
   их колонок, ограничений и числа строк (снимок Dev). Не инструкция их менять.
8. PRODUCTION_SOURCE_CHECK.json — важный факт: production-модель отсутствует.
9. VALIDATION.json / CHECKS.txt — что проверено и что ещё не проверялось.
10. source_contracts/ — исходные контракты и readers для независимой сверки;
    reproduce/ — SELECT-only генератор инвентаря и проверяющие скрипты.

## Что проверено и как
- Инвентарь: одна PostgreSQL REPEATABLE READ READ ONLY транзакция.
- В обеих гипотезах перечислены все фактически наблюдаемые поля/типы/контейнеры;
  значения текстов/секретов/данные звонков в пакет не выгружены.
- Проверены дубли ID, endpoints 4042 связей, input sources, шаблоны,
  document elementIds и namespace внешних материалов. Найденных разрывов нет.
- Отдельно сохранены все хеши исторического архива; чтение не удаляет историю.
- 7 статических тестов схемы/инвентаря, TypeScript, whitespace diff — прошли.
- PostgreSQL DDL **не исполнялся**, импорт/теневое чтение новой схемы
  **не выполнялись**. Их нельзя назвать пройденными до B.
- Это не пакет B и не «можно публиковать». Таблицы, backfill, cutover и
  независимая приёмка пока не выполнены.

## Главные контрольные вопросы
- Принимаете ли схему: явные таблицы графа/документов/журнала + типизированные
  обратимые поля остальных разделов, без нового JSONB-монолита?
- Принимаете ли механизм production: только утверждённая структура Dev/архив,
  owner-authenticated import после Publish №1; звонки и настройки не копируются?
- При «да» разрешается разработка B (этапы 1+2 в Dev) и её пакет проверки.
  Это не разрешение публикации, запуска C/D или автоматического cutover.

## Границы
Нет нового аккаунта, оплаты, расчёта Usage, вызова модели, письма или звонка.
Нет изменений поведения продукта, новых ролей или промптов.
В работающих calls/call_lab_* и outbox нет изменений, перезапусков и выключений.
Проектная память фиксирует решения владельца; каноническая модель rev912
не переписана ради регистрации этого пакета. После «да» запись случая переезда
идёт в существующий журнал, не в новый каталог.

Архив проверяется по SHA256.json: checksum каждого входящего файла.
"""
(OUT / "README.md").write_text(readme)
plan = (OUT / "IMPORT_AND_VERIFICATION.md").read_text()
page = """<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><title>TalkHint · пакет A</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#16322d;background:#f5f8f7;
max-width:960px;margin:auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;
font:14px/1.6 system-ui,sans-serif}section{background:white;border:1px solid #cad9d3;
border-radius:14px;padding:20px;margin:18px 0}summary{cursor:pointer;font-weight:650}</style>
<h1>Платформа данных · пакет A · v1</h1><section><pre>__README__</pre></section>
<section><details open><summary>Схема, перенос и контрольные точки</summary><pre>__PLAN__</pre></details></section>
<section><details><summary>DDL — только для проверки</summary><pre>__SQL__</pre></details></section></html>"""
page = page.replace("__README__", html.escape(readme)).replace("__PLAN__", html.escape(plan))
page = page.replace("__SQL__", html.escape((OUT / "SCHEMA_v1.sql").read_text()))
(OUT / "READ_FIRST.html").write_text(page)
# Only explicit files; do not accidentally include raw model data or previous archives.
files = sorted(p for p in OUT.rglob("*") if p.is_file() and p.suffix not in (".zip",)
               and p.name not in ("SHA256.json",))
hashes = {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(OUT / "SHA256.json").write_text(json.dumps(hashes, ensure_ascii=False, indent=2))
archive = OUT / "TalkHint_data_platform_A_schema_v1_rev912.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for p in files + [OUT / "SHA256.json"]:
        z.write(p, str(p.relative_to(OUT)))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name, digest in hashes.items():
        assert hashlib.sha256(z.read(name)).hexdigest() == digest
print(json.dumps({"filePath": str(archive.relative_to(ROOT)), "files": len(files) + 1,
                  "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                  "allHashesVerified": True}))
