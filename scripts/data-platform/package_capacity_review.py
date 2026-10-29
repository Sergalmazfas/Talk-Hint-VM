"""Small independent-review package; no business-model or production writes."""
import datetime
import difflib
import hashlib
import json
import pathlib
import subprocess
import zipfile

out = pathlib.Path("generated-artifacts/publish2-capacity")
old = pathlib.Path("generated-artifacts/data-platform-claude-review/TalkHint_Claude_Publish2_review.zip")
base = pathlib.Path("generated-artifacts/data-platform-publish2")
now = datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def js(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode()


tests = load(out / "FULL_RELEASE_TESTS.json")
assert tests["success"] and tests["numFailedTests"] == 0
assert pathlib.Path("/tmp/publish2-capacity-typecheck-final.log").read_text() == ""
frozen = load(out / "FROZEN_SOURCE.json")
assert frozen["revision"] == 912 and frozen["matchesSealedPackage"]
assert frozen["reviewedImportApproval"] is None
approval = pathlib.Path("server/companyData/v3/importApproval.ts").read_text()
assert "reviewedImportApproval: ImportApproval | null = null;" in approval
build = pathlib.Path("/tmp/publish2-capacity-final-build.log").read_text()
assert "MCP runtime inclusion gate PASSED." in build
assert "copied public Secretary website" in build
freeze_check = subprocess.run(["node", "--input-type=module"], input="""
import pg from 'pg';
if(new URL(process.env.DATABASE_URL).hostname!=='helium') throw Error('Dev only');
const p=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  await p.query('BEGIN READ ONLY');
  const r=await p.query(`SELECT workspace_id,current_revision,storage_generation
    FROM company_workspaces WHERE workspace_id='company-dev-7a0f1ede7a1ba73d7195'`);
  if(r.rows.length!==1 || Number(r.rows[0].current_revision)!==912 ||
     r.rows[0].storage_generation!=='shadow') throw Error('Frozen source changed');
  await p.query('COMMIT');
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),status:'PASS',
    afterFinalFullTestRun:true,writes:0,...r.rows[0]}));
} finally { await p.end(); }
""", text=True, capture_output=True, check=True)
final_freeze = json.loads(freeze_check.stdout)

files = {
    "server/callLab/process.ts", "server/companyData/v3/importWorkerProcess.ts",
    "server/limitedWorker.ts", "server/limitedWorker.test.ts",
    "workers/hint_lab/limited_exec.py", "server/companyData/migrationFreeze.ts",
    "server/companyData/migrationFreeze.test.ts", "server/projectModel/repository.ts",
    "server/companyData/repository.ts", "server/companyData/v3/repository.ts",
    "scripts/data-platform/publish2_capacity_probe.ts",
    "scripts/data-platform/package_capacity_review.py",
    "server/projectModel/benchmarkChain.test.ts",
}
entries = {}
entries["FINAL_FREEZE_CHECK.json"] = js(final_freeze)
patch = []
provenance = []
with zipfile.ZipFile(old) as prev:
    # Keep the previously reviewed fixed pin/approval in the short package, unchanged.
    for p in ["server/companyData/v3/importApproval.ts", "server/companyData/v3/reviewedPackage.ts",
              "server/companyData/v3/importRoutes.ts", "server/companyData/v3/importWorker.ts",
              "server/companyData/v3/packageStorage.ts", "client/src/pages/company-import.tsx",
              "script/build.ts"]:
        current = pathlib.Path(p).read_bytes()
        assert prev.read("source/" + p) == current, f"Reviewed runtime changed unexpectedly: {p}"
        entries["source/" + p] = current
        provenance.append({"file": p, "unchangedFromPreviousReview": True, "sha256": sha(current)})
    for p in sorted(files):
        current = pathlib.Path(p).read_bytes()
        entry = "source/" + p
        if entry in prev.namelist():
            previous = prev.read(entry)
            source = "previous ZIP source/" + p
        else:
            git = subprocess.run(["git", "show", "HEAD:" + p], capture_output=True)
            previous = git.stdout if git.returncode == 0 else b""
            source = "git HEAD (file not in previous ZIP)" if git.returncode == 0 else "new file"
        provenance.append({"file": p, "baseline": source, "beforeSha256": sha(previous),
                           "afterSha256": sha(current)})
        patch.extend(difflib.unified_diff(previous.decode().splitlines(True),
                     current.decode().splitlines(True), fromfile="a/" + p if previous else "/dev/null",
                     tofile="b/" + p))
        entries[entry] = current

entries["DIFF_SINCE_LAST_REVIEW.patch"] = "".join(patch).encode()
entries["DIFF_PROVENANCE.json"] = js({"previousZip": old.name, "previousZipSha256": sha(old.read_bytes()),
    "files": provenance, "unrelatedGeneratedMockupChange": "not included or modified by this work"})
entries["checks/UNIT_TESTS.json"] = (out / "FULL_RELEASE_TESTS.json").read_bytes()
entries["checks/HISTORICAL_UNIT_TESTS_WITH_FAILURE.json"] = (base / "UNIT_TESTS.json").read_bytes()
entries["checks/PREVIOUS_TARGETED_RERUN.json"] = (base / "FINAL_TARGET_TESTS.json").read_bytes()
entries["checks/FULL_BEFORE_FREEZE_GUARD.json"] = (out / "FULL_TESTS.json").read_bytes()
entries["checks/FULL_INTERMEDIATE_WITH_TIMEOUT.json"] = (out / "FULL_FINAL_TESTS.json").read_bytes()
entries["checks/LINGVANEX_AFTER_FIXTURE_SETUP.log"] = pathlib.Path("/tmp/publish2-capacity-lingvanex-fixture.log").read_bytes()
entries["checks/TYPECHECK.txt"] = b"PASS: npx tsc --noEmit --pretty false; exit 0; no diagnostics\n"
python_tests = pathlib.Path("/tmp/publish2-capacity-python-tests.log").read_bytes()
assert b"Ran 32 tests" in python_tests and python_tests.rstrip().endswith(b"OK")
entries["checks/PYTHON_OFFLINE_UNDER_LIMIT.log"] = python_tests
entries["checks/OFFLINE_BUILD.log"] = pathlib.Path("/tmp/publish2-capacity-final-build.log").read_bytes()
entries["checks/AUTH_BOUNDARY.jpg"] = (out / "auth-boundary.jpg").read_bytes()
entries["checks/MCP_BUILD_RECEIPT.json"] = (out / "build-final/mcp-build-receipt.json").read_bytes()
for p in ["FROZEN_SOURCE.json", "BUILD_BOUNDARY.json", "PRODUCTION_SRE.md", "production-evidence.json",
          "RESTART_AND_FUTURE.md"]:
    entries[p] = (out / p).read_bytes()
for p in ["MANIFEST.json", "SOURCE_PROOF.json", "REVIEWED_PACKAGE.json", "JOURNAL_APPEND.json"]:
    entries["sealed-package-reference/" + p] = (base / p).read_bytes()

skipped = [{"file": t["name"].split("/workspace/")[-1], "title": a["fullName"], "status": a["status"]}
           for t in tests["testResults"] for a in t.get("assertionResults", [])
           if a["status"] in ["pending", "todo", "skipped"]]
lingvanex = [a for t in tests["testResults"] if t["name"].endswith("/benchmarkChain.test.ts")
            for a in t["assertionResults"] if "same Lingvanex card" in a["title"]]
assert len(lingvanex) == 1 and lingvanex[0]["status"] == "passed"
entries["checks/TEST_SUMMARY.json"] = js({
    "createdAt": now, "command": "NODE_OPTIONS=--max-old-space-size=2048 npm test -- --maxWorkers=1 --reporter=json --outputFile=...",
    "coverage": "ENTIRE DEFAULT VITEST CONFIG, not merely migration target subset",
    "passed": tests["numPassedTests"], "failed": tests["numFailedTests"],
    "skipped": tests["numPendingTests"], "files": len(tests["testResults"]),
    "lingvanex": {"status": lingvanex[0]["status"], "durationMs": lingvanex[0]["duration"]},
    "skippedTests": skipped,
    "note": "Skipped integration/opt-in tests are not declared passed. Live model/call tests were not run."})
entries["01_TEST_DISCREPANCY.md"] = f"""# 1. Расхождение тестов

Старый UNIT_TESTS.json действительно содержит 361 passed / 1 failed / 5 skipped.
Его не исправляем задним числом: исходник приложен в checks/HISTORICAL_UNIT_TESTS_WITH_FAILURE.json.
Падение: benchmarkChain.test.ts, карточка Lingvanex, 5491,15 мс.
Сохранённый отчёт содержит STACK_TRACE_ERROR без ожидаемого/фактического значения
или нормального текста причины. Это не доказательство ошибки переноса данных.
Время выше стандартного testTimeout 5000 мс делает timeout вероятной причиной,
но точная причина по одному старому отчёту не установлена.
В текущем промежуточном полном прогоне снова упал только тот же тест на 5489,75 мс
(2541 passed / 1 failed / 30 skipped). Этот результат тоже сохранён.

Исправлена именно организация тестовой подготовки: общая многоступенчатая
историческая фикстура строится один раз в beforeAll, а каждый тест получает
собственный structuredClone. Исходные данные и проверки не вырезаны.
timeout, assertions и test include не ослаблялись; код продукта ради теста не менялся.
Отдельный файл после этой правки: 27 passed, затем снова выполнен весь suite.

Прежний README подразумевал результат отдельного повторного файла:
checks/PREVIOUS_TARGETED_RERUN.json — 41 passed. Поэтому говорить, что исходный
общий JSON был полностью зелёным, было неточно. Оба отчёта сохранены.

Сейчас выполнен заново весь default test suite, после всех правок:
**{tests['numPassedTests']} passed / 0 failed / {tests['numPendingTests']} skipped**.
Полный свежий отчёт теперь checks/UNIT_TESTS.json.
Lingvanex: passed, {lingvanex[0]['duration']:.2f} мс.
Это не замена полного прогона одной выборкой. Пропуски перечислены в TEST_SUMMARY.
TypeScript — PASS. Изолированная release-сборка — PASS, основной dist не заменялся.
Python offline: 32 passed под тем же hard AS 2 GiB; без модели/почты/телефонии.
Подписанный admin-интерфейс визуально не проверялся: скриншот показывает auth boundary.
""".encode()
entries["02_FREEZE.md"] = f"""# 2. Заморозка принятого источника

Настоящий shadow B: {frozen['workspace']}; revision **912**.
Полный semantic SHA: {frozen['semanticHash']}.
Свежая READ ONLY SQL-реконструкция под лимитами совпала с sealed package.
Никаких model writes, импорта или изменения пакета при этом не было.
Это Dev-проверка чтения, НЕ запуск import handler.

Добавлен явный барьер записи для данного владельца только в Dev во всех трёх
поколениях repository. Отказ 423 до DB connect для legacy/updateMany и normalized/v3.
Чтение legacy во время freeze не вызывает seed INSERT. Другие владельцы и
production не блокируются. Call jobs/outbox/дежурный НЕ являются моделью компании
и не заморожены. SQL/admin инструменты не ограничены этим кодом: на них действует
прямой запрет исполнителю/ролям. DB-trigger и изменение DDL не вводились.

Dev workflow перезапущен после изменений, startup чистый. До сверки не делать
записей модели, не запускать роли с правкой модели. Неизбежная правка — новый пакет
и новая сверка, не правка revision/manifest в этом пакете.
JOURNAL_APPEND не применён; по решению владельца — в production после включения.
Включение источника, импорт и Publish сейчас не разрешены.
""".encode()
entries["03_MEMORY.md"] = f"""# 3. Ограничения памяти и допуск

Выбрано владельцем: 2 vCPU / 8 GiB. Эта машина ещё НЕ запущена нами.
Сейчас production: 0,5 vCPU / 2 GB, см. SRE — это выделение, не использование.

| Процесс | Жёсткий предел | Дополнительно |
|---|---|---|
| Python лаборатории, включая runtime import check | RLIMIT_AS soft=hard 2 GiB | BLAS/OMP/MKL по 1 потоку |
| Node импорта | RLIMIT_DATA soft=hard 3 GiB | V8 old-space 2048 MiB |

Ограничения устанавливает Python resource до exec целевого кода; ошибка установки
не ведёт к запуску без лимитов. V8 резервирует большой виртуальный адресный диапазон,
поэтому общий RLIMIT_AS 3 GiB для Node непригоден; DATA ограничивает brk/anonymous mmap
на Linux >=4.7, но НЕ является cgroup memory.max и НЕ ограничивает все разновидности RSS.
AS/DATA наследуются потомками, но это НЕ суммарный бюджет дерева процессов.
Нельзя обещать абсолютную защиту телефонии от общего OOM без общего cgroup-бюджета
и измеренной нагрузки. Это ограничение явно оставлено, не скрыто за heap limit.

Новые тесты фактически устанавливают soft/hard resource limits и проверяют отказ
анонимного mmap 4 GiB без заполнения RAM. Node с heap 2048 стартует; настоящий
импорт CrewAI 1.15.30 под Python-пределом прошёл без вызова модели.
READ ONLY восстановление настоящего B под Node-пределами: PASS,
VmHWM {frozen['process']['peakRssKiB']} KiB (~{frozen['process']['peakRssKiB']/1048576:.2f} GiB).
Это не peak полного импорта; его не запускали.

Допуск импорта стал СТРОЖЕ: всего >=4 GiB, свободно >=3,75 GiB по min(OS free,
cgroup limit-current), вместо прежних 2,75. Причина — полный DATA budget 3 GiB
плюс прежний резерв 0,75 GiB, а не только JS heap 2 GiB.
8 GiB проходит при used<=4,25 GiB и OS free>=3,75 GiB. При занятости выше — отказ.
Два GiB старой машины не проходят независимо от свободной памяти.
Подтвердить фактический допуск 8 GiB с работающим Hint сейчас НЕЛЬЗЯ:
нужна новая машина, её memory.current и readiness после Publish владельцем.
Полный capped-импорт и совмещённая нагрузка Hint не заявлены проверенными.
Реальная телефония не останавливалась, calls/models/mail в проверках не вызывались.
""".encode()
entries["README.md"] = f"""# Publish №2: короткий пакет для независимой сверки Claude

Правила v3; HEAD.07 / P.OPS, полная дорога.
Собрано {now}. Это доказательства Dev и read-only production, НЕ самоприёмка.

1. **Тесты:** 01_TEST_DISCREPANCY.md, checks/UNIT_TESTS.json —
   {tests['numPassedTests']} passed, 0 failed, {tests['numPendingTests']} skipped.
   Старое падение сохранено, причины не додуманы. Typecheck/offline build PASS.
2. **Заморозка:** 02_FREEZE.md, FROZEN_SOURCE.json — 912, полный SHA совпадает.
   Новая защита Dev-writer и read без seed; модель/пакет не переписаны.
3. **Память:** 03_MEMORY.md — hard AS 2 GiB Python; hard DATA 3 GiB Node,
   heap 2048 MiB; preflight ужесточён до 3,75 GiB свободных.
   Новой production-машины ещё нет: реальный допуск на ней НЕ проверен.
   RLIMIT не равен полному cgroup-бюджету: гарантия отсутствия общего OOM не дана.
4. **Смена машины и план:** RESTART_AND_FUTURE.md. Точного срока простоя нет;
   сохранность SQL-очереди не обещает автоматический успех прерванного задания.
5. **Production:** PRODUCTION_SRE.md + production-evidence.json:
   фактический compute usage недоступен, разбивки по процессам нет.
   LAB_PYTHON_UNAVAILABLE не доказана как OOM или missing dependency.

DIFF_SINCE_LAST_REVIEW.patch + DIFF_PROVENANCE.json — только текущие изменения.
Источник сравнения явно указан по файлам. Полный payload уже в предыдущем принятом
ZIP/App Storage; здесь не повторяется и не меняется. Его MANIFEST/SOURCE_PROOF/pin
в sealed-package-reference. Проверенные handler/button/storage, build script,
approval/pin приложены исходниками и совпадают с прошлым ZIP.
reviewedImportApproval **null**, разрешений внутри нет.

### Границы результата
Production не меняли, машину не меняли, import handler не вызывали, Publish не делали.
Бизнес-историю/копии не удаляли. В тестах очищаются только их изолированные fixtures.
Новых модельных запросов/звонков/писем в проверках нет.
Dev-сервер поднят, auth boundary проверена; signed-in admin UI не верифицирован.
JOURNAL_APPEND — отложен до production-включения по прямому решению владельца.
Две будущие доработки (диагностика Python, cgroup/нагрузка) только предложены,
НЕ реализованы сейчас. Других обещаний об автономной работе не добавляли.

### Порядок дальше — без автоматического перехода
Сверка Claude → отдельное «да» владельца на точный manifest SHA
98b397692f447e412f7039247c810ffb5500a73481b7c465ce503b730b7f0eca →
вписать только approval и показать diff → сверка Claude →
владелец меняет машину и Publish №2 → фактическая readiness/память/очереди →
владелец нажимает импорт → сверки → отдельное решение о включении.
Неподтверждённые production-замеры не превращать в зелёную приёмку.
""".encode()
entries["SHA256SUMS.txt"] = "".join(f"{sha(b)}  {n}\n" for n, b in sorted(entries.items())).encode()
target = out / "TalkHint_Publish2_capacity_Claude_review.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in sorted(entries.items()):
        z.writestr(name, data)
with zipfile.ZipFile(target) as z:
    assert not z.testzip()
    for name, data in entries.items():
        assert sha(z.read(name)) == sha(data)
receipt = {"file": str(target), "bytes": target.stat().st_size, "sha256": sha(target.read_bytes()),
           "entries": len(entries), "allEntryHashesVerified": True, "selfAcceptance": False,
           "importApproval": None, "productionChanged": False}
(out / "ZIP_RECEIPT.json").write_bytes(js(receipt))
print(json.dumps(receipt))
