"""Package verified checkpoint B. Does not connect to a database or change the model."""
import hashlib, json, pathlib, zipfile, subprocess, difflib

root = pathlib.Path(".")
out = root / "generated-artifacts/data-platform-B"
e = json.loads((out / "IMPORT_VERIFICATION.json").read_text())
c = json.loads((out / "COMMITTED_READ_CHECKS.json").read_text())
tests = json.loads(pathlib.Path("/tmp/company-b-vitest.json").read_text())
assert e["sourceHash"] == e["reconstructedHash"] and e["verifiedArchives"] == 242
assert e["generation"] == "shadow" and not e["cutover"] and not e["productionTouched"]
assert c["countsEqualProjection"] and c["verifiedDocuments"] == 84 and c["archivedReadEqual"]
assert tests["success"] and not tests["numFailedTests"]

files = {}
def put(name, content):
    files[name] = content.encode() if isinstance(content, str) else content
def add(path, name=None):
    put(name or str(path), pathlib.Path(path).read_bytes())
put("README.md", """# TalkHint · пакет B · Dev · schema v2 · source rev912

## Для владельца / независимого прохода
Этапы 1+2 выполнены в **теневых таблицах Dev**. Новый источник НЕ включён.
Сначала прочитайте 01_Что_проверено.md, затем результаты в evidence/.
Ничего публиковать или нажимать для включения по этому ZIP автоматически нельзя.

### Подтверждено
- 40 таблиц согласованной схемы; явные профили и версии промптов, поле режима.
- Полная исходная модель восстановлена из таблиц с тем же semantic SHA-256.
- 84 документа: прямое чтение, UTF-8 digest, UTF-16 длина, число связей совпали.
- 242 исторических payload проверены по контрольным суммам A.
- Чтение сохранённой ревизии 908 совпало с legacy-архивом.
- Фактические количества строк совпали с проекцией, stable IDs — через
  построчную сверку + полный digest восстановленного JSON.
- Раздельные owner/environment, CAS, откат, неизменность legacy после
  нормализованной записи, защита от записи в старый JSON во время cutover.
- 402 теста прошли, 19 пропущены; дополнительно 7 статических проверок,
  отдельный PostgreSQL fixture-протокол и финальный повтор затронутых тестов.
- Dev workflow поднят; публичная страница открылась. Signed-in UI книги
  скриншотом НЕ проверен; его данные/документы проверены кодом.

### Важные границы
Роли, промпты и modes не активированы. Копии пользователей, звонков,
лабораторных заданий и почтовой очереди не импортировались.
Hint не переключён на новый источник, модель/QA/outbox не менялись.
Старый JSON и архив сохранены; будут read-only через новый repository
после отдельного переключения, не удаляются.

Production НЕ перенесён. Привязка Dev→production ещё не подтверждена.
Авторизованный transport/import и cutover production должны быть
подготовлены/проверены перед Publish №1: текущие Dev-проверки не являются
проверкой production-операции. Автоматического старта такого импорта нет.
Это пакет B для сверки, **не команда «можно публиковать»**.

## Состав
- 01_Что_проверено.md — методы, ограничения, source selection, production gates.
- 02_Extra_fields.md — фактические значения/контейнеры по разделам.
- schema/ — DDL v2, diff с принятой A/v1 и provenance исходника при импорте.
- evidence/ — запечатанные результаты реального импорта и проверок.
- source/ и DEV.diff — реализация и изменения.
- SHA256SUMS — контрольные суммы файлов пакета.

## Как воспроизвести в Dev
Без запуска моделей, отправки писем и публикации:
1. `python scripts/data-platform/check_package.py`
2. `npm run check`
3. `npx vitest run server/companyData server/projectModel server/productCrew server/callLab --maxWorkers=1 --testTimeout=20000`
4. `npx tsx scripts/data-platform/verify_b_actual.ts` — read-only фактического shadow.
5. `npx tsx scripts/data-platform/verify_b.ts` — синтетические owner fixtures;
   создаёт и очищает только свои тестовые строки, не структуру владельца.

`checkpoint_b.ts --import` НЕ запускать бездумно повторно: это реальный
Dev bulk-import, а не readonly-проверка. Скрипты фиксированы на Dev helium;
ими нельзя переносить production. Не выполнять `db:push` поверх всех
таблиц: company_* в этом этапе обслуживаются согласованным native PG DDL.
Не поднимать полный SQL-import в web/Hint процессе.
""")
add("docs/data-platform/B_REVIEW.md", "01_Что_проверено.md")
extra = e["extraFields"]
lines = ["# Остаточные поля: фактический импорт B\n",
         "Это строки типизированных значений/контейнеров, не число бизнес-документов.\n",
         "| Раздел | Скаляры | Контейнеры | Байты строк UTF-8 |",
         "|---|---:|---:|---:|"]
