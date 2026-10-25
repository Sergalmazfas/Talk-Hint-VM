import React, { useEffect, useMemo, useState } from "react";
import {
  quarterChanges,
  quarterDirectory,
  researchRows,
  type QuarterlyCompetitorSnapshot,
} from "@shared/competitorResearch";
import { competitorSnapshotDiff, type CompetitorDirectory } from "@shared/projectCompetitors";
import type { ModelCommand } from "@shared/projectModel";
import { strategyHref } from "@shared/projectStrategy";
import StrategyPositionMap from "@/components/project-model/StrategyPositionMap";

type Props = {
  directory: CompetitorDirectory;
  submit?: (command: ModelCommand) => Promise<boolean>;
  saving: boolean;
};

function quarterNow(date = new Date()) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}
function quarterLabel(snapshot: QuarterlyCompetitorSnapshot) {
  return `${snapshot.quarter} · ${dateLabel(snapshot.capturedAt)}`;
}
function fieldLabel(path: string) {
  return path
    .replace(/^research\.features\./, "Функция · ")
    .replace(/^research\.geography\.service\.(\d+)\./, (_, index: string) => `География сервиса ${Number(index) + 1} · `)
    .replace(/^research\.geography\.phoneNumbers\.(\d+)\./, (_, index: string) => `Телефонные номера ${Number(index) + 1} · `)
    .replace(/^research\.geography\.customers\.(\d+)\./, (_, index: string) => `География клиентов ${Number(index) + 1} · `)
    .replace(/^research\.languages\.(\d+)\./, (_, index: string) => `Язык ${Number(index) + 1} · `)
    .replace(/^plans\.(\d+)\./, (_, index: string) => `Тариф ${Number(index) + 1} · `)
    .replace(/^offer\./, "Предложение · ");
}

