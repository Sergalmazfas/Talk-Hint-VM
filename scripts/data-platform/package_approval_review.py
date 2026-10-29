"""Review evidence only; never executes import, grant, publish or model write."""
import hashlib
import json
import pathlib
import subprocess
import zipfile

out = pathlib.Path("generated-artifacts/publish2-approval")
def sha(b):
    return hashlib.sha256(b).hexdigest()
def js(x):
    return (json.dumps(x, ensure_ascii=False, indent=2) + "\n").encode()
def read(name):
    return json.loads((out / name).read_text())
working = read("WORKING_DEV_MODEL.json")
assert working["matches"] and working["revision"] == 912
assert working["semanticHash"] == "f1c11386e2dd5808baf88d7e0bfb679817992a76812bdcf43b0bba703b9069c8"
pin = read("APPROVAL_PIN_CHECK.json")
assert pin["status"] == "PASS" and pin["activationApproved"] is False
tests = read("FULL_TESTS.json")
assert tests["success"] and tests["numFailedTests"] == 0
assert pathlib.Path("/tmp/publish2-approval-types.log").read_text() == ""
assert "MCP runtime inclusion gate PASSED." in pathlib.Path("/tmp/publish2-approval-build.log").read_text()
diagnostics = ["server/callLab/process.ts", "server/callLab/startup.ts",
               "server/callLab/service.ts", "server/callLab/pythonDiagnostics.ts",
               "server/callLab/pythonDiagnostics.test.ts"]
approval = "server/companyData/v3/importApproval.ts"
entries = {}
def diff(files):
    result = subprocess.run(["git", "diff", "--", *files], capture_output=True, check=True).stdout
    for f in files:
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", f], capture_output=True).returncode == 0
        if not tracked:
            p = subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", f], capture_output=True)
            assert p.returncode in (0, 1)
            result += p.stdout
    return result
approval_diff = diff([approval])
# Approval file has EXACTLY the single permitted object substitution.
old = subprocess.run(["git", "show", "HEAD:" + approval], capture_output=True, check=True).stdout.decode()
new = pathlib.Path(approval).read_text()
start = new.index("export const reviewedImportApproval:")
end = new.index("\n};", start) + len("\n};")
assert new[:start] + "export const reviewedImportApproval: ImportApproval | null = null;" + new[end:] == old
entries["01_APPROVAL_ONLY.patch"] = approval_diff
entries["02_PYTHON_DIAGNOSTICS.patch"] = diff(diagnostics)
for f in diagnostics + [approval, "scripts/data-platform/verify_working_dev_model.ts",
                         "scripts/data-platform/package_approval_review.py"]:
    entries["source/" + f] = pathlib.Path(f).read_bytes()
for f in ["WORKING_DEV_MODEL.json", "APPROVAL_PIN_CHECK.json", "ERROR_CATEGORIES.md",
          "ERROR_CATEGORIES.json", "FULL_TESTS.json", "auth-boundary.jpg"]:
    entries[f] = (out / f).read_bytes()
