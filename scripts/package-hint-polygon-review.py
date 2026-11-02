"""Build a deliberately limited, transcript-free review packet."""
import hashlib
import json
import pathlib
import re
import shutil
import zipfile

root = pathlib.Path("generated-artifacts/hint-polygon")
out = pathlib.Path("generated-artifacts/Hint_New_Polygon_A_Review")
out.mkdir(exist_ok=True)

def load(path):
    return json.loads(path.read_text())

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))

def copy(path, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)

tests = load(root / "tests.json")
ledger = load(root / "series-ledger.json")
held = sum(e["charged"] if e["status"] == "spent" else e["reserve"] for e in ledger["entries"])
unknown = sum(e["reserve"] for e in ledger["entries"] if e["status"] != "spent")
row_paths = list((root / "rows").glob("*.json")) + list((root / "trials").glob("*/rows/*.json"))
rows = [load(p) for p in row_paths]
team_done = load(root / "team/completed.json") if (root / "team/completed.json").exists() else None
journal = load(root / "team/journal.json")
stats = {
    "scope": "ISOLATED_PHASE_A_INCOMPLETE_NOT_READY_FOR_COMPARISON",
    "tests": {"files": len(tests["testResults"]), "tests": tests["numTotalTests"],
              "passed": tests["numPassedTests"], "failed": tests["numFailedTests"],
              "fullProjectSuiteRun": False},
    "typecheck": "passed" if (root / "typecheck.log").stat().st_size == 0 else "see log",
    "canaryAttempts": len(rows), "distinctRecordingsAttempted": len({r["fixtureId"] for r in rows}),
    "validCalls": sum(bool(r["valid"]) for r in rows),
    "invalidCalls": sum(not r["valid"] for r in rows),
    "seriesCapMicroUSD": 15_000_000, "seriesHeldMicroUSD": held,
    "completedUsageEstimateMicroUSD": held - unknown, "unknownHeldMicroUSD": unknown,
    "remainingAccountingMicroUSD": 15_000_000 - held,
    "full36RunStarted": False, "otherArchitecturesImplemented": False,
    "productionTeam": team_done,
    "notChecked": [
        "Full 36-recording baseline and live iPhone end-to-end parity",
        "Independent semantic quality on real full-canary outputs",
        "Positive live JSON-mode judge request after instruction fix (minimal model probe only)",
        "Latest window-alignment/audit/source-snapshot edits against paid providers",
        "Exact source snapshots of early invalid attempts (only hashes retained)",
        "Historical context for 21 missing goals, live cards/strategy",
        "B-F adapters and remaining one-factor implementations",
        "Full test suite of the entire application",
        "Original interrupted HTTP receipt for Foma (full profile/revision readback recovered)",
    ],
}
dump(out / "summary.json", stats)
sources = sorted(pathlib.Path("server/hintPolygon").glob("*.ts")) + [
    pathlib.Path(p) for p in [
        "scripts/hint-polygon.ts", "scripts/hint-polygon-probe.ts", "scripts/prepare-hint-polygon.py",
        "scripts/link-new-hint-polygon-team.mjs", "scripts/complete-new-hint-polygon-team.mjs",
        "scripts/package-hint-polygon-review.py", "docs/claude-hint-polygon-handoff.md",
    ]
]
for path in sources:
    copy(path, out / "code" / path)
dump(out / "source-hashes.json", {
    str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources
})
for name in ["series-ledger.json", "comparison.csv", "tests.json", "tests.log", "typecheck.log",
             "compatibility-probe.json", "execution.json", "prompt-registry.json"]:
    if (root / name).exists():
        copy(root / name, out / "evidence" / name)
for p in row_paths:
    copy(p, out / "evidence" / p.relative_to(root))
for p in [root / "summary.json", *sorted((root / "trials").glob("*/summary.json")),
          *sorted((root / "trials").glob("*/execution.json")),
          *sorted((root / "trials").glob("*/prompt-registry.json"))]:
    copy(p, out / "evidence" / p.relative_to(root))
for name in ["journal.json", "completed.json", "continuation-STOP.json", "STOP.json"]:
    if (root / "team" / name).exists():
        copy(root / "team" / name, out / "team" / name)
for p in (root / "team").glob("*-after.json"):
    d = load(p)
    if p.name == "package-after.json":
        dump(out / "team/proposed-packet.json", {"revision": d["revision"], "hash": d["snapshotHash"], "content": json.loads(d["text"])})
    else:
        profile = json.loads(d["text"])
        dump(out / "team" / p.name, {"revisionAtReadback": d["revision"], "hash": d["snapshotHash"],
                                   "version": profile["version"], "workplace": profile["employeeSections"]["workplace"]})
if (root / "team/final-readbacks.json").exists():
    copy(root / "team/final-readbacks.json", out / "team/interruption-recovery-readbacks.json")

