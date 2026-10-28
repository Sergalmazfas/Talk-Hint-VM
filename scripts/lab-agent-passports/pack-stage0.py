"""Review artifacts only. No database, mail, model API or deployment operations."""
import hashlib
import html
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "generated-artifacts/data-platform-stage0"
OUT.mkdir(parents=True, exist_ok=True)
paths = [
    "server/projectModel/sizeBudget.ts", "server/projectModel/sizeBudget.test.ts",
    "server/projectModel/hypotheses.ts", "server/projectModel/domain.ts",
    "server/projectModel/history.ts", "server/projectModel/documentVolumes.ts",
    "server/projectModel/documentVolumes.test.ts", "server/productCrew/service.ts",
    "scripts/lab-agent-passports/stage0-check.ts", "scripts/lab-agent-passports/pack-stage0.py",
    "docs/data-platform/PLAN.md", ".agents/memory/MEMORY.md",
    ".agents/memory/data-platform-direction.md",
]
diffs = []
for path in paths:
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", path], cwd=ROOT,
                             capture_output=True).returncode == 0
    cmd = ["git", "diff", "--", path] if tracked else ["git", "diff", "--no-index", "--", "/dev/null", path]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    assert result.returncode in (0, 1)
    diffs.append(result.stdout)
(OUT / "DEV.diff").write_text("\n".join(diffs))
plan = (ROOT / "docs/data-platform/PLAN.md").read_text()
(OUT / "PLAN.md").write_text(plan)
proof = json.loads((OUT / "VERIFICATION.json").read_text())
assert proof["sourceRevision"] == 912, "Re-read and revise review evidence if the source changes"
assert proof["completeRoundTripEqual"] and proof["databaseWrites"] == 0
validation = {
    "stage": 0, "status": "prepared_in_dev_not_published", "sourceRevision": proof["sourceRevision"],
    "tests": [
        {"command": "npx vitest run server/projectModel server/productCrew server/callLab/productContext.test.ts server/callLab/productFollowup.test.ts server/callLab/preparedAnalysis.test.ts --maxWorkers=1",
         "passed": 318, "skipped": 5, "failed": 0},
        {"command": "npx vitest run server/projectModel/sizeBudget.test.ts --maxWorkers=1",
         "passed": 4, "skipped": 0, "failed": 0,
         "note": "After adding the 6.5M rejection test; 3 overlap with the larger run, 1 is additional."},
        {"command": "npm run check", "status": "passed"},
        {"command": "npx tsx scripts/lab-agent-passports/stage0-check.ts",
         "status": "passed", "details": "VERIFICATION.json"},
        {"command": "git diff --check", "status": "passed"},
    ],
    "application": {
        "workflow": "Start application", "restarted": True, "servingPort": 5000,
        "publicLandingScreenshot": "passed", "signedInBookScreenshot": "not_verified",
        "bookVerification": "Unchanged public representation; exact full-state round trip and real document service on actual frozen Dev snapshot.",
    },
    "notExecuted": ["production writes", "schema migrations", "data migration", "pgvector installation",
                    "model calls", "mail", "new calls", "new agents", "Publish", "backup enablement"],
    "ops": "Capacity and backup monitoring are planned, not active. Existing Dev startup warns that general WriteHealthAlert mail/SMS channel is not configured; it is not proof about the Hint Gmail channel or production.",
}
(OUT / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
(OUT / "APPLICATION.md").write_text("""# Применение и контрольные точки

1. Прочитать PLAN.md, DEV.diff, VERIFICATION.json, VALIDATION.json.
2. Этап 0 подготовлен в Dev; база модели rev912 не переписана. Контрольные
   суммы относятся к фактическому снимку Dev, не к production.
3. После согласования владельцем — Publish делает владелец. В этапе 0 нет
   DDL и переноса строк. Для него Xcode собирать не нужно.
4. После Publish отдельно проверить чтение книги/документов и работоспособность
   контура Hint; не говорить «можно звонить» только по успешному Dev-тесту.
   Включённый контур Hint и дежурство не отключать ради миграции.
5. Этап 1 не начинать до отдельного «да» на схему/оценку. Это разрешение
   разработки этапа 1, не разрешение публикации или дальнейших этапов.
6. Перед сменой источника — manifest, counts/ID/digest, совместимость readers,
   проверка восстановления и согласованный production backfill. Старый JSON
   после переключения — read-only; не удалять и не dual-write.
7. Откат после записи томов требует reader с поддержкой томов. После новых
   нормализованных записей нельзя откатывать источник на устаревший JSON.

Текущая каноническая модель, её документы и журнал в этом этапе не изменены.
Решение владельца зафиксировано в проектной памяти, не выдано за выполненный
перенос. Этот ZIP — пакет проверки, не второй рабочий каталог модели.
""")
page = """<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TalkHint · платформа данных · этап 0</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#182e2a;background:#f4f8f6;
max-width:960px;margin:auto;padding:24px}h1{line-height:1.2}section{background:white;
padding:22px;border:1px solid #cadbd5;border-radius:14px;margin:18px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui,sans-serif}
summary{cursor:pointer;font-weight:650}a{color:#007d72}.status{font-weight:650;color:#006e61}</style>
<h1>Переход на целевую инфраструктуру данных</h1>
<p class="status">Этап 0: подготовлен в Dev · rev912 · не опубликован</p>
<section><b>Что готово</b><p>Лимит new-country 6,5 млн; тома длинных документов
до 50 000 единиц с контрольными суммами. ID, полный текст и история сохраняются.
Сверены 50 документов, 866 узлов, 4042 связи. Записей в базу: 0.</p>
<p>318 тестов прошли, 5 пропущены. Отдельная проверка лимитов: 4 теста прошли
(3 пересекаются с большим прогоном). TypeScript — без ошибок.</p></section>
<section><b>Стоимость и сроки</b><p>Этап 1: 2–4 инженерных дня; все этапы —
ориентир 7–15 дней плюс контрольные точки владельца. Не срок ожидания.</p>
<p>DB compute по опубликованной ставке $0,16/compute-hour:
при условных 720 тарифицируемых часах — $115,20/месяц.
Пример малого объёма хранения/передачи — ещё $1,84 без скидок.
Итого сценарий $117,04 + существующий сервер + AI. Это не измеренный счёт
и не автоматически новые расходы: текущая система уже использует БД.</p>
<p><a href="https://replit.com/settings/usage">Открыть фактические расходы Replit</a></p></section>
<section><details open><summary>Полный план, схема, риски и цена</summary><pre>__PLAN__</pre></details></section>
<section><details><summary>Diff этапа 0</summary><pre>__DIFF__</pre></details></section>
<section><details><summary>Доказательства сверки</summary><pre>__PROOF__</pre></details></section>
<section><b>Контрольная точка</b><p>Публикует владелец. Этап 1 — только после
отдельного «да». Production, звонки, модели и почта не изменялись.
Xcode для этапа 0 не нужен. Авторизованная книга в браузере не проверялась;
тексты сверены через фактический document service на снимке Dev.</p></section></html>"""
page = page.replace("__PLAN__", html.escape(plan)).replace("__DIFF__", html.escape("\n".join(diffs)))
page = page.replace("__PROOF__", html.escape(json.dumps(proof, ensure_ascii=False, indent=2)))
(OUT / "READ_FIRST.html").write_text(page)
files = ["PLAN.md", "DEV.diff", "VERIFICATION.json", "VALIDATION.json", "APPLICATION.md", "READ_FIRST.html"]
manifest = {p: hashlib.sha256((OUT / p).read_bytes()).hexdigest() for p in files}
(OUT / "SHA256.json").write_text(json.dumps(manifest, indent=2))
archive = OUT / "TalkHint_data_platform_stage0_rev912.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for name in files + ["SHA256.json"]:
        z.write(OUT / name, name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name, digest in manifest.items():
        assert hashlib.sha256(z.read(name)).hexdigest() == digest
print(json.dumps({"archive": str(archive.relative_to(ROOT)), "size": archive.stat().st_size,
                  "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "hashesVerified": True}))
