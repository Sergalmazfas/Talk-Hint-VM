"""Read-only export of Dev evidence; never opens app, DB, mail or model API."""
import json,hashlib,zipfile,difflib,subprocess
from pathlib import Path
p=Path("generated-artifacts/hint-unknown-owner-rule-v1")
read=lambda f:json.loads(Path(f).read_text())
summary=read(p/"SUMMARY.json");receipt=read(p/"READBACK.json");plan=read(p/"PREFLIGHT.json")
result=read(p/"RESULT.json")
report=read(p/"REPORT.json")
readability=[]
for model in ["gpt-4.1-mini","gpt-5.6-terra"]:
 for phase in ["before","after"]:
  candidates=[x[phase] for x in report["pairs"] if x["model"]==model]
  readability.append({"model":model,"phase":phase,"n":len(candidates),
   "meanEnglishCharactersAllCards":round(sum(sum(len(c["en"]) for c in x["cards"]) for x in candidates)/len(candidates),2),
   "meanCards":round(sum(len(x["cards"]) for x in candidates)/len(candidates),3)})
(p/"READABILITY.json").write_text(json.dumps({"basis":"Same paired 82 moments; English Unicode characters across all cards, excluding translation and labels","rows":readability},indent=2))
assert len(result["rows"])==332 and len({x["id"] for x in result["rows"]})==332
assert summary["accountedUSD"]<=5 and receipt["readerVerified"] and not receipt["livePilotEnabled"]
assert "2426 passed" in (p/"tests-final.log").read_text()
assert "MCP runtime inclusion gate PASSED" in (p/"build.log").read_text()
sourceDirs=["server","client/src","shared","talkhint","script"]
manifest=[]
for folder in sourceDirs:
 for f in sorted(Path(folder).rglob("*")):
  if f.is_file() and f.suffix in [".ts",".tsx",".js",".py",".css",".json",".html"]:
   manifest.append({"path":str(f),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()})
for name in ["package.json","package-lock.json"]:
 f=Path(name);manifest.append({"path":name,"sha256":hashlib.sha256(f.read_bytes()).hexdigest()})
(p/"SOURCE_MANIFEST.json").write_text(json.dumps({"scope":"Current Dev working tree, not a production diff","files":manifest},indent=2))
added=["server/benchmark/personalPipelineRoutes.ts","server/secretary/notificationAttempt.ts",
 "server/__tests__/personalHintPilot.test.ts","server/__tests__/secretaryNotificationAttempt.test.ts",
 "server/__tests__/unknownOwnerJudge.test.ts","scripts/hint-unknown-owner-rule.ts",
 "scripts/report-hint-unknown-owner.py","scripts/record-hint-mini-release.ts","scripts/package-hint-mini-release.py"]
baseDiff=(p/"DEV.diff").read_text()
for f in added:
 baseDiff+="".join(difflib.unified_diff([],Path(f).read_text().splitlines(True),fromfile="/dev/null",tofile="b/"+f))
(p/"FULL_DEV.diff").write_text(baseDiff)
frozen=read("generated-artifacts/hint-unified-preflight/frozen-reference-v1.json")
gens=read("generated-artifacts/hint-unified-preflight/execution/generations.json")
judge=read("generated-artifacts/hint-unified-rescore-final/execution/judgments.json")
ids=set(result["commonFixtureIds"]);models={"gpt-4.1-mini","gpt-5.6-terra"}
g=[x for x in gens if x["fixtureId"] in ids and x["model"] in models]
gids={x["id"] for x in g};assert len(g)==166
(p/"BASELINE.json").write_text(json.dumps({"fixtures":[x for x in frozen if x["id"] in ids],
 "generations":g,"judgments":[x for x in judge if x["sourceId"] in gids]},ensure_ascii=False))