export default function CompetitorQuarterArchive({ directory, submit, saving }: Props) {
  const quarters = directory.quarters ?? [];
  const [captureOpen, setCaptureOpen] = useState(false);
  const [quarter, setQuarter] = useState(quarterNow());
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [notice, setNotice] = useState("");
  const [beforeId, setBeforeId] = useState(quarters.length > 1 ? quarters[quarters.length - 2].id : "");
  const [afterId, setAfterId] = useState(quarters.length ? quarters[quarters.length - 1].id : "");

  useEffect(() => {
    if (quarters.length && !quarters.some((item) => item.id === afterId)) setAfterId(quarters[quarters.length - 1].id);
    if (quarters.length > 1 && !quarters.some((item) => item.id === beforeId)) setBeforeId(quarters[quarters.length - 2].id);
  }, [quarters, beforeId, afterId]);

  const before = quarters.find((item) => item.id === beforeId);
  const after = quarters.find((item) => item.id === afterId);
  const changes = useMemo(() => before && after && before.id !== after.id
    ? quarterChanges(directory, before, after) : [], [directory, before, after]);
  const oldRows = before ? researchRows(quarterDirectory(directory, before)) : [];
  const newRows = after ? researchRows(quarterDirectory(directory, after)) : [];
  const beforeRows = new Map(oldRows.map((row) => [row.id, row]));

  async function capture(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submit || !reason.trim() || !direction.trim()) return;
    setCaptureError("");
    const ok = await submit({
      type: "captureCompetitorQuarter",
      quarter: quarter.trim(),
      reason: reason.trim(),
      direction: direction.trim(),
    });
    if (ok) {
      setNotice("Квартальный снимок сохранён.");
      setReason("");
      setDirection("");
      setQuarter(quarterNow());
      setCaptureOpen(false);
    } else {
      setCaptureError("Снимок не сохранён. Проверьте сообщение об ошибке и повторите действие.");
    }
  }

  return <section className="pm-cr-quarter">
    <div className="pm-cr-workbench-head">
      <div><p className="pm-kicker">MANUAL ARCHIVE / QUARTERLY</p><h3>Квартальные снимки исследования</h3>
        <p>Внешний квартальный отчёт из ChatGPT проходит только ручной разбор → ручное обновление карточки → ручной снимок. Нет автоматической записи-интеграции, сбора, проверки или расписания.</p></div>
      {submit && <button className="pm-btn primary" type="button" disabled={saving} onClick={() => { setQuarter(quarterNow()); setCaptureOpen((open) => !open); setCaptureError(""); }}>Снять квартальный снимок</button>}
    </div>
    {notice && <p className="pm-cr-workbench-notice" role="status">{notice}</p>}
    {captureOpen && <form className="pm-cr-capture-form" onSubmit={(event) => void capture(event)}>
      <label>Квартал<input required value={quarter} readOnly aria-describedby="pm-cr-quarter-current-only" /></label>
      <label>Причина снимка<input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="pm-cr-full">Направление / вывод исследования<textarea required value={direction} onChange={(event) => setDirection(event.target.value)} /></label>
      <p className="pm-cr-full" id="pm-cr-quarter-current-only">Сохраняется текущий квартал. Исторические кварталы нельзя создать задним числом. Направление — ручной вывод для архива, не автоматическое доказательство запуска или изменения функции.</p>
      {captureError && <span role="alert" className="pm-cr-form-error pm-cr-full">{captureError}</span>}
      <div className="pm-cr-full"><button className="pm-btn primary" type="submit" disabled={saving || !reason.trim() || !direction.trim()}>{saving ? "Сохраняем…" : "Сохранить снимок"}</button></div>
    </form>}
    {!quarters.length ? <div className="pm-cd-empty">Квартальных снимков нет. Создайте первый вручную, когда будет зафиксирована причина и вывод.</div> : <>
      <div className="pm-cr-quarter-comparison">
        <label>Сравнить с кварталом<select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>
          <option value="">Выберите снимок</option>{quarters.map((item) => <option value={item.id} key={item.id}>{quarterLabel(item)}</option>)}
        </select></label>
        <label>Текущий снимок<select value={afterId} onChange={(event) => setAfterId(event.target.value)}>
          <option value="">Выберите снимок</option>{quarters.map((item) => <option value={item.id} key={item.id}>{quarterLabel(item)}</option>)}
        </select></label>
      </div>
      {quarters.map((item) => <article className="pm-cr-quarter-card" key={item.id}>
        <div><strong>{item.quarter}</strong><span>{dateLabel(item.capturedAt)} · {item.competitorVersions.length} карточек · методика исследования v{item.methodologyVersion}</span></div>
        <p><b>Причина:</b> {item.reason}</p>
        <p><b>Ручной вывод направления:</b> {item.direction}</p>
        {item.strategyMap && <details className="pm-cr-quarter-method">
          <summary>Снимок отдельной методики карты · {item.strategyMap.data.title} · версия {item.strategyMap.version}</summary>
          <p>Метод: {item.strategyMap.data.mode === "expert" ? "Экспертная оценка" : "scenario_v2"} · {dateLabel(item.strategyMap.at)} · {item.strategyMap.actor}. Это точная методика на момент снимка; она не заменяет и не сравнивается напрямую с полем «методика исследования v{item.methodologyVersion}».</p>
          <div className="pm-cr-quarter-axes">{(["x", "y"] as const).map((axis) => <section key={axis}>
            <strong>{axis.toUpperCase()} · {item.strategyMap!.data[axis].name}</strong>
            <span>{item.strategyMap!.data[axis].definition}</span>
            <small>{item.strategyMap!.data[axis].direction} · шкала {item.strategyMap!.data[axis].scaleMin}–{item.strategyMap!.data[axis].scaleMax}</small>
            <p>{item.strategyMap!.data[axis].criteria}</p>
            <small>Основания: {item.strategyMap!.data[axis].basisRefs.length ? item.strategyMap!.data[axis].basisRefs.map((ref) => <a key={ref} href={strategyHref(ref)}>{ref}</a>) : "не указаны"}</small>
          </section>)}</div>
          {item.strategyMap.data.points.length ? <div className="pm-cr-quarter-point-wrap"><table><thead><tr><th>Запись</th><th>X</th><th>Y</th><th>Обоснование и основания</th></tr></thead><tbody>{item.strategyMap.data.points.map((point) => <tr key={point.ref}><th><a href={strategyHref(point.ref)}>{point.ref}</a></th><td>{point.x ?? "Не определено"}</td><td>{point.y ?? "Не определено"}</td><td>{point.rationale || "Обоснование не указано"}{point.basisRefs.length > 0 && <small>Основания: {point.basisRefs.map((ref) => <a key={ref} href={strategyHref(ref)}>{ref}</a>)}</small>}</td></tr>)}</tbody></table></div>
            : <p>В сохранённой методике нет явных точек.</p>}
          <section className="pm-cr-quarter-frozen"><strong>Замороженные расчёты метода на момент снимка</strong><span>Дата расчёта: {item.strategyMap.calculatedAt || "не записана"}. Исторические v2 значения не пересчитываются из текущих карточек.</span>
            <StrategyPositionMap version={item.strategyMap} historical />
            {item.strategyMap.calculations?.length ? <div className="pm-cr-quarter-point-wrap"><table><thead><tr><th>Запись</th><th>X</th><th>Y</th><th>Диапазон</th><th>Объяснение</th></tr></thead><tbody>{item.strategyMap.calculations.map((result, index) => <tr key={`${result.ref}-${index}`}><th><a href={strategyHref(result.ref)}>{result.name}</a></th><td>{result.x ?? "Не определено"}</td><td>{result.y ?? "Не определено"}</td><td>{result.lower}–{result.upper}</td><td>{result.reason || "Не указано"}</td></tr>)}</tbody></table></div>
              : <p>Замороженные расчёты для этой версии не сохранены.</p>}
            {item.strategyMap.basisVersions?.length ? <small>Зафиксированные версии оснований: {item.strategyMap.basisVersions.map((basis) => <a key={basis.ref} href={strategyHref(basis.ref)}>{basis.ref} · v{basis.version ?? "не указана"}</a>)}</small> : <small>Версии оснований не сохранены.</small>}
          </section>
        </details>}
        {!item.strategyMap && <p className="pm-cr-quarter-legacy-note">В этом старом снимке сохранена только методика исследования v{item.methodologyVersion}; снимка стратегической карты нет.</p>}
      </article>)}
      {before && after && before.id !== after.id ? <div className="pm-cr-quarter-changes">
        <div className="pm-cr-section-head"><span>ARCHIVE DIFF</span><h4>Изменения сохранённых сведений</h4></div>
        {changes.length ? changes.map((change) => {
          const old = beforeRows.get(change.id);
          const current = newRows.find((row) => row.id === change.id);
          const diff = old && current ? competitorSnapshotDiff(old.snapshot, current.snapshot) : [];
          return <details className="pm-cr-quarter-diff" key={change.id}>
            <summary>{change.name}{change.added ? " · добавлена в снимок" : ""}</summary>
            <div className="pm-cr-change-tags">
              <span>Функции: {change.features ? "изменены" : "без изменения"}</span>
              <span>Языки: {change.languages ? "изменены" : "без изменения"}</span>
              <span>Покрытие: {change.coverage ? "изменено" : "без изменения"}</span>
              <span>Цены: {change.prices ? "изменены" : "без изменения"}</span>
            </div>
            {diff.length ? <ul>{diff.map((item) => <li key={item.field}><strong>{fieldLabel(item.field)}</strong><span>{item.before} → {item.after}</span></li>)}</ul>
              : <p>Полевая разница не зафиксирована между этими снимками.</p>}
          </details>;
        }) : <div className="pm-cd-empty">Изменений между выбранными снимками не найдено.</div>}
      </div> : <div className="pm-cd-empty">Выберите два разных сохранённых квартала для сравнения.</div>}
    </>}
  </section>;
}
