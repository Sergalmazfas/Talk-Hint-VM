"""Metadata-only review package. Never exports the private manifest or audio."""
import csv
import hashlib
import json
import pathlib
import subprocess
import zipfile
from datetime import datetime, timezone

ROOT = pathlib.Path("generated-artifacts/hint-polygon")
OUT = ROOT / "recipes-review"
OUT.mkdir(exist_ok=True)

def load(p):
    return json.loads(pathlib.Path(p).read_text())

def digest(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

ledger = load(ROOT / "series-ledger.json")
budget = {s: sum(e["charged"] if s == "spent" else e["reserve"]
                 for e in ledger["entries"] if e["status"] == s) for s in ("spent", "unknown", "reserved")}
assert budget["reserved"] == 0 and sum(budget.values()) <= 15_000_000
names = ["a-clean-panel", "c-clean-panel", "d-clean-fixed", "e-clean-fixed", "f-clean-fixed"]
labels = ["A — контроль", "В — английский сначала", "Г — готовые карточки", "Д — классификатор карточек", "Е — спекуляция"]
panel = load(ROOT / "clean-panel.json")["ids"]
all_rows = {}
keys = []
comparison = []
for name, label in zip(names, labels):
    folder = ROOT / "trials" / name
    rows = [load(folder / "rows" / (i + ".json")) for i in panel]
    all_rows[name] = rows
    physical = {(r["fixtureId"], t["speechEndMs"]) for r in rows for t in r["turns"]
                if t["valid"] and t["speechEndMs"] is not None}
    keys.append(physical)
    s = load(folder / "summary.json")
    comparison.append({
        "recipe": label, "trial": name, "recordings": len(rows),
        "eligible_turns": len(physical),
        "hints": sum(t["valid"] and t["fullHintMs"] is not None for r in rows for t in r["turns"]),
        "first_word_p50_ms": s["timings"]["firstHintWord"]["p50Ms"],
        "first_word_p95_ms": s["timings"]["firstHintWord"]["p95Ms"],
        "full_english_p50_ms": s["timings"]["fullHint"]["p50Ms"],
        "full_english_p95_ms": s["timings"]["fullHint"]["p95Ms"],
        "russian_p50_ms": s["timings"]["translation"]["p50Ms"] if name[0] not in "de" else None,
        "russian_scope": "card translation only; no Guest translation" if name[0] in "de" else "Guest + English reply",
        "quality_complete": s["qualityCalls"] == len(rows),
        "quality_0_to_5": s["quality"] if s["qualityCalls"] == len(rows) else None,
        "partial_quality_diagnostic": s["quality"] if s["qualityCalls"] != len(rows) else None,
        "quality_scored_calls": s["qualityCalls"],
        "estimated_cost_per_attempt_usd": s["meanCostPerAttemptMicro"] / 1e6,
        "clock_max_drift_ms": max(r["clockMaxDriftMs"] for r in rows),
        "notes": "one zero-hint call was not judged by the old guard; raw data unchanged; guard fixed for future runs" if name[0] == "e" else "",
    })
assert all(k == keys[0] for k in keys) and len(keys[0]) == 24
spec = [a for r in all_rows["f-clean-fixed"] for a in r.get("providerAudit", []) if a.get("stage") == "speculation"]

groups = {}
for short, title, expected in (("goal", "saved-goal", 15), ("no-goal", "no-goal", 21)):
    folder = ROOT / "trials" / f"a-qc30-{short}-full"
    s = load(folder / "summary.json")
    rows = [load(f) for f in (folder / "rows").glob("*.json")]
    attempted = {r["fixtureId"] for r in rows}
    groups[title] = {
        "expected": expected, "attempted": len(rows), "valid": s["validCalls"],
        "invalid": s["invalidCalls"], "not_attempted": expected - len(rows),
        "not_attempted_unknown": [i for i in s["withheldUnknownFixtureIds"] if i not in attempted],
        "legacy_withheld_field_overlaps_attempted": [i for i in s["withheldUnknownFixtureIds"] if i in attempted],
        "timings": s["timings"], "quality": s["quality"],
        "invalid_reasons": [{"fixture": r["fixtureId"], "reasons": r["reasons"]} for r in rows if not r["valid"]],
    }

native = []
for name in ("b0-native-goal-panel", "b1-native-goal-panel", "b-gemini-canary", "b-gemini-goal-canary"):
    for f in (ROOT / "trials" / name / "rows").glob("*.json"):
        r = load(f)
        native.append({"trial": name, "fixture": r["fixtureId"], "valid": r["valid"],
                       "reasons": r["reasons"], "charged_or_held_micro": r["chargedMicro"]})

result = {
    "generated": datetime.now(timezone.utc).isoformat(),
    "status": "review_required_not_live_acceptance",
    "groups": groups, "comparison": comparison, "native_failed_attempts": native,
    "shared_physical_eligible_turns": 24,
    "speculation": {"attempts": len(spec), "reused": sum(bool(a["used"]) for a in spec),
                    "discarded": sum(not a["used"] for a in spec)},
    "series_budget_micro": 15_000_000, "series_accounting_micro": budget,
    "series_held_micro": sum(budget.values()),
    "cost_warning": "Frozen project rates and conservative unknown reserves, NOT provider invoice. Public pricing snapshot did not identify the gpt-5.6-terra alias; its mapping/rate is not independently verified. No further paid requests.",
    "scope": "Only new isolated CLI polygon. Existing bench, live Hint, Katya, production model, agents and Publish unchanged.",
    "tests": {k: load(ROOT / "tests-recipes-final.json")[k] for k in ("numPassedTests", "numFailedTests")},
    "test_files": len(load(ROOT / "tests-recipes-final.json")["testResults"]),
    "base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "row_hashes": {str(f): digest(f) for f in (ROOT / "trials").glob("*/rows/*.json")},
    "next_product_changes_require_owner_yes": True,
}
(OUT / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
with (OUT / "comparison.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=comparison[0].keys())
    writer.writeheader()
    writer.writerows(comparison)

readme = f"""# Hint: результаты A и пробных Б–Е — на проверку Клавдию

Не приёмка и не разрешение менять рабочий продукт. Код только изолированного CLI.

## Основная базовая линия
- 15 записей с сохранённой целью: 14 попыток, 13 действительны, одна >30% плохих реплик; один прежний unknown не повторён.
- 21 запись без цели: все 21 попытка, 17 действительны, одна >30% плохих реплик и три с потерей аудиочасов.
- Итого 35/36 попыток, 30 действительных. Не все попытки были проиграны до конца: clock-invalid потоки прерваны, включая длинную запись.
- Сохранённая цель, 187 English-подсказок: p50 1.754 с, p95 2.931 с, автоматическая оценка 4.46/5.
- Без цели: p50 1.949 с, p95 3.192 с. Цели не выдуманы; оценка не доказывает достижение неизвестной цели.
- С живыми 2–5 с есть пересечение, но это НЕ live parity: сеть, отрисовка iPhone и реальный production-контекст не измерялись.
- Основной и вторичный корпус: по 4 параллельных записи, каждая 1x. Панель вариантов — 3 параллельных, потому что в ней три записи.

## Честное сравнение вариантов
comparison.csv: одни и те же три чистые записи, 24 одинаковых физических конца речи.
Два неоднозначных фрагмента исключены отдельно; нельзя считать только быстрые успешные ответы.
Скорость — от физического конца речи по VAD до готового English, не от отправки HTTP.
Порог плохих реплик строго >30%; API/clock сбои не становятся хорошими от этого послабления.
VAD есть на обоих каналах, но знаменатель QC этого replay — измеряемые Guest-реплики.
Качество — независимый gpt-4.1-mini, среднее по звонкам, не решение Фомы/Клавдия/владельца.
Архитектурные рецепты меняют несколько механизмов одновременно; это НЕ причинное доказательство одного фактора.
Кэш provider-auto, порядок не рандомизирован, повторных доверительных интервалов нет.

- A: 24/24, p50 English 1.701 с, качество 4.56.
- В/C: SSE English первым — p50 первого слова 1.135 с, полного English 1.283 с; Russian готов p50 2.540 с, позже A (1.701 с). 24/24, качество 4.41. Это кандидат на отдельную проверку, не автоматическое внедрение.
- Г/D: цель → карточки до начала аудиочасов → локальный выбор; p50 0.234 с, но только 9/24 и качество 2.56. Время подготовки карточек не входит в EOT-latency; его отдельный замер не сохранён.
- Д/E: Terra выбирает ID готовой карточки, ничего не переписывает. Только 3/24. Одно полное воздержание старый guard ошибочно объявил invalid до судьи: полная оценка трёх звонков отсутствует. Две оценены, их 3.52 не выдаём за общий результат.
- Guard исправлен: нулевые подсказки теперь идут судье, а не бракуют аудио. Регрессионный тест прошёл. Исторические строки НЕ переписаны; новых платных переоценок не было.
- D/E не переводят текущую Guest-реплику. Готовый Russian карточки не равен готовому переводу собеседника.
- Е/F: {len(spec)} предварительное вычисление, {sum(bool(a["used"]) for a in spec)} переиспользования, остальные оплачены и отброшены; выпуск только после EOT и точного совпадения текста/прошлой истории.
  p50 1.648 с против A 1.701 с: заметного доказанного выигрыша нет.

## Б/native — блокер, не успешный рецепт
Контрольные синтетические ответы OpenAI и Gemini были успешны. Реальные многорепликовые проверки — нет.
OpenAI: 250 токенов — незавершённый/невалидный ответ; 500 — completed, но невалидный JSON (выход 111–248, поэтому только лимитом не объяснить).
Gemini: тайм-аут в первом звонке; во втором подтверждён GEMINI_INTERRUPTED, 51 символ, без turnComplete/usage.
Тайм-аут старого звонка не объявляем доказанным следствием отсутствия usage: такой телеметрии тогда не было.
Теперь отсутствие usage не блокирует уже завершённый ответ; полный резерв остаётся unknown. Это покрыто отдельным тестом.
Gemini использует AUDIO-output + output transcription, не TEXT-native: аудио не проигрывается людям.
Транспорт Guest: оригинал 8k G711 → PCM16k повтором отсчётов, без восстановления качества.
Оба прототипа управляются Flux EOT; полноценная native-архитектура с собственным EOT НЕ реализована/не принята.
Ни одного Guest-транскрипта в English native-генератор не отправляем; отдельный Terra-перевод после English — другой запрос.
Неудачные native/clock попытки не попали в сравнительные задержки. Unknown-попытки не повторялись.

## Аудиочасы и диагностика
Декодирование — до всех часов; финансовый fsync асинхронен и завершён до оплачиваемого запроса.
Синхронное сканирование сводок отложено до остановки ВСЕХ часов; metadata строк сохраняется асинхронно.
На чистой панели максимальный drift {max(c['clock_max_drift_ms'] for c in comparison):.3f} мс, новых clock-invalid нет.
Три старых потока теряли часы одновременно. Точная причина общей паузы не доказана; не приписываем её модели.
Сводка старого no-goal содержит withheld IDs, совпадающие с уже attempted: report.json явно разделяет эти множества, не прибавляет их повторно.
Шаблонный prompt-registry не подменяет actual systemHash/systemChars каждого turn. Для D: в EOT нет модельного промпта; подготовка — отдельный запрос. Для E: classifier — отдельный короткий system.

## Деньги
Общий учёт серии: ${sum(budget.values())/1e6:.6f} из $15.
По usage/фиксированным ставкам: ${budget['spent']/1e6:.6f}; unknown полным резервом: ${budget['unknown']/1e6:.6f}; активных reserved: 0.
Это НЕ счёт провайдера. В полученном публичном прайсе не найден alias gpt-5.6-terra.
Его соответствие реальному тарифу НЕ подтверждено: денежные оценки помечены как оценки, публично подтверждённым тарифом их не называем.
Новых оплачиваемых запросов не будет до выяснения этого соответствия.
Все warmup, неудачные варианты, discarded speculation и unknown остались в общем журнале, без сброса бюджета.
Gemini: неразмеченные modality-токены и thinking считаются консервативно; первая поправка 75 microUSD отдельной записью, без изменения старого расхода.
Локальная ошибка метаданных этой поправки (literal вместо SHA) остановила чтение до запросов D.
Исправлен только один payloadHash, денежные поля неизменны; backup/SHA-журнал сохранён. Writer теперь отклоняет невалидные хэши.

## Проверки
{result['test_files']} файлов, {result['tests']['numPassedTests']} тестов, 0 падений. TypeScript --noEmit прошёл, git diff --check прошёл.
Это выбранные регрессии полигона/старого бенчмарка/provider, НЕ полный Vitest всего приложения.
Публичная главная открывается. Защищённый UI не проверялся; UI не менялся.
Новых телефонных звонков нет. Катя, старый стенд, рабочий Hint, production-модель не изменены.
Агенты не запускались, Publish не требуется.

## Что проверить Клавдию
Целостность source-snapshot/row hashes; физические 24 совпадающих конца речи; QC >30% и учёт пропусков;
English milestones из настоящего SSE; отсутствие будущего текста/Guest-транскриптов в native;
полный unknown reserve; тариф alias Terra; раскрытые ограничения и отказ от самоприёмки.
Сырых аудио, целей, транскриптов, карточек/подсказок и ключей в ZIP нет.
"""
(OUT / "README.md").write_text(readme)
(OUT / "SHA256SUMS.json").write_text(json.dumps({str(p.relative_to(ROOT)): digest(p)
    for p in [OUT / "report.json", OUT / "comparison.csv", ROOT / "series-ledger.json"]}, indent=2))
archive = ROOT.parent / "Hint_Polygon_A_F_Review.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for p in OUT.iterdir():
        z.write(p, "report/" + p.name)
    for name in ("series-ledger.json", "local-ledger-metadata-repair.json", "gemini-live-control.json",
                 "native-format-control.json", "official-openai-pricing-snapshot.json",
                 "tests-recipes-final.json", "typecheck-recipes-final.log"):
        p = ROOT / name
        if p.exists():
            z.write(p, "evidence/" + name)
    for p in (ROOT / "trials").glob("*/*"):
        if p.name in ("summary.json", "execution.json", "source-snapshot.json", "prompt-registry.json"):
            z.write(p, "attempts/" + str(p.relative_to(ROOT / "trials")))
    for p in (ROOT / "trials").glob("*/rows/*.json"):
        z.write(p, "attempts/" + str(p.relative_to(ROOT / "trials")))
    for p in pathlib.Path("server/hintPolygon").rglob("*.ts"):
        z.write(p, "current-source/" + str(p))
    for name in ("hint-polygon.ts", "probe-hint-native-format.ts", "probe-hint-gemini-live.ts",
                 "package-hint-polygon-recipes.py"):
        p = pathlib.Path("scripts") / name
        if p.exists():
            z.write(p, "current-source/" + str(p))
print(json.dumps({"zip": str(archive), "bytes": archive.stat().st_size, "heldUSD": sum(budget.values()) / 1e6,
                  "comparison": str(OUT / "comparison.csv"), "matchedTurns": 24}, ensure_ascii=False))