for r in extra:
    lines.append(f'| {r["section"]} | {r["scalarValues"]} | {r["containers"]} | {r["stringBytes"]} |')
lines.append(f'\n**Итого:** {sum(r["scalarValues"] for r in extra)} значений; '
             f'{sum(r["containers"] for r in extra)} контейнеров; '
             f'{sum(r["stringBytes"] for r in extra)} байт строк. '
             f'Всего строк company_extra_fields: {e["counts"]["company_extra_fields"]}.')
lines.append("\nКандидаты на явные таблицы и оговорки — раздел «Кандидаты» файла 01_Что_проверено.md. "
             "Профили/промпты/режимы уже вынесены явно. Исходные документы, где они описаны, "
             "сохраняются целиком — не заменяются их проекцией.")
put("02_Extra_fields.md", "\n".join(lines))

schema = pathlib.Path("docs/data-platform/checkpoint-A.sql").read_text()
at_import = schema.replace("-- Logical table names and columns below are contract v2 with the owner's additions.",
                          "-- Logical table names and columns below are the proposed final contract v1.")
if hashlib.sha256(schema.encode()).hexdigest() == e["schemaDigest"]:
    at_import = schema
assert hashlib.sha256(at_import.encode()).hexdigest() == e["schemaDigest"]
put("schema/DDL_v2.sql", schema)
put("schema/DDL_at_import.sql", at_import)
put("schema/PROVENANCE.md", "DDL_at_import.sql совпадает с digest в IMPORT_VERIFICATION.json. " +
    ("DDL_v2.sql побайтово тот же файл.\n" if at_import == schema else
     "Разница DDL_v2.sql — только заголовочный комментарий v1→v2; SQL statements те же.\n"))
with zipfile.ZipFile("generated-artifacts/data-platform-A/TalkHint_data_platform_A_schema_v1_rev912.zip") as z:
    a_sql = next(n for n in z.namelist() if n.endswith(".sql"))
    before = z.read(a_sql).decode()
put("schema/A_to_B.diff", "".join(difflib.unified_diff(before.splitlines(True), schema.splitlines(True),
                                                     fromfile="A/v1.sql", tofile="B/v2.sql")))
for name in ["IMPORT_VERIFICATION.json", "INTEGRATION_TESTS.json", "COMMITTED_READ_CHECKS.json"]:
    add(out / name, "evidence/" + name)
put("evidence/TESTS_SUMMARY.json", json.dumps({k: tests.get(k) for k in
    ["success","numTotalTests","numPassedTests","numFailedTests","numPendingTests"]}, indent=2))
for path in ["/tmp/company-b-static.log", "/tmp/company-b-last-tests.log"]:
    add(path, "evidence/" + pathlib.Path(path).name)
for name in ["SOURCE_MANIFEST.json", "FIELD_INVENTORY.json", "HISTORY_FIELD_INVENTORY.json",
             "DOCUMENT_INVENTORY.json", "HISTORY_HASHES.json", "PRODUCTION_SOURCE_CHECK.json"]:
    add(root / "generated-artifacts/data-platform-A" / name, "evidence/A/" + name)
paths = list(pathlib.Path("server/companyData").glob("*.ts"))
paths += [pathlib.Path(p) for p in [
    "server/projectModel/repository.ts", "server/projectModel/routes.ts",
    "server/projectModel/strategyRoutes.test.ts", "server/productCrew/service.ts",
    "server/callLab/preparedAnalysis.ts", "server/callLab/preparedAnalysis.test.ts",
    "server/callLab/productContext.ts", "server/callLab/productContext.test.ts"]]
paths += list(pathlib.Path("scripts/data-platform").glob("*b*.ts"))
paths += [pathlib.Path("scripts/data-platform/check_package.py"), pathlib.Path(__file__)]
for path in sorted(set(paths)):
    add(path, "source/" + str(path))
patch = subprocess.check_output(["git", "diff", "--", "server", "scripts/data-platform",
                                 "docs/data-platform", ".agents/memory"]).decode()
for path in paths:
    if subprocess.run(["git", "ls-files", "--error-unmatch", str(path)],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        patch += "".join(difflib.unified_diff([], path.read_text().splitlines(True),
                                            fromfile="/dev/null", tofile=str(path)))
put("DEV.diff", patch)
put("SHA256SUMS", "".join(f"{hashlib.sha256(v).hexdigest()}  {k}\n" for k,v in sorted(files.items())))
dest = out / "TalkHint_data_platform_B_v1_rev912.zip"
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, content in sorted(files.items()):
        z.writestr(name, content)
with zipfile.ZipFile(dest) as z:
    assert z.testzip() is None
print(dest, dest.stat().st_size, "bytes", len(files), "files; archive checks passed")