table = "\n".join(
    f"| {p.parent.parent.name if p.parent.parent != root else 'initial'} | "
    f"{r['fixtureId']} | недействителен | {', '.join(r['reasons'])} | "
    f"${r['chargedMicro']/1e6:.6f} |"
    for p, r in zip(row_paths, rows)
)
team_text = (
    f"Описательные записи production завершены: r{team_done['fromRevision']} → "
    f"r{team_done['revision']}, {team_done['calls']} вызовов / {team_done['commands']} команд. "
    "Четыре рабочих места связаны с новым полигоном; у Паши три идеи с источниками еженедельно, веб-поиск разрешён. "
    "Шесть новых уроков Замира/Фомы — только proposed, в связанном дополнении, НЕ приняты и НЕ вшиты в канонические книжки.\n\n"
    "Оператор приостановил запись для дополнительной сверки ID источников. ID подтвердились. "
    "Прерванный ответ записи Фомы не повторялся: полное состояние анкеты, неизменность прочих полей "
    "и +2 revision подтверждены отдельными чтениями. Затем записаны только ещё не записанные Паша и Мария."
) if team_done else "Описательная синхронизация не завершена. См. журнал; неизвестные записи не повторять."
report = f"""# Новый полигон Hint — первый пакет Клавдию

## Короткий итог
1. Старый стенд и рабочий Hint не менялись. Новый офлайн-полигон и baseline A реализованы, но честная базовая линия НЕ принята.
2. Все {len(rows)} контрольные попытки недействительны. Итоговые p50/p95 и качество не получены; полный корпус 36 не запускался, B–F не реализованы/заблокированы.
3. В счётчике серии ${held/1e6:.6f} из $15: ${ (held-unknown)/1e6:.6f} оценка завершённых запросов + ${unknown/1e6:.6f} удержано за unknown. Это не счёт провайдера.

## Проверки
- {len(tests['testResults'])} файлов / {tests['numTotalTests']} тестов: {tests['numPassedTests']} прошли, {tests['numFailedTests']} упали.
- TypeScript и git diff --check пройдены. Полный набор всего проекта НЕ запускался.
- Публичная стартовая страница приложения открывается; signed-in UI не проверялся. Новый UI не добавлялся.
- Новых звонков, изменений Катиного поведения, активаций агентов и Publish нет.

## Платные контрольные попытки (НЕ рейтинг)
| Trial | Fixture | Статус | Причина | Учтено |
|---|---|---|---|---|
{table}

Отдельный минимальный probe судьи — HTTP200, ${7/1e6:.6f}, уже включён в общий счётчик.
В третьей попытке одна физически сопоставленная реплика: 5053 − 2656 ≈ 2397 мс до готового английского слова.
Это лишь диагностический пример, НЕ результат валидного прогона и НЕ доказательство полного live-parity.

## Почему STOP
- Первый запрос судьи получил HTTP400. Ранний текст ошибки не сохранился.
  Обнаружено нарушение JSON-mode: отсутствовала явная инструкция JSON.
  Добавлены инструкция и отказ до reserve/fetch. Минимальный probe доказал доступность модели, не полную совместимость судьи.
- Вторая попытка остановилась на слишком строгой трактовке пустой подсказки.
  Исправлено только в новом harness: как LIVE, null-normalization — отказ, не обрыв стрима.
- Третья остановилась на неподтверждённом хвосте STT/неоднозначном VAD alignment.
  Потерю аудио как установленный факт НЕ заявляем. Ранние оконные детали не записаны.
  Добавлены metadata-only окна/хвосты и тест на допустимое начало VAD до rolling-window.
- Последние изменения проверены локально, повторных платных прогонов после STOP нет.

## Команда
{team_text}

Ни самоприёмки, ни изменения личностей/рабочих промптов/моделей/полномочий нет.
Недельная выдача идей описана, автопланировщик не включён.
Исходные книжки и AI Crew правила не перезаписаны: прежний связанный контракт остаётся, новые уроки — дополнительный предложенный документ.

## Что проверить Клавдию прежде продолжения
1. Метод сопоставления VAD и rolling-window; хвост с шумом/музыкой/неанглийской речью не считать доказанной потерей аудио.
2. Все guest-final, включая отказы, идут судье; пропущенные вопросы не улучшают оценку.
3. Реальное отличие backend-ready от появления слова на iPhone, отсутствующие цели и live-контекст.
4. Общий неизменный бюджет, unknown не повторяется и не обнуляется; invalid не ускоряет таблицу.
5. Снимок исходников для будущих trial; ранние invalid пока не побитово воспроизводимы.

ZIP не является приёмкой и не означает «готово к Publish». Сначала сверка метода, затем новый ограниченный контрольный опыт;
не повторять исходные unknown. Старый стенд и рабочий Hint не трогать.

## Содержимое и приватность
В ZIP код, тесты, рецепты/хэши, журнал расходов, metadata-only строки попыток, предложенный командный пакет и рабочие места.
Нет аудио, транскриптов, номеров, recording SID, private-goals/manifest или значений Secrets.
Подробные границы: code/docs/claude-hint-polygon-handoff.md. Полный перечень непроверенного: summary.json.
"""
(out / "ОТЧЁТ.md").write_text(report)

# Detect obvious credential encodings; do not read Secret values or any .env.
for p in out.rglob("*"):
    if p.is_file():
        text = p.read_text(errors="ignore")
        if re.search(r"\bsk-(?:proj-|ant-)[A-Za-z0-9_-]{40,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", text):
            raise RuntimeError(f"Possible credential in {p.name}; STOP")
archive = pathlib.Path("generated-artifacts/Hint_New_Polygon_A_Review.zip")
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(out.rglob("*")):
        if p.is_file():
            z.write(p, p.relative_to(out))
print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "stats": stats}, ensure_ascii=False))