entries["checks/TYPECHECK.txt"] = b"PASS; npx tsc --noEmit --pretty false; exit 0, no diagnostics\n"
entries["checks/OFFLINE_BUILD.log"] = pathlib.Path("/tmp/publish2-approval-build.log").read_bytes()
entries["checks/MCP_BUILD_RECEIPT.json"] = (out / "build/mcp-build-receipt.json").read_bytes()
entries["checks/TEST_SUMMARY.json"] = js({
    "passed": tests["numPassedTests"], "failed": tests["numFailedTests"], "skipped": tests["numPendingTests"],
    "scope": "complete default npm test suite", "selfAcceptance": False,
    "skippedAreNotPassed": True,
})
entries["README.md"] = f"""# Publish №2: условие рабочей модели, approval и диагностика

Правила v3; HEAD.07 / P.OPS; полная дорога. Пакет для независимой сверки Claude.

## 1. Проверен именно рабочий источник — условие выполнено
Таблица talkhint_project_models, строка аккаунта владельца: revision 912,
updated_at 2026-10-28T21:37:12.323Z. Не shadow B.
Полный semantic SHA после unpackModel и восстановления собственных архивов:
f1c11386e2dd5808baf88d7e0bfb679817992a76812bdcf43b0bba703b9069c8.
Он совпадает с принятым манифестом/источником B.
READ ONLY REPEATABLE READ, без seed, DDL и записи модели.
WORKING_DEV_MODEL.json + воспроизводимый скрипт в source/.
Прежний FINAL_FREEZE_CHECK подтверждал только неизменяемый B; его было недостаточно.

## 2. Изменён только reviewedImportApproval в соответствующем файле
01_APPROVAL_ONLY.patch — отдельный полный diff; соседняя привязка/барьер не менялись.
Манифест: 98b397692f447e412f7039247c810ffb5500a73481b7c465ce503b730b7f0eca.
Цель: подтверждённый production-аккаунт; только new-country; результат shadow.
Активация НЕ разрешена. APPROVAL_PIN_CHECK.json сверяет поля с прежним pin.
sourceWorkspace — техническое workspace sealed transfer из согласованного манифеста;
sourceBWorkspace в доказательствах указывает настоящий B, не B2.
Начальный комментарий файла сохранился от нулевого approval: по указанию
«вписать только reviewedImportApproval» соседний текст/код не переписывались.
Фактическое текущее разрешение задаёт объект, не прежний комментарий.

## 3. Диагностика LAB_PYTHON_UNAVAILABLE — отдельный diff
02_PYTHON_DIAGNOSTICS.patch: exit_code, signal, launch_code, killed и последние
6 непустых строк stderr в startup-status и безопасном серверном сообщении.
Источник — результат execFile проверки runtime, не вывод AI и не реплики звонка.
Неизвестный exit/signal — null, не 0; неизвестные строки скрыты полностью.
У stderr политика allowlist: известные ошибки/модули сохраняются, пути,
произвольные исключения, токены, e-mail, телефон и прочий текст не публикуются.
Детали произвольного SDK error в статус не проходят. Проверены exit/ENOENT/signal,
подмена diagnostic и redaction. Сырые stderr, env и command не журналируются.
Это даёт новые факты после будущей публикации, но не восстанавливает задним
числом причину старых четырёх событий. Нехватка памяти пока не доказана.

## 4. Все 124 записи разложены, без смешения с HTTP-ответами
ERROR_CATEGORIES.md/.json — read-only исследование помощника SRE.
Окно точно прежнее: 2026-10-28T05:57:06.646Z — 2026-10-29T05:57:06.646Z.
124 уникальных ERROR, полная пагинация, нет оставшегося cursor/truncation.
102 healthcheck (97 status-500, 4 connection refused, 1 deadline);
4 Python unavailable; 4 сообщения конфигурации проверки подписи Twilio;
10 записей Parse Error (2 исключения + 8 строк stack);
2 отказа записи аудио по safety; 1 конфигурация health endpoint;
1 пропуск admin bootstrap. Сумма 124. Это НЕ 124 сбоя звонка.
Отдельно proxy: 329 requests, 2 HTTP 5xx. Во всём окне 4510 INFO и 124 ERROR.
Группировка возле публикаций — корреляция, не доказанная причина.

## 5. Проверки и границы
Полный прогон текущего набора: {tests['numPassedTests']} passed /
0 failed / {tests['numPendingTests']} skipped; пропуски не объявлены пройденными.
Typecheck PASS. Offline release build PASS, основной dist не заменялся.
Dev workflow перезапущен, startup чистый, закрытая страница показывает вход;
signed-in admin UI визуально не проверялся. Проверки не отправляли писем,
не вызывали модели/внешние звонки и не запускали import/grant handler.
Бизнес-модель не менялась, JOURNAL_APPEND отложен до отдельного включения.
Структура/права/приёмка P.LAB и P.OPS этим пакетом не перестраивались.

Production не меняли. Машину не меняли. Publish и импорт НЕ выполнялись.
Следующая контрольная точка — сверка Claude этого diff. Затем владелец решает
Publish/смену машины; после readiness владелец сам нажимает импорт.
После импорта сверки; включение — ещё отдельное решение. Самоприёмки нет.
"""
entries["README.md"] = entries["README.md"].encode()
entries["SHA256SUMS.txt"] = "".join(f"{sha(v)}  {k}\n" for k,v in sorted(entries.items())).encode()
target = out / "TalkHint_Publish2_approval_Claude_review.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name,data in sorted(entries.items()):
        z.writestr(name,data)
with zipfile.ZipFile(target) as z:
    assert not z.testzip()
    for k,v in entries.items():
        assert sha(z.read(k)) == sha(v)
receipt = {"file": str(target), "bytes": target.stat().st_size, "sha256": sha(target.read_bytes()),
           "entries": len(entries), "selfAcceptance": False, "importInvoked": False, "publishInvoked": False}
(out / "ZIP_RECEIPT.json").write_bytes(js(receipt))
print(json.dumps(receipt))
