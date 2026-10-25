import React, { useMemo } from "react";
import {
  CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import type { StrategyEntry, StrategyMapVersion } from "@shared/projectStrategy";
import { strategyHref } from "@shared/projectStrategy";

type Props = {
  version: StrategyMapVersion;
  entries?: Map<string, StrategyEntry>;
  historical?: boolean;
};
type SavedPoint = {
  ref: string;
  name: string;
  x: number | null;
  y: number | null;
  lower: number | null;
  upper: number | null;
  reason: string;
  basisRefs: string[];
};

const sourceUrls = (entry?: StrategyEntry) => {
  if (!entry) return [];
  if (entry.sourceUrls.length) return entry.sourceUrls;
  const value = entry.value as { sourceUrls?: string[]; evidence?: { sourceUrls?: string[] } } | null;
  return value?.evidence?.sourceUrls ?? value?.sourceUrls ?? [];
};
const pointGroup = (ref: string) => ref === "talkhint:current" ? "current" : ref === "talkhint:target" ? "target" : "other";
const numberText = (value: number | null) => value === null ? "Не определено" : String(value);

export default function StrategyPositionMap({ version, entries = new Map(), historical = false }: Props) {
  const method = version.data;
  const points = useMemo<SavedPoint[]>(() => {
    if (method.mode === "expert") return method.points.map((point) => ({
      ref: point.ref,
      name: historical ? point.ref : entries.get(point.ref)?.title ?? point.ref,
      x: point.x, y: point.y, lower: null, upper: null, reason: point.rationale, basisRefs: point.basisRefs,
    }));
    return (version.calculations ?? []).map((calculation) => ({
      ref: calculation.ref, name: calculation.name, x: calculation.x, y: calculation.y,
      lower: calculation.lower, upper: calculation.upper, reason: calculation.reason,
      basisRefs: [],
    }));
  }, [entries, historical, method.mode, method.points, version.calculations, version.basisVersions]);

  const plotted = points.filter((point) => point.x !== null && point.y !== null);
  const insufficient = points.filter((point) => point.x === null || point.y === null);
  const grouped = {
    current: plotted.filter((point) => pointGroup(point.ref) === "current"),
    target: plotted.filter((point) => pointGroup(point.ref) === "target"),
    other: plotted.filter((point) => pointGroup(point.ref) === "other"),
  };
  const axesValid = method.x.scaleMax > method.x.scaleMin && method.y.scaleMax > method.y.scaleMin;
  const versionByRef = new Map((version.basisVersions ?? []).map((item) => [item.ref, item.version]));

  function PointTooltip({ active, payload }: { active?: boolean; payload?: { payload?: SavedPoint }[] }) {
    const point = active ? payload?.[0]?.payload : undefined;
    if (!point) return null;
    const entry = historical ? undefined : entries.get(point.ref);
    const urls = sourceUrls(entry);
    const methodBases = version.basisVersions ?? [];
    return <div className="pms-map-tooltip">
      <strong>{point.name}</strong>
      <span>X {numberText(point.x)} · Y {numberText(point.y)}</span>
      {point.lower !== null && point.upper !== null && <span>Сохранённый диапазон: {point.lower}–{point.upper}</span>}
      {point.reason && <p>{point.reason}</p>}
      {!!point.basisRefs.length && <small>Основания: {point.basisRefs.map((ref) => `${ref}${versionByRef.has(ref) ? ` · v${versionByRef.get(ref)}` : ""}`).join(", ")}</small>}
      {method.mode === "scenario_v2" && methodBases.length > 0 && <div><small>Основания методики на момент снимка</small>{methodBases.map((basis) => <a key={basis.ref} href={strategyHref(basis.ref)}>{basis.ref} · v{basis.version ?? "не указана"}</a>)}</div>}
      {entry && <a href={strategyHref(entry.key)}>Открыть текущую запись источника</a>}
      {urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}
      {historical && <small>Координаты и подпись взяты из сохранённой версии, не из текущих карточек.</small>}
    </div>;
  }

  return <section className="pms-position-map" aria-label={`${method.title} · ${historical ? "историческая" : "текущая"} карта`}>
    <div className="pms-position-map-head">
      <div><strong>{historical ? "Историческая геометрия" : method.mode === "expert" ? "Сохранённые экспертные координаты" : "Сохранённые расчёты методики"}</strong>
        <span>{method.x.name} × {method.y.name}</span></div>
      <small>{historical ? `Снимок v${version.version} · ${version.calculatedAt || version.at}` : `Версия v${version.version} · ${version.calculatedAt || "расчёт не сохранён"}`}</small>
    </div>
    <div className="pms-position-legend" aria-label="Легенда карты">
      <span><i className="current" />TalkHint · текущая версия</span><span><i className="target" />TalkHint · целевая позиция</span><span><i className="other" />Другие участники</span>
    </div>
    {axesValid && plotted.length > 0 ? <div className="pms-position-chart">
      <ResponsiveContainer width="100%" height={330}>
        <ScatterChart margin={{ top: 18, right: 22, bottom: 32, left: 28 }}>
          <CartesianGrid stroke="#d8e5e5" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" name={method.x.name} domain={[method.x.scaleMin, method.x.scaleMax]} allowDataOverflow
            label={{ value: `${method.x.name} · ${method.x.direction}`, position: "insideBottom", offset: -18 }} />
          <YAxis type="number" dataKey="y" name={method.y.name} domain={[method.y.scaleMin, method.y.scaleMax]} allowDataOverflow width={84}
            label={{ value: `${method.y.name} · ${method.y.direction}`, angle: -90, position: "insideLeft" }} />
          <Tooltip content={<PointTooltip />} />
          <Legend />
          <Scatter name="TalkHint · текущая версия" data={grouped.current} fill="#087e83" shape="circle" isAnimationActive={false} />
          <Scatter name="TalkHint · целевая позиция" data={grouped.target} fill="#a96720" shape="triangle" isAnimationActive={false} />
          <Scatter name="Другие участники" data={grouped.other} fill="#647e8a" shape="square" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div> : <p className="pms-position-empty">{axesValid ? "Нет точек с сохранёнными координатами для отображения." : "Диапазон сохранённых осей некорректен; координаты не масштабировались автоматически."}</p>}
    {insufficient.length > 0 && <section className="pms-position-unknown">
      <h4>Недостаточно данных для точки · {insufficient.length}</h4>
      {insufficient.map((point) => <article key={point.ref}>
        {!historical && entries.get(point.ref) ? <a href={strategyHref(point.ref)}>{point.name}</a> : <strong>{point.name}</strong>}
        <span>X: {numberText(point.x)} · Y: {numberText(point.y)}</span>
        {point.lower !== null && point.upper !== null && <small>Сохранённая неопределённость: {point.lower}–{point.upper}</small>}
        {point.reason && <p>{point.reason}</p>}
      </article>)}
    </section>}
    {version.basisVersions && version.basisVersions.length > 0 && <details className="pms-position-sources" open>
      <summary>Основания карты, замороженные в версии · {version.basisVersions.length}</summary>
      {version.basisVersions.map((basis) => <article key={basis.ref}>
        <a href={strategyHref(basis.ref)}>{entries.get(basis.ref)?.title ?? basis.ref}</a>
        <span>Версия на момент снимка: {basis.version ?? "не указана"}</span>
        {historical && <small>Ссылка открывает текущую карточку для инспекции; карта сохраняет указанную историческую версию основания.</small>}
      </article>)}
    </details>}
    {plotted.length > 0 && <details className="pms-position-sources">
      <summary>Точки и основания · {plotted.length}</summary>
      {plotted.map((point) => {
        const entry = historical ? undefined : entries.get(point.ref);
        const urls = sourceUrls(entry);
        return <article key={point.ref}>
          <strong>{point.name}</strong><span>X {point.x} · Y {point.y}</span>
          {point.reason && <p>{point.reason}</p>}
          {point.basisRefs.map((ref) => <a key={ref} href={strategyHref(ref)}>{ref}{versionByRef.has(ref) ? ` · frozen v${versionByRef.get(ref)}` : ""}</a>)}
          {entry && <a href={strategyHref(entry.key)}>Открыть запись источника</a>}
          {urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}
          {historical && <small>Исторический источник может иметь более новую текущую версию; точка не пересчитывалась.</small>}
        </article>;
      })}
    </details>}
  </section>;
}

