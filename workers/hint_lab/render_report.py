"""Render a report to a self-contained preview and an UNSENT RFC822 email file."""
import argparse
import html
import json
from email.message import EmailMessage
from pathlib import Path


def render(report, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    m, letter = report["metrics"], report["letter"]
    unknown = lambda v: "неизвестно" if v is None else str(v)
    subject = (f'[Лаборатория · Hint] {report["ended_at"]} · {"/".join(report["languages"])} · '
               f'{unknown(report["duration_ms"])} мс · ошибок (AI) {unknown(m["ai_classified_errors"])} · '
               f'пропущено {unknown(m["confirmed_missed_hints"])} · {report["qa_status"]}')
    parts = ["СИНТЕТИЧЕСКИЙ ЗВОНОК — НЕ ОТПРАВЛЕНО" if report["synthetic"] else "ОТЧЁТ — ФАЙЛ, НЕ ОТПРАВЛЕНО",
             subject, "", "Итог", letter["summary_ru"], "", "Качество (оценка AI)", letter["quality_ru"],
             "", "QA", report["qa_status"], *report["qa_issues"], "", "Разбор событий"]
    for finding in report["analysis"]["findings"]:
        parts.append(f'{finding["event_id"]}: {finding["category"]}\n'
                     f'Основание: {finding["evidence"]}\n{finding["explanation"]}')
    parts += ["", "Ограничения", *report["analysis"]["limitations"], *letter["limitations_ru"],
              f'WER: {unknown(m["wer"])}', f'Цена минуты: {unknown(m["minute_price"])}',
              f'Latency: {unknown(m["latency"])}',
              "Replay: не выполнен, новых прогонов нет", "", "Предложения", *letter["proposals_ru"],
              "", "Это проверка на вымышленных данных, не проверка iPhone/PSTN/Gmail.",
              "Cloud CrewAI не используется. Письмо не отправлялось. Приёмка владельцем не зафиксирована."]
    body = "\n".join(parts)
    page = """<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>P.LAB — пробное письмо, не отправлено</title>
<style>body{margin:0;background:#f3f7f6;color:#153833;font:17px/1.6 system-ui}
main{max-width:850px;margin:30px auto;padding:24px;background:white;border-radius:16px}
h1{font-size:26px;line-height:1.25}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.notice{background:#fff3ce;padding:14px;border-radius:8px;font-weight:700}
details{border-top:1px solid #ddd;padding-top:15px}summary{cursor:pointer;font-weight:600}
@media(max-width:550px){main{margin:0;padding:18px;border-radius:0}h1{font-size:23px}}</style>
<main><h1>Лаборатория Hint — пробный отчёт</h1>
<p class="notice">Синтетические данные · файл для просмотра · на почту не отправлено</p>
<pre>""" + html.escape(body) + "</pre><details><summary>Машинный результат и учёт вызовов</summary><pre>" + html.escape(
        json.dumps(report, ensure_ascii=False, indent=2)) + "</pre></details></main></html>"
    (directory / "Пробное_письмо_P-LAB.html").write_text(page, encoding="utf-8")
    (directory / "Пробное_письмо_P-LAB.txt").write_text(body, encoding="utf-8")
    message = EmailMessage()
    message["From"] = "laboratory@example.invalid"
    message["To"] = "owner@example.invalid"
    message["Subject"] = subject
    message["X-TalkHint-State"] = "UNSENT-SYNTHETIC"
    message.set_content(body)
    (directory / "Пробное_письмо_НЕ_ОТПРАВЛЕНО.eml").write_bytes(bytes(message))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("report")
    p.add_argument("--directory", default="generated-artifacts/plab-synthetic")
    args = p.parse_args()
    render(json.loads(Path(args.report).read_text()), args.directory)