limitations=[
 "Пилот и новое правило промпта не включены; общая модель не менялась.",
 "Уведомления Кати: остановлены слепые повторы, но отсутствующий ordinary APNs сертификат не выдан и не исправлен. Сбой/неясная доставка = unknown, не SENT. История поручения сохраняется.",
 "Время до экрана не включено как готовое измерение: сейчас подтверждены ACK/отметки клиента; часы iPhone не сверены, точный speech-end→screen не доказан.",
 "Закрытый личный селектор проверен HTTP/кодом/сборкой, но не глазами в авторизованном браузере. Публичная главная проверена на 402×874.",
 "FULL_DEV.diff сравнивает с HEAD до текущей работы, а не с production: точный исходный SHA действующего релиза не получен. SOURCE_MANIFEST фиксирует весь текущий исходный снимок; публикуется текущий проект целиком.",
 "Первый тестовый запуск: 2 старых теста модели компании вышли за тайм-аут. Повтор с одним worker после завершения стенда: 2426 passed, 28 skipped, без изменений тестовых нормативов.",
 "В стенде один неизвестный исход судьи; сравнение на общих 82 моментах. Есть спорные AI-оценки условных вариантов, они сохранены и не исправлялись на удобные."
]
checklist={"ownerPublishRequired":True,"publishPerformed":False,"newIPhoneBuildRequiredForThisDiff":False,
 "runtimeChanges":["Personal Mini option for exact owner ID; per-call override guard; one-click Terra rollback preserving saved STT",
 "Secretary notification: pending-only claim; stale sending and ambiguous failures become unknown, no automatic replay"],
 "verification":{"testsPassed":2426,"testsSkipped":28,"typecheck":"passed","build":"passed","devRestart":"serving port 5000","publicMobileScreenshot":"passed"},
 "afterPublish":["HEAD.07 проверяет работу production-лаборатории и готовность доставки писем. До проверки новый пилот не запускать.",
 "После подтверждения включённой лаборатории и реальных писем: отдельное включение личной настройки Mini владельцем, не автоматикой.",
 "Принятый порядок: Terra → Mini → Mini → Terra. Никакой смены модели для остальных пользователей."],
 "canonical":receipt,"limitations":limitations,"benchCostUSD":summary["accountedUSD"]}
(p/"RELEASE_CHECKLIST.json").write_text(json.dumps(checklist,ensure_ascii=False,indent=2))
md=["# Hint Mini + остановка повторов Кати — пакет Dev",
 "## Что входит",
 "1. Mini появляется в личном селекторе только привязанного аккаунта владельца. Защита на GET/PUT и при чтении конфигурации нового звонка.",
 "2. «Вернуть Terra» — одно нажатие, STT сохраняется. Ни настройка владельца, ни глобальная модель не переключались.",
 "3. Неопределённая доставка отчёта секретаря больше не возвращается в автоматическую очередь. Сами поручения/история не удаляются.",
 "4. Стенд правила: PREFLIGHT, BASELINE, RESULT, REPORT, SUMMARY, FLAG_AUDIT; ничего из нового правила в рабочий Hint не перенесено.",
 "## Проверено",
 "2426 тестов прошли; 28 пропущены существующими условиями. TypeScript и release-candidate build прошли; MCP bundle gate прошёл.",
 "Dev перезапущен штатным workflow, работает на 5000; публичная главная снята на телефоне. Закрытая карточка: HTTP-тесты и сборка, не signed-in визуальная проверка.",
 f'## Сохранено: ревизия {receipt["revision"]}',
 "DOC-HINT-UNIFIED-REPLAY v10; DOC-HINT-UNIFIED-RESCORE-PREFLIGHT v7; журнал v21; личный протокол v2. IDs, прочие документы и operational model сохранены; проверено чтением модельного reader.",
 "## Как публиковать",
 "В Replit — Publish/Republish текущего проекта. Это действие делает владелец. Новая сборка Xcode для этого diff не требуется: Swift не менялся.",
 "Пилот сейчас не включать. Сначала проверка production-лаборатории и фактических писем. Затем ранее принятый порядок Terra → Mini → Mini → Terra.",
 "## Важные ограничения",*["- "+x for x in limitations],
 "## Файлы",
 "- FULL_DEV.diff — весь diff; SOURCE_MANIFEST.json — контрольный список исходников.",
 "- RELEASE_CHECKLIST.json — точные проверки, границы и дальнейшие ворота.",
 "- REPORT.md — короткий результат стенда, REPORT.json — каждый момент и спорные оценки.",
 "- PILOT-v2.json и READBACK.json — выгрузка реально сохранённой модели, не черновик.",
 f'- Расчётный консервативный учёт стенда: ${summary["accountedUSD"]:.6f}, предел $5; не счёт провайдера.']
(p/"README.md").write_text("\n\n".join(md))
names=["README.md","FULL_DEV.diff","SOURCE_MANIFEST.json","RELEASE_CHECKLIST.json","PREFLIGHT.json",
 "BASELINE.json","RESULT.json","REPORT.json","REPORT.md","SUMMARY.json","READABILITY.json","FLAG_AUDIT.json","PILOT-v2.json",
 "READBACK.json","tests.log","tests-final.log","typecheck.log","build.log"]
build=Path("generated-artifacts/talkhint-release-candidate/dist/mcp-build-receipt.json")
out=p/"Hint_Mini_Secretary_Dev_release_v1.zip"
with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
 for name in names:z.write(p/name,name)
 z.write(build,"mcp-build-receipt.json")
 for name in added:z.write(name,"source/"+name)
with zipfile.ZipFile(out) as z:assert z.testzip() is None
print(json.dumps({"zip":str(out),"bytes":out.stat().st_size,"records":len(result["rows"]),"canonicalRevision":receipt["revision"]}))
