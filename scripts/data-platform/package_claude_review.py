"""One complete review ZIP: actual payload + current evidence, no data removal."""
import hashlib
import json
import lzma
import pathlib
import struct
import subprocess
import zipfile

base = pathlib.Path("generated-artifacts/data-platform-publish2")
out = pathlib.Path("generated-artifacts/data-platform-claude-review")
roundtrip = json.loads((out / "DEV_PACKAGE_ROUNDTRIP.json").read_text())
assert roundtrip["passed"] and roundtrip["rolledBack"]
pin = json.loads((base / "REVIEWED_PACKAGE.json").read_text())
original = json.loads((base / "SOURCE_PROOF.json").read_text())
raw_manifest = (base / "MANIFEST.json").read_bytes()
object_proof = json.loads((out / "OBJECT_READBACK.json").read_text())
storage = json.loads((base / "STORAGE_READINESS.json").read_text())
assert storage["ready"] and object_proof["passed"]
validation = json.loads((base / "VALIDATION.json").read_text())
validation["storage"] = storage
validation["reverseAssembly"] = {
    "proof": "DEV_PACKAGE_ROUNDTRIP.json", "passed": True, "rolledBack": True,
    "semanticSha256": roundtrip["reconstructedSemanticSha256"], "documents": 84, "archives": 242,
    "handlerCalled": False, "grantCreated": False, "commitExecuted": False,
}
validation["objectBytesReadback"] = object_proof
validation["selfAcceptance"] = False
(out / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
baseline_path = pathlib.Path("generated-artifacts/data-platform-B2/LOAD_20_WRITES.json")
baseline = json.loads(baseline_path.read_text())
scoped = [r for r in roundtrip["comparison"] if r["scope"] == "workspace-scoped rows"]
assert all(r["delta"] == 0 for r in scoped), "Do not claim a pure scope difference if business rows differ"
assert sum(r["packageRecords"] for r in scoped) == 129518
special = [r for r in roundtrip["comparison"] if r["scope"] != "workspace-scoped rows"]
assert sum(r["delta"] for r in special) == 434

manifest = {
    "source": "genuine accepted shadow B, NOT B2",
    "sourceBWorkspace": roundtrip["sourceB"], "sourceRevisionAtBuild": pin["manifest"]["revision"],
    "capturedAtBuild": original["capturedAt"], "encodedTransportWorkspace": pin["manifest"]["sourceWorkspace"],
    "semanticSha256": pin["manifest"]["semanticHash"], "schemaSha256": pin["manifest"]["schemaDigest"],
    "manifestSemanticSha256": pin["manifestHash"],
    "manifestUtf8FileSha256": hashlib.sha256(raw_manifest).hexdigest(),
    "recordsDigest": pin["manifest"]["recordsDigest"],
    "recordsDigestAlgorithm": "SHA256(concat(semanticHash({table,row}) + LF)); 129952 records, manifest header excluded",
    "recordsWithoutEnvelopeUtf8Sha256": original["recordsFileSha256"],
    "fullNdjsonUtf8Sha256": pin["fileSha256"],
    "recordCount": pin["manifest"]["recordCount"], "rawNdjsonBytesWithHeader": pin["ndjsonBytes"],
    "maximumRecordLineBytesIncludingLF": pin["maximumLineBytes"],
    "bucket": "talkhint", "objectPath": pin["objectName"],
    "objectCompression": "gzip", "objectBytes": object_proof["bytes"],
    "objectSha256": object_proof["sha256"],
    "objectDecompressedSha256": object_proof["decompressedSha256"],
    "reverseAssemblySource": "actual private storage object, downloaded again; not exporter in-memory root",
    "reverseAssemblyProof": "DEV_PACKAGE_ROUNDTRIP.json",
    "sourceRevalidatedAt": roundtrip["checkedAt"],
    "importAuthorized": False, "importHandlerCalled": False, "published": False,
    "selfAcceptance": False, "independentReview": "pending Claude and owner",
}
(out / "PACKAGE_MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
(out / "TABLE_RECORD_COUNTS.json").write_text(json.dumps({
    "baselineWorkspace": baseline["workspace"], "baselinePoint": "before 20 B2 writes, revision 912",
    "baselineEvidence": "B2_BASELINE_COUNTS.json", "baselineWorkspaceRows": 129518,
    "packageRecords": 129952, "delta": 434, "allCommonWorkspaceTableCountsEqual": True,
    "comparison": roundtrip["comparison"],
    "scopeExplanation": "Baseline counts workspace-owned rows only; package ALSO carries global contracts and archived legacy parent/history payloads. Both exclude workspace metadata row and manifest header.",
}, ensure_ascii=False, indent=2))
(out / "B2_BASELINE_COUNTS.json").write_text(json.dumps({
    "workspace": baseline["workspace"], "sourceHash": baseline["sourceHash"], "before": baseline["before"],
    "point": "initial physical inventory before 20 writes; not final revision 932",
    "origin": "generated-artifacts/data-platform-B2/LOAD_20_WRITES.json",
    "originFileSha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
}, ensure_ascii=False, indent=2))
md = "# Почему 129 952, а не 129 518\n\n"
md += "Сравниваются разные области учёта. Общие workspace-таблицы совпали ПО КАЖДОЙ ТАБЛИЦЕ, "
md += "не только общей суммой. Семантический root свежего B и восстановленного пакета одинаков.\n\n"
md += "| Таблица вне базового workspace-счётчика B2 | Записей в пакете |\n|---|---:|\n"
for r in special:
    md += f"| `{r['table']}` | {r['packageRecords']} |\n"
md += "\n**129 518 + 434 = 129 952.** Это не 434 новые сущности или изменения модели.\n\n"
md += "Глобальные контракты — общий реестр форматов всей Dev-базы на момент сборки, "
md += "не бизнес-данные B2. Реестр может содержать форматы других workspace; "
md += "добавление их определений не меняет semantic SHA модели. "
md += "Архивные payload 242 записей и их технический legacy-родитель — транспорт "
md += "истории; 242 `company_v3_archive_refs` уже учтены в обеих одинаковых workspace-суммах. "
md += "Ссылки и payload — разные таблицы, не удвоение числа исторических версий.\n\n"
md += "Обе суммы не учитывают строку `company_v3_workspaces`: её создаёт обработчик, "
md += "в payload её нет. Заголовок manifest тоже не запись. База сравнения — B2 ДО 20 "
md += "правок, не retained-голова 932. Сам источник пакета — B 912, не B2.\n\n"
md += "| Таблица | B2 база | Пакет | Δ | Область |\n|---|---:|---:|---:|---|\n"
for r in roundtrip["comparison"]:
    md += f"| `{r['table']}` | {r['baselineB2Rows']} | {r['packageRecords']} | {r['delta']:+} | {r['scope']} |\n"
(out / "RECORD_COUNT_EXPLANATION.md").write_text(md)

readme = """# TalkHint — пакет для независимой сверки Claude

**Не приёмка исполнителем. Импорт не разрешён и не выполнялся. Publish №2 не выполнялся.**

## Проверить по порядку
1. `PACKAGE_MANIFEST.json`: shadow B (НЕ B2), оба workspace, ревизия сборки, полный semantic SHA,
   SHA схемы/манифеста/записей/объекта, максимум строки, приватный путь в talkhint.
   SHA манифеста для разрешения — canonical semantic hash; SHA его UTF-8 файла приведён отдельно.
2. `RECORD_COUNT_EXPLANATION.md` и `TABLE_RECORD_COUNTS.json`: каждая таблица,
   база B2 129 518, полный payload 129 952, доказанное разложение +434.
3. `DEV_PACKAGE_ROUNDTRIP.json`: НОВАЯ обратная сборка именно скачанного объекта в Dev,
   SQL-backed decode; source SHA = reconstructed SHA; 84 документа (34 + 50),
   у каждого ID/UTF-8 SHA/размер/прямое чтение; 242 архива с SHA. Тестовая транзакция
   откатилась, residue=0. Production handler/сервис импорта/grant не вызывались.
   `SOURCE_PROOF.json` — исходная проверка encoder, не подмена новой обратной сборки.
4. `STORAGE_READINESS.json`, `OBJECT_READBACK.json`: доставка и отдельный SHA самих gzip-байтов.
5. `source/`, `DIFF_SINCE_CLAUDE_REVIEW.patch`, `PREVIOUS_REVIEW_DIFF.patch`, `checks/`:
   обработчик/кнопка/storage/worker; importApproval=null, никакой активации.
   `SEED_AND_WRITER.md` и `WRITER_FIXED_PROBE.json`: оба прежних вопроса отдельно.
6. `POST_IMPORT_CHECK_PLAN.md`: проверки перед импортом, после commit и перед ОТДЕЛЬНЫМ cutover.

## Код и проверки
Рабочий код и данные источника с предыдущего пакета не изменялись. Добавлены только
Dev-скрипт проверки и упаковка. Предыдущие 364 PASS / 5 skipped, TypeScript и offline build
относятся к приложенным неизменённым runtime-файлам; отчёты сохранены без переписывания.
Результат новой обратной сборки — отдельное доказательство, не независимая QA.
Код защищённого экрана после входа не проверялся; auth-boundary проверена ранее.

## Открытые ограничения
- Текущая production-книга всё ещё на старом коде: до отдельного Publish №2 её не открывать.
- Кнопка импорта закрыта. В ZIP НЕТ разрешения. Регистрация хранилища не разрешает импорт.
- Запись FK-решения в существующий журнал подготовлена в JOURNAL_APPEND.json, НЕ применена
  к замороженному source. Это открытый пункт, не завершённая передача P.PRODUCT.
- B/B2, старый JSON и прежние пакеты не удалялись. Hint, почта и дежурный не менялись.

## Полный payload
`transfer.ndjson` — полный реальный поток 1,35 ГБ, не выборка. В ZIP он lossless-сжат
стандартным ZIP-LZMA (method 14, словарь 128 МиБ), иначе вложение превышает 100 МиБ.
Читать Python `zipfile.ZipFile(...).open('transfer.ndjson')` блоками, не `.read()` всего entry.
Некоторые системные ZIP-просмотрщики method 14 не поддерживают; сам ZIP можно передать Claude.
В хранилище тот же поток остаётся gzip; SHA сжатого объекта и распакованного потока
различаются и явно подписаны. Компрессия/контейнер не меняют смысловые или UTF-8 SHA.

Передача: HEAD.07 / P.OPS → Claude → владелец. Самоприёмки нет.
"""
(out / "README.md").write_text(readme)
previous_doc = pathlib.Path("docs/data-platform/PUBLISH_2_REVIEW.md").read_text()
(out / "POST_IMPORT_CHECK_PLAN.md").write_text("# План проверки после импорта\n\n" +
    previous_doc.split("## 7. Порядок будущего разрешённого переноса", 1)[1].split("## 9.", 1)[0])
(out / "SEED_AND_WRITER.md").write_text(
    "# Seed-модель и writer\n\n" +
    previous_doc.split("## 5. Seed-модель и legacy", 1)[1].split("## 7.", 1)[0] +
    "\n\n" + (base / "WRITER_COMPARISON.md").read_text())

class WideDictionary(zipfile.LZMACompressor):
    def _init(self):
        filters = {"id": lzma.FILTER_LZMA1, "dict_size": 128 * 1024 * 1024,
                   "lc": 3, "lp": 0, "pb": 2, "mode": lzma.MODE_FAST,
                   "mf": lzma.MF_HC3, "nice_len": 32, "depth": 8}
        props = lzma._encode_filter_properties(filters)
        self._comp = lzma.LZMACompressor(lzma.FORMAT_RAW, filters=[filters])
        return struct.pack("<BBH", 9, 4, len(props)) + props
zipfile.LZMACompressor = WideDictionary
target = out / "TalkHint_Claude_Publish2_review.zip"
sums = {}
replace = ["README.md", "STORAGE_READINESS.json", "VALIDATION.json"]
with zipfile.ZipFile(base / "TalkHint_Publish2_review_full.zip") as old, \
        zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    def small(name, content):
        z.writestr(name, content); sums[name] = hashlib.sha256(content).hexdigest()
    for name in old.namelist():
        if name in replace + ["transfer.ndjson", "SHA256SUMS.txt", "DELIVERY_TRANSPORT.json"]:
            continue
        small(name, old.read(name))
    for name in ["README.md", "VALIDATION.json", "PACKAGE_MANIFEST.json", "TABLE_RECORD_COUNTS.json", "B2_BASELINE_COUNTS.json",
                 "RECORD_COUNT_EXPLANATION.md", "DEV_PACKAGE_ROUNDTRIP.json", "OBJECT_READBACK.json",
                 "POST_IMPORT_CHECK_PLAN.md", "SEED_AND_WRITER.md"]:
        small(name, (out / name).read_bytes())
    small("STORAGE_READINESS.json", (base / "STORAGE_READINESS.json").read_bytes())
    for name in ["verify_review_packet_dev.ts", "package_claude_review.py"]:
        small("source/scripts/data-platform/" + name, pathlib.Path("scripts/data-platform", name).read_bytes())
    dev_patch = b""
    for name in ["verify_review_packet_dev.ts", "package_claude_review.py"]:
        proc = subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", "scripts/data-platform/" + name],
                              capture_output=True)
        assert proc.returncode in [0, 1]
        dev_patch += proc.stdout
    small("DEV_EVIDENCE_SCRIPTS.patch", dev_patch)
    runtime_hashes = {}
    for name in old.namelist():
        if not name.startswith("source/") or name.startswith(("source/.agents/", "source/scripts/", "source/docs/")):
            continue
        current = pathlib.Path(name.removeprefix("source/"))
        archived_sha = hashlib.sha256(old.read(name)).hexdigest()
        assert current.is_file() and hashlib.sha256(current.read_bytes()).hexdigest() == archived_sha, name
        runtime_hashes[str(current)] = archived_sha
    small("RUNTIME_CODE_SHA256.json", json.dumps({
        "allRuntimeFilesEqualPreviousTestedPackage": True,
        "files": runtime_hashes,
        "appBehaviorChangedThisTurn": False,
    }, indent=2).encode())
    info = zipfile.ZipInfo("transfer.ndjson"); info.compress_type = zipfile.ZIP_LZMA; info.file_size = pin["ndjsonBytes"]
    digest = hashlib.sha256(); total = 0
    with old.open("transfer.ndjson") as src, z.open(info, "w", force_zip64=True) as dest:
        while chunk := src.read(1024 * 1024):
            dest.write(chunk); digest.update(chunk); total += len(chunk)
    assert total == pin["ndjsonBytes"] and digest.hexdigest() == pin["fileSha256"]
    sums["transfer.ndjson"] = digest.hexdigest()
    small("SHA256SUMS.txt", "".join(f"{sha}  {name}\n" for name, sha in sorted(sums.items())).encode())
with zipfile.ZipFile(target) as z:
    assert len(z.namelist()) == len(set(z.namelist())), "No duplicate entry ambiguity"
    for name, expected in sums.items():
        digest = hashlib.sha256()
        with z.open(name) as f:
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
        assert digest.hexdigest() == expected, name
assert target.stat().st_size <= 100 * 1024 * 1024
digest = hashlib.sha256()
with target.open("rb") as f:
    while chunk := f.read(1024 * 1024):
        digest.update(chunk)
receipt = {"file": str(target), "bytes": target.stat().st_size, "sha256": digest.hexdigest(),
           "entries": len(sums), "allEntryHashesVerified": True, "payloadRecords": 129952,
           "reverseAssemblyPassed": True, "selfAcceptance": False, "imported": False, "published": False}
(out / "ZIP_RECEIPT.json").write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2), flush=True)
