import React, { useEffect, useMemo, useState } from "react";
import {
  decisionStatuses, defaultStrategyMap, emptyStrategyDecision, emptyStrategyNode, latestImpactOutcome,
  meaningfulStrategyValue, proofKinds, strategyEntries, strategyGaps, strategyHref, strategyKinds, strategyLinks,
  type ProjectStrategy, type StrategyDecisionInput, type StrategyEntry, type StrategyMapVersion, type StrategyNodeInput,
} from "@shared/projectStrategy";
import type { ModelCommand, ModelElement, ProjectModelState } from "@shared/projectModel";
import { StrategyReferencePicker } from "@/components/project-model/StrategyReferencePicker";
import StrategyPositionMap from "@/components/project-model/StrategyPositionMap";

export type ProjectStrategyWorkspaceProps = {
  state: ProjectModelState;
  submit: (command: ModelCommand) => Promise<boolean>;
  saving: boolean;
  openElement?: (element: ModelElement) => void;
};
export type ProjectStrategySummaryProps = { state: ProjectModelState; openElement?: (element: ModelElement) => void };
type Props = ProjectStrategyWorkspaceProps;
type NodeDraft = { id?: string; baseVersion: number; value: StrategyNodeInput };
type DecisionDraft = { id?: string; baseVersion: number; value: StrategyDecisionInput };
type LinkDraft = { from: string; to: string; kind: "navigation" | "depends_on"; reason: string };

const strategyOf = (state: ProjectModelState): ProjectStrategy =>
  state.strategy ?? { nodes: [], decisions: [], links: [], impacts: [], mapVersions: [] };
const latestNodeInput = (node: ProjectStrategy["nodes"][number]) => node.revisions[node.revisions.length - 1]?.data;
const latestDecisionInput = (decision: ProjectStrategy["decisions"][number]) => decision.revisions[decision.revisions.length - 1]?.data;
const textValue = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};
const entryType = (entry: StrategyEntry) => {
  if (!entry.value || typeof entry.value !== "object") return "";
  const kind = (entry.value as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : "";
};
const evidenceStatusText: Record<string, string> = {
  official_claim: "Заявление компании",
  live_verified: "Проверено вживую",
  verified: "Проверенное наблюдение",
  external_estimate: "Внешняя оценка",
  hypothesis: "Наше предположение",
  unknown: "Не подтверждено",
  provided: "Сведения предоставлены, не проверены",
  planned: "Планируется",
  not_supported: "Не поддерживается",
};
async function fingerprint(value: unknown) {
  const source = JSON.stringify(meaningfulStrategyValue(value)) ?? "null";
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function entryStatus(entry: StrategyEntry) {
  if (!entry.value || typeof entry.value !== "object") return "";
  const record = entry.value as { status?: unknown; evidence?: { status?: unknown } };
  const raw = record.evidence?.status ?? record.status;
  return typeof raw === "string" ? evidenceStatusText[raw] ?? raw : "";
}
function FrozenMapResults({ version, entries }: { version: StrategyMapVersion; entries: Map<string, StrategyEntry> }) {
  return <div className="pms-frozen-results">
    <h4>Сохранённые расчёты этой версии</h4>
    <p>Снимок рассчитан {version.calculatedAt || "дата расчёта не записана"}. Значения не пересчитываются из текущих карточек.</p>
    {version.calculations?.length ? <div className="pms-table-scroll"><table className="pms-table">
      <thead><tr><th>Запись</th><th>X</th><th>Y</th><th>Диапазон</th><th>Объяснение снимка</th></tr></thead>
      <tbody>{version.calculations.map((result, index) => {
        const entry = entries.get(result.ref);
        return <tr key={`${result.ref}-${index}`}><th><a href={strategyHref(result.ref)}>{entry?.title ?? result.name ?? result.ref}</a></th>
          <td>{result.x ?? "Не определено"}</td><td>{result.y ?? "Не определено"}</td>
          <td>{result.lower}–{result.upper}</td><td>{result.reason || "Основание не записано"}</td></tr>;
      })}</tbody>
    </table></div> : <p className="pms-summary-empty">Для этой версии сохранённых расчётов нет; исторические координаты не выводятся из текущих данных.</p>}
    {version.basisVersions?.length ? <div className="pms-map-bases"><b>Версии оснований, зафиксированные снимком</b>{version.basisVersions.map((basis) => {
      const entry = entries.get(basis.ref);
      return <a key={basis.ref} href={strategyHref(basis.ref)}>{entry?.title ?? basis.ref} · v{basis.version ?? "не указана"}</a>;
    })}</div> : <p className="pms-summary-empty">Версии оснований в этом снимке не указаны.</p>}
  </div>;
}
const safeExternal = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
};

export function ProjectStrategySummary({ state, openElement }: ProjectStrategySummaryProps) {
  const entries = strategyEntries(state);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const links = strategyLinks(state);
  const sectionIds = ["TH-PRODUCT", "TH-CLIENT", "TH-PROBLEM", "TH-PILOT-VALUE", "TH-DIFFERENTIATION"];
  const roots = new Set(sectionIds.filter((id) => state.elements.some((element) => element.id === id)).map((id) => `element:${id}`));
  const relevant = new Set(roots);
  const queue = Array.from(roots);
  for (let index = 0; index < queue.length; index++) {
    for (const link of links.filter(link => link.kind === "depends_on" && link.from === queue[index]))
      if (!relevant.has(link.to)) { relevant.add(link.to); queue.push(link.to); }
  }
  const basisRefs = Array.from(new Set(links.filter((link) => link.kind === "depends_on" && relevant.has(link.from)).map((link) => link.to)));
  const bases = basisRefs.map((key) => byKey.get(key)).filter((entry): entry is StrategyEntry => !!entry);
  const verified = bases.filter((entry) => {
    const value = entry.value as { status?: unknown; evidence?: { status?: unknown } } | null;
    const status = value?.evidence?.status ?? value?.status;
    return status === "verified" || status === "live_verified";
  });
  const privateReviews = bases.filter((entry) => entry.kind.startsWith("Личная проверка") || entry.kind.startsWith("Историческая личная проверка"));
  const missions = (state.strategy?.nodes ?? []).map((node) => ({ node, data: node.revisions.at(-1)?.data }))
    .filter(({ data }) => data?.kind === "mission");
  const linkedMissions = missions.filter(({ node }) => relevant.has(`node:${node.id}`));
  const mission = linkedMissions.length === 1 ? linkedMissions[0] : missions.length === 1 ? missions[0] : undefined;
  const assumptions = [
    ...sectionIds.flatMap((id) => {
      const element = state.elements.find((item) => item.id === id);
      return element?.contentStatus === "hypothesis" ? [byKey.get(`element:${id}`)].filter((entry): entry is StrategyEntry => !!entry) : [];
    }),
    ...(state.strategy?.nodes ?? []).flatMap((node) => {
      const data = node.revisions.at(-1)?.data;
      return data?.kind === "hypothesis" && relevant.has(`node:${node.id}`) ? [byKey.get(`node:${node.id}`)].filter((entry): entry is StrategyEntry => !!entry) : [];
    }),
  ];
  const experiments = (state.strategy?.nodes ?? []).map((node) => ({ node, data: node.revisions.at(-1)?.data }))
    .filter(({ node, data }) => data?.kind === "experiment" && relevant.has(`node:${node.id}`) && data.assignment.status !== "done");
  const experiment = experiments.length === 1 ? experiments[0] : undefined;
  const sectionContent = (id: string) => {
    const element = state.elements.find((item) => item.id === id);
    if (!element) return null;
    return { element, entry: byKey.get(`element:${id}`) };
  };
  const sections = [
    ["Клиент", "TH-CLIENT"], ["Проблема", "TH-PROBLEM"], ["Предложение продукта", "TH-PRODUCT"],
    ["Ценность пилота", "TH-PILOT-VALUE"], ["Отличие", "TH-DIFFERENTIATION"],
  ].map(([label, id]) => ({ label, content: sectionContent(id) }));
  const product = state.elements.find((element) => element.id === "TH-PRODUCT");
  const paymentBasis = product?.details.businessModel?.trim() || product?.details.economics?.trim() ||
    state.elements.find((element) => element.id === "TH-PILOT-VALUE")?.details.economics?.trim() || "";

  function RecordLink({ entry }: { entry: StrategyEntry }) {
    const elementId = entry.key.startsWith("element:") ? entry.key.slice(8) : "";
    const element = state.elements.find((item) => item.id === elementId);
    return element && openElement
      ? <button type="button" className="pms-summary-open" onClick={() => openElement(element)}>Открыть редактор: {entry.title}</button>
      : <a className="pms-summary-open" href={strategyHref(entry.key)}>{entry.title}</a>;
  }
  function SourceEvidence({ entry }: { entry: StrategyEntry }) {
    const value = entry.value as { status?: string; note?: string; observations?: string; impression?: string; rationale?: string; sourceUrls?: string[]; evidence?: { status?: string; note?: string; sourceUrls?: string[]; checkedAt?: string | null } };
    const evidence = value?.evidence;
    const note = value?.note || evidence?.note || value?.observations || value?.impression || value?.rationale || entry.sourceNote;
    const sources = entry.sourceUrls.length ? entry.sourceUrls : evidence?.sourceUrls ?? [];
    return <article className="pms-summary-evidence">
      <RecordLink entry={entry} />
      <span>{entryStatus(entry) || "Статус не указан"}{entry.checkedAt ? ` · ${entry.checkedAt}` : ""}</span>
      {note && <p>{note}</p>}
      {sources.map((source) => <a key={source} href={safeExternal(source) || undefined} target={safeExternal(source) ? "_blank" : undefined} rel={safeExternal(source) ? "noreferrer" : undefined}>{source}</a>)}
    </article>;
  }

  return <section className="pms-first-slide" aria-label="Вывод стратегии на первом слайде">
    <header><div><p className="pm-kicker">PRODUCT / СВОДКА ПО СВЯЗАННЫМ ЗАПИСЯМ</p><h3>Стратегия сейчас</h3></div><p>Только сохранённые карточки и явно связанные основания. Заявление о функции не становится подтверждённым наблюдением.</p></header>
    <div className="pms-first-mission">
      <b>Миссия</b>{mission ? <><strong>{mission.data?.title}</strong><p>{mission.data?.description || mission.data?.definition || "Формулировка миссии не заполнена."}</p></> : <p>{missions.length > 1 ? "Есть несколько формулировок миссии. Свяжите выбранную с выводом; основная не выбирается автоматически." : "Пробел: миссия не зафиксирована. Черновик не предлагается автоматически."}</p>}
    </div>
    <div className="pms-first-story">{sections.map(({ label, content }) => <article key={label}>
      <b>{label}</b>
      {content ? <><p>{content.element.description || "Описание в модели не заполнено."}</p><span>{content.element.contentStatus === "confirmed" ? "В модели: подтверждено владельцем; это не независимая проверка." : `В модели: ${content.element.contentStatus}`}</span>{content.entry && <RecordLink entry={content.entry} />}</>
        : <p>Запись в модели отсутствует.</p>}
    </article>)}</div>
    <div className="pms-first-payment"><b>Почему будут пользоваться и платить</b>
      <p>{state.elements.find((element) => element.id === "TH-PILOT-VALUE")?.description || "Пользовательская ценность не сформулирована в модели."}</p>
      {paymentBasis ? <p><strong>Сохранённое основание оплаты:</strong> {paymentBasis}<br />Готовность платить остаётся непроверенной, пока нет отдельного результата проверки.</p>
        : <p><strong>Готовность платить не подтверждена:</strong> основание, эксперимент или наблюдение о готовности платить не сохранены.</p>}
    </div>
    <div className="pms-first-evidence-grid">
      <section><h4>Проверяемые основания, связанные с выводом</h4>
        {verified.length ? verified.map((entry) => <SourceEvidence key={entry.key} entry={entry} />) : <p className="pms-summary-empty">Нет связанного основания со статусом «Проверенное наблюдение» или «Проверено вживую». Непривязанные факты не считаются подтверждением продукта.</p>}
      </section>
      <section><h4>Личные проверки · наблюдения отдельно от заявлений</h4>
        {privateReviews.length ? privateReviews.map((entry) => <SourceEvidence key={entry.key} entry={entry} />) : <p className="pms-summary-empty">Связанные личные проверки пока не записаны.</p>}
      </section>
    </div>
    <div className="pms-first-next">
      <section><h4>Предположения</h4>
        {assumptions.length ? assumptions.map((entry) => <SourceEvidence key={entry.key} entry={entry} />) : <p className="pms-summary-empty">Связанные предположения явно не выделены.</p>}
      </section>
      <section><h4>Ближайший эксперимент</h4>
        {experiment ? <><strong>{experiment.data?.title}</strong><p>{experiment.data?.description || "Описание проверки не заполнено."}</p><p>Ожидаемый результат: {experiment.data?.assignment.expectedResult || "не задан"} · статус: {experiment.data?.assignment.status}</p><RecordLink entry={byKey.get(`node:${experiment.node.id}`)!} /></>
          : <p className="pms-summary-empty">{experiments.length > 1 ? "Связано несколько проверок; ближайшая не выбрана автоматически." : "Связанный эксперимент для следующего шага не зафиксирован."}</p>}
      </section>
    </div>
  </section>;
}

export default function ProjectStrategyWorkspace({ state, submit, saving, openElement }: Props) {
  const strategy = strategyOf(state);
  const entries = useMemo(() => strategyEntries(state), [state]);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
  const links = useMemo(() => strategyLinks(state), [state]);
  const gaps = useMemo(() => strategyGaps(state), [state]);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft>({ from: "", to: "", kind: "depends_on", reason: "" });
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [impactReview, setImpactReview] = useState<Record<string, { outcome: "revised" | "retained" | "deferred"; reason: string }>>({});
  const [mapDraftOpen, setMapDraftOpen] = useState(false);
  const [mapBaseVersion, setMapBaseVersion] = useState(strategy.mapVersions.at(-1)?.version ?? 0);
  const [mapError, setMapError] = useState("");
  const [mapDraft, setMapDraft] = useState(() => {
    const current = strategy.mapVersions.at(-1)?.data;
    return current ? structuredClone(current) : defaultStrategyMap();
  });
  const focusRef = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("strategyRef") : null;

  useEffect(() => {
    if (!focusRef) return;
    const timer = window.setTimeout(() => document.getElementById("project-strategy-inspector")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => window.clearTimeout(timer);
  }, [focusRef]);

  function startNode(id?: string) {
    setFormError(""); setNotice("");
    const node = id ? strategy.nodes.find((item) => item.id === id) : undefined;
    const revision = node?.revisions.at(-1);
    setNodeDraft({ ...(id ? { id } : {}), baseVersion: revision?.version ?? 0, value: revision ? structuredClone(revision.data) : emptyStrategyNode() });
  }
  function startDecision(id?: string, replacement = false) {
    setFormError(""); setNotice("");
    const record = id ? strategy.decisions.find((item) => item.id === id) : undefined;
    const revision = record?.revisions.at(-1);
    const value = revision ? structuredClone(revision.data) : emptyStrategyDecision();
    if (replacement && record) {
      value.status = "proposed";
      value.supersedes = record.id;
      value.title = value.title ? `Пересмотр: ${value.title}` : "";
    }
    setDecisionDraft({ ...(id && !replacement ? { id } : {}), baseVersion: replacement ? 0 : revision?.version ?? 0, value });
  }
  async function saveNode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nodeDraft) return;
    setFormError(""); setNotice("");
    const ok = await submit({
      type: "saveStrategyNode", ...(nodeDraft.id ? { id: nodeDraft.id } : {}),
      baseVersion: nodeDraft.baseVersion, node: nodeDraft.value,
    });
    if (ok) { setNodeDraft(null); setNotice("Запись стратегии сохранена новой версией."); }
    else setFormError("Сохранение не выполнено. Форма и введённые значения оставлены для повторной попытки.");
  }
  async function saveDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decisionDraft) return;
    setFormError(""); setNotice("");
    const ok = await submit({
      type: "saveStrategyDecision", ...(decisionDraft.id ? { id: decisionDraft.id } : {}),
      baseVersion: decisionDraft.baseVersion, decision: decisionDraft.value,
    });
    if (ok) { setDecisionDraft(null); setNotice("Решение сохранено. История предыдущих версий остаётся доступной."); }
    else setFormError("Решение не сохранено. Форма осталась открытой.");
  }
  async function saveLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkDraft.from || !linkDraft.to || linkDraft.from === linkDraft.to || !linkDraft.reason.trim()) return;
    setFormError(""); setNotice("");
    const ok = await submit({ type: "saveStrategyLink", ...linkDraft, reason: linkDraft.reason.trim() });
    if (ok) { setLinkDraft({ from: "", to: "", kind: "depends_on", reason: "" }); setNotice("Связь сохранена."); }
    else setFormError("Связь не сохранена. Проверьте актуальность записей и повторите.");
  }
  async function reviewImpact(id: string) {
    const review = impactReview[id];
    if (!review?.reason.trim()) return;
    setFormError(""); setNotice("");
    const impact = strategy.impacts.find((item) => item.id === id);
    if (review.outcome === "revised" && impact) {
      const target = byKey.get(impact.target);
      if (!target) { setFormError("Связанная запись для пересмотра не найдена."); return; }
      try {
        if (await fingerprint(target.value) === impact.targetFingerprint) {
          setFormError("Чтобы отметить пересмотр, сначала измените смысл связанной записи и сохраните новую версию. Либо оставьте вывод прежним с обоснованием или отложите.");
          return;
        }
      } catch {
        setFormError("Не удалось проверить изменение связанной записи. Оставьте вывод прежним или повторите проверку в защищённом контексте.");
        return;
      }
    }
    if (await submit({ type: "reviewStrategyImpact", id, outcome: review.outcome, reason: review.reason.trim() })) {
      setImpactReview((current) => ({ ...current, [id]: { ...current[id], reason: "" } }));
      setNotice("Рассмотрение изменения записано.");
    } else setFormError("Рассмотрение не сохранено. Текст формы оставлен.");
  }
  async function saveMap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMapError("");
    if (await submit({ type: "saveStrategyMap", baseVersion: mapBaseVersion, map: mapDraft })) {
      setMapDraftOpen(false); setNotice("Новая версия методики карты сохранена.");
    } else setMapError("Методика не сохранена. Проверьте сообщение об ошибке выше; черновик сохранён в форме.");
  }
  function startMap() {
    setMapDraft(structuredClone(strategy.mapVersions.at(-1)?.data ?? defaultStrategyMap()));
    setMapBaseVersion(strategy.mapVersions.at(-1)?.version ?? 0);
    setMapError(""); setMapDraftOpen(true);
  }
  const patchNode = (updates: Partial<StrategyNodeInput>) =>
    setNodeDraft((current) => current ? { ...current, value: { ...current.value, ...updates } } : current);
  const patchDecision = (updates: Partial<StrategyDecisionInput>) =>
    setDecisionDraft((current) => current ? { ...current, value: { ...current.value, ...updates } } : current);
  const editMapAxis = (axis: "x" | "y", updates: Record<string, unknown>) =>
    setMapDraft((current) => ({ ...current, [axis]: { ...current[axis], ...updates } }));

  function sourceRecordHref(entry: StrategyEntry) {
    if (entry.key.startsWith("element:")) {
      const id = entry.key.slice("element:".length);
      return `/admin/project-model?hypothesis=new-country&element=${encodeURIComponent(id)}`;
    }
    const review = entry.key.match(/^review:([^:]+):([^:]+)(?::|$)/);
    if (review) return `/admin/project-model?hypothesis=new-country&view=benchmark&competitor=${encodeURIComponent(review[1])}&review=${encodeURIComponent(review[2])}#reviews`;
    const match = entry.key.match(/^(?:competitor|fact|review|support):([^:]+)/);
    if (match) return `/admin/project-model?hypothesis=new-country&view=benchmark&competitor=${encodeURIComponent(match[1])}`;
    return entry.href;
  }
  function EntryLink({ entry, compact = false }: { entry: StrategyEntry; compact?: boolean }) {
    const elementId = entry.key.startsWith("element:") ? entry.key.slice(8) : "";
    const element = state.elements.find((item) => item.id === elementId);
    return <span className="pms-entry">
      {element && openElement ? <button type="button" className="pms-entry-link" onClick={() => openElement(element)}>{entry.title}</button>
        : <a className="pms-entry-link" href={strategyHref(entry.key)}>{entry.title}</a>}
      <small>{entry.kind}{entry.version !== null ? ` · v${entry.version}` : ""}{entry.checkedAt ? ` · дата ${entry.checkedAt}` : ""}{entryStatus(entry) ? ` · ${entryStatus(entry)}` : ""}{compact ? "" : ` · ${entry.key}`}</small>
    </span>;
  }

  const projectNodes = strategy.nodes.map((node) => ({ node, data: latestNodeInput(node)! }));
  const ownerEntries = entries.filter((entry) => ["person", "role"].includes(entryType(entry)));
  const skillEntries = entries.filter((entry) => entryType(entry) === "skill");
  const impactPending = strategy.impacts.filter((impact) => impact.effect === "review" && ["pending", "deferred"].includes(latestImpactOutcome(impact)));
  const focused = focusRef ? byKey.get(focusRef) : undefined;
  const focusedIncoming = focused ? links.filter((link) => link.to === focused.key) : [];
  const focusedOutgoing = focused ? links.filter((link) => link.from === focused.key) : [];
  const focusedImpacts = focused ? strategy.impacts.filter((impact) => impact.target === focused.key || impact.source === focused.key).slice().reverse() : [];
  const currentMap = strategy.mapVersions.at(-1);

  return <section className="pms-workspace" id="project-strategy-focus" aria-label="Связная стратегия проекта">
    <header className="pms-header">
      <div><p className="pm-kicker">STRATEGY / EVIDENCE LED</p><h2>Почему этот план следует из данных</h2>
        <p>Существующие карточки остаются источником данных. Связи объясняют логику, но не меняют исходные записи и не распространяют последствия автоматически.</p></div>
      <div className="pms-header-actions"><button className="pm-btn small" type="button" onClick={() => startNode()} disabled={saving}>Добавить узел</button>
        <button className="pm-btn small" type="button" onClick={() => startDecision()} disabled={saving}>Новое решение</button></div>
    </header>
    {notice && <p className="pms-notice" role="status">{notice}</p>}
    {formError && <p className="pms-error" role="alert">{formError}</p>}
    {focusRef && !focused && <p className="pms-error" role="alert">Связанная запись {focusRef} отсутствует в текущей версии этой гипотезы.</p>}
    {focused && <section className="pms-inspector" id="project-strategy-inspector" aria-label={`Инспектор: ${focused.title}`}>
      <header><div><p className="pm-kicker">FOCUSED REFERENCE / {focused.key}</p><h3>{focused.title}</h3><span>{focused.kind}</span></div>
        {focused.key.startsWith("node:") ? <button className="pm-btn small" type="button" onClick={() => startNode(focused.key.slice(5))}>Редактировать узел</button>
          : focused.key.startsWith("decision:") ? <button className="pm-btn small" type="button" onClick={() => {
            const id = focused.key.slice(9);
            const decision = strategy.decisions.find((item) => item.id === id);
            if (decision?.revisions.at(-1)?.data.status === "accepted") startDecision(id, true);
            else if (decision?.revisions.at(-1)?.data.status === "proposed") startDecision(id);
            else startDecision();
          }}>Открыть решение</button>
            : focused.key.startsWith("map:") ? <button className="pm-btn small" type="button" onClick={startMap}>Открыть методику</button>
              : <a className="pm-btn small" href={sourceRecordHref(focused)}>{focused.key.startsWith("element:") ? "Открыть редактор записи" : focused.key.startsWith("review:") ? "Открыть приватную проверку" : "Открыть исходную карточку"}</a>}</header>
      <div className="pms-inspector-meta"><span>Версия: {focused.version ?? "не указана"}</span><span>Дата: {focused.checkedAt || "не указана"}</span><span>Статус: {entryStatus(focused) || "не указан"}</span></div>
      {focused.sourceNote && <p className="pms-inspector-note">{focused.sourceNote}</p>}
      {focused.sourceUrls.length > 0 && <div className="pms-inspector-sources">{focused.sourceUrls.map((source) => <a key={source} href={safeExternal(source) || undefined} target={safeExternal(source) ? "_blank" : undefined} rel={safeExternal(source) ? "noreferrer" : undefined}>{source}</a>)}</div>}
      <details className="pms-inspector-value" open><summary>Сохранённое значение</summary><pre>{textValue(focused.value) || "Значение не заполнено."}</pre></details>
      <div className="pms-inspector-links">
        <section><h4>Входящие связи · основания / относится к</h4>{focusedIncoming.length ? focusedIncoming.map((link) => <div key={link.id}><EntryLink entry={byKey.get(link.from) ?? { key: link.from, title: link.from, kind: "Запись", version: null, value: null, sourceUrls: [], sourceNote: "", checkedAt: null, href: strategyHref(link.from) }} compact /><span>{link.kind === "depends_on" ? "зависит от" : "связано"} · {link.reason}</span></div>) : <p>Входящих связей нет.</p>}</section>
        <section><h4>Исходящие связи · влияет на / использует</h4>{focusedOutgoing.length ? focusedOutgoing.map((link) => <div key={link.id}><EntryLink entry={byKey.get(link.to) ?? { key: link.to, title: link.to, kind: "Запись", version: null, value: null, sourceUrls: [], sourceNote: "", checkedAt: null, href: strategyHref(link.to) }} compact /><span>{link.kind === "depends_on" ? "основание / зависимость" : "связано"} · {link.reason}</span></div>) : <p>Исходящих связей нет.</p>}</section>
      </div>
      <section className="pms-inspector-reviews"><h4>Статус пересмотра</h4>{focusedImpacts.length ? focusedImpacts.map((impact) => <div key={impact.id}><b>{impact.effect === "recomputed" ? "Информационный пересчёт" : latestImpactOutcome(impact) === "pending" ? "Ожидает пересмотра" : latestImpactOutcome(impact)}</b><span>{impact.reason} · {impact.at} · {impact.actor}</span></div>) : <p>Событий пересмотра для этой записи нет.</p>}</section>
    </section>}

    {nodeDraft && <form className="pms-form" onSubmit={(event) => void saveNode(event)}>
      <div className="pms-form-head"><div><p className="pm-kicker">VERSIONED STRATEGY NODE</p><h3>{nodeDraft.id ? "Новая версия узла" : "Новый узел стратегии"}</h3></div><button className="pm-btn small" type="button" onClick={() => setNodeDraft(null)} disabled={saving}>Закрыть</button></div>
      <div className="pms-fields">
        <label>Тип записи<select value={nodeDraft.value.kind} disabled={!!nodeDraft.id} onChange={(event) => patchNode({ kind: event.target.value as StrategyNodeInput["kind"] })}>{Object.entries(strategyKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Название<input required value={nodeDraft.value.title} onChange={(event) => patchNode({ title: event.target.value })} /></label>
        <label className="wide">Описание<textarea value={nodeDraft.value.description} onChange={(event) => patchNode({ description: event.target.value })} /></label>
        <label className="wide">Определение / критерий<textarea value={nodeDraft.value.definition} onChange={(event) => patchNode({ definition: event.target.value })} /></label>
        <label>Статус основания<select value={nodeDraft.value.evidence.status} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, status: event.target.value as StrategyNodeInput["evidence"]["status"] } })}>{Object.entries(proofKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Дата проверки<input type="date" value={nodeDraft.value.evidence.checkedAt ?? ""} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, checkedAt: event.target.value || null } })} /></label>
        <label>Применимый период<input value={nodeDraft.value.evidence.period} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, period: event.target.value } })} /></label>
        <label>Версия источника / продукта<input value={nodeDraft.value.evidence.versionLabel} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, versionLabel: event.target.value } })} /></label>
        <label className="wide">Заметка к источнику<textarea value={nodeDraft.value.evidence.sourceNote} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, sourceNote: event.target.value } })} /></label>
        <label className="wide">URL источников, по одному на строку<textarea value={nodeDraft.value.evidence.sourceUrls.join("\n")} onChange={(event) => patchNode({ evidence: { ...nodeDraft.value.evidence, sourceUrls: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} /></label>
        <label>Статус действия<select value={nodeDraft.value.assignment.status} onChange={(event) => patchNode({ assignment: { ...nodeDraft.value.assignment, status: event.target.value as StrategyNodeInput["assignment"]["status"] } })}><option value="planned">Запланировано</option><option value="in_progress">В работе</option><option value="done">Готово</option><option value="deferred">Отложено</option></select></label>
        <div className="wide"><StrategyReferencePicker label="Ответственный · участник / роль" entries={ownerEntries} single value={nodeDraft.value.assignment.ownerRef ? [nodeDraft.value.assignment.ownerRef] : []} onChange={(refs) => patchNode({ assignment: { ...nodeDraft.value.assignment, ownerRef: refs[0] ?? null } })} emptyLabel="Найти участника или роль" /></div>
        <label className="wide">Ожидаемый результат<textarea value={nodeDraft.value.assignment.expectedResult} onChange={(event) => patchNode({ assignment: { ...nodeDraft.value.assignment, expectedResult: event.target.value } })} /></label>
        <div className="wide"><StrategyReferencePicker label="Необходимые навыки" entries={skillEntries} value={nodeDraft.value.assignment.skillRefs} onChange={(skillRefs) => patchNode({ assignment: { ...nodeDraft.value.assignment, skillRefs } })} emptyLabel="Найти навык" /></div>
        <div className="wide"><StrategyReferencePicker label="Зависимости действия" entries={entries} value={nodeDraft.value.assignment.dependencyRefs} onChange={(dependencyRefs) => patchNode({ assignment: { ...nodeDraft.value.assignment, dependencyRefs } })} /></div>
      </div>
      <div className="pms-actions"><button className="pm-btn primary" type="submit" disabled={saving || !nodeDraft.value.title.trim()}>{saving ? "Сохраняем…" : "Сохранить версию"}</button><button className="pm-btn" type="button" onClick={() => setNodeDraft(null)} disabled={saving}>Отмена</button></div>
    </form>}

    {decisionDraft && <form className="pms-form" onSubmit={(event) => void saveDecision(event)}>
      <div className="pms-form-head"><div><p className="pm-kicker">DECISION / AUDITABLE</p><h3>{decisionDraft.value.supersedes ? "Новое решение взамен принятого" : decisionDraft.id ? "Изменить предложенное решение" : "Новое решение"}</h3>
        <p>Принятые решения неизменяемы: для пересмотра создайте замену с указанием нового основания.</p></div><button className="pm-btn small" type="button" onClick={() => setDecisionDraft(null)} disabled={saving}>Закрыть</button></div>
      <div className="pms-fields">
        <label>Название<input required value={decisionDraft.value.title} onChange={(event) => patchDecision({ title: event.target.value })} /></label>
        <label>Статус<select value={decisionDraft.value.status} disabled={saving} onChange={(event) => patchDecision({ status: event.target.value as StrategyDecisionInput["status"] })}><option value="proposed">Предложено</option><option value="accepted">Принято</option><option value="rejected">Отклонено</option></select></label>
        <label className="wide">Что узнали / что изменилось<textarea value={decisionDraft.value.learned} onChange={(event) => patchDecision({ learned: event.target.value })} /></label>
        <div className="wide"><StrategyReferencePicker label="Основания решения" entries={entries} value={decisionDraft.value.basisRefs} onChange={(basisRefs) => patchDecision({ basisRefs })} /></div>
        <div className="wide"><StrategyReferencePicker label="Затронутые записи" entries={entries} value={decisionDraft.value.affectedRefs} onChange={(affectedRefs) => patchDecision({ affectedRefs })} /></div>
        <label className="wide">Рассмотренные варианты, по одному на строку<textarea value={decisionDraft.value.options.join("\n")} onChange={(event) => patchDecision({ options: event.target.value.split(/\r?\n/).filter((item) => item.trim()) })} /></label>
        <label>Выбранный вариант<input value={decisionDraft.value.choice} onChange={(event) => patchDecision({ choice: event.target.value })} /></label>
        <div className="wide"><StrategyReferencePicker label="Ответственный · участник / роль" entries={ownerEntries} single value={decisionDraft.value.ownerRef ? [decisionDraft.value.ownerRef] : []} onChange={(refs) => patchDecision({ ownerRef: refs[0] ?? null })} emptyLabel="Найти участника или роль" /></div>
        <label className="wide">Обоснование<textarea required value={decisionDraft.value.rationale} onChange={(event) => patchDecision({ rationale: event.target.value })} /></label>
        <label>Ожидаемый результат<textarea value={decisionDraft.value.expectedResult} onChange={(event) => patchDecision({ expectedResult: event.target.value })} /></label>
        <label>Следующий шаг<textarea value={decisionDraft.value.nextStep} onChange={(event) => patchDecision({ nextStep: event.target.value })} /></label>
        <label>Дата<input type="date" value={decisionDraft.value.date} onChange={(event) => patchDecision({ date: event.target.value })} /></label>
      </div>
      {decisionDraft.value.supersedes && <p className="pms-caution">Новое решение будет связано с исходным {decisionDraft.value.supersedes}; статус исходного меняется только на сервере.</p>}
      <div className="pms-actions"><button className="pm-btn primary" type="submit" disabled={saving || !decisionDraft.value.title.trim() || !decisionDraft.value.rationale.trim()}>{saving ? "Сохраняем…" : "Сохранить решение"}</button><button className="pm-btn" type="button" onClick={() => setDecisionDraft(null)} disabled={saving}>Отмена</button></div>
    </form>}

    <div className="pms-columns">
      <section className="pms-panel">
        <div className="pms-panel-title"><div><p className="pm-kicker">01 / NODES</p><h3>Гипотезы и план</h3></div><span>{projectNodes.length}</span></div>
        {projectNodes.length ? <div className="pms-list">{projectNodes.map(({ node, data }) => {
          const history = node.revisions.slice().reverse();
          const linked = links.filter((link) => link.from === `node:${node.id}` || link.to === `node:${node.id}`);
          return <article className="pms-card" key={node.id} id={`strategy-${node.id}`}>
            <div className="pms-card-head"><div><small>{strategyKinds[data.kind]} · v{node.revisions.at(-1)?.version}</small><h4>{data.title || "Без названия"}</h4></div>
              <span className={`pms-proof proof-${data.evidence.status}`}>{proofKinds[data.evidence.status]}</span></div>
            {data.description && <p>{data.description}</p>}
            <div className="pms-meta">{data.evidence.checkedAt && <span>Проверено {data.evidence.checkedAt}</span>}{data.evidence.period && <span>Период: {data.evidence.period}</span>}{data.evidence.versionLabel && <span>Версия: {data.evidence.versionLabel}</span>}</div>
            {(data.evidence.sourceNote || data.evidence.sourceUrls.length > 0) && <div className="pms-evidence">{data.evidence.sourceNote && <p>{data.evidence.sourceNote}</p>}{data.evidence.sourceUrls.map((source) => <a key={source} href={safeExternal(source) || undefined} target={safeExternal(source) ? "_blank" : undefined} rel={safeExternal(source) ? "noreferrer" : undefined}>{source}</a>)}</div>}
            {data.kind === "action" && <div className="pms-assignment"><b>Действие · {data.assignment.status}</b><span>Ответственный:</span>{data.assignment.ownerRef ? byKey.get(data.assignment.ownerRef) ? <EntryLink entry={byKey.get(data.assignment.ownerRef)!} compact /> : <span>{data.assignment.ownerRef} · участник не найден</span> : <span>Не назначен</span>}<span>Необходимые навыки:</span>{data.assignment.skillRefs.length ? data.assignment.skillRefs.map((ref) => byKey.get(ref) ? <EntryLink key={ref} entry={byKey.get(ref)!} compact /> : <span key={ref}>{ref} · навык не найден</span>) : <span>Не определены</span>}<span>Ожидаемый результат: {data.assignment.expectedResult || "не задан"}</span></div>}
            {linked.length > 0 && <div className="pms-neighbors"><b>Основано на / связано с / влияет на</b>{linked.map((link) => {
              const otherKey = link.from === `node:${node.id}` ? link.to : link.from;
              const other = byKey.get(otherKey);
              return <div key={link.id}><span>{link.kind === "depends_on" ? (link.from === `node:${node.id}` ? "Зависит от" : "Является основанием") : "Связано с"} · {link.reason}</span>{other && <EntryLink entry={other} compact />}</div>;
            })}</div>}
            <div className="pms-card-actions"><button className="pm-btn small" type="button" onClick={() => startNode(node.id)} disabled={saving}>Новая версия</button></div>
            <details className="pms-history"><summary>История · {history.length} версий</summary>{history.map((revision) => <div key={revision.version}><b>v{revision.version} · {revision.at} · {revision.actor}</b><p>{revision.data.title} — {revision.data.description || revision.data.definition || "Без описания"}</p></div>)}</details>
          </article>;
        })}</div> : <div className="pm-empty"><strong>Узлов стратегии пока нет</strong>Создайте гипотезу, проверку, критерий или действие. Просмотр не создаёт исходных данных.</div>}
      </section>
      <section className="pms-panel">
        <div className="pms-panel-title"><div><p className="pm-kicker">02 / DECISIONS</p><h3>История решений</h3></div><span>{strategy.decisions.length}</span></div>
        {strategy.decisions.length ? <div className="pms-list">{strategy.decisions.slice().reverse().map((decision) => {
          const revision = decision.revisions.at(-1)!;
          const value = revision.data;
          const immutable = value.status === "accepted" || value.status === "rejected";
          return <article className="pms-card" key={decision.id}>
            <div className="pms-card-head"><div><small>{value.date} · {decision.id}</small><h4>{value.title}</h4></div><span className={`pms-proof decision-${value.status}`}>{decisionStatuses[value.status]}</span></div>
            <p>{value.learned || "Изменение / результат не записан."}</p><div className="pms-decision-choice"><b>Выбрали</b><span>{value.choice || "Не указано"}</span><b>Почему</b><span>{value.rationale}</span></div>
            {value.options.length > 0 && <div className="pms-assignment"><b>Рассмотренные варианты</b>{value.options.map((option, index) => <span key={`${index}-${option}`}>{option}</span>)}</div>}
            {value.basisRefs.length > 0 && <div className="pms-neighbors"><b>Основания</b>{value.basisRefs.map((ref) => <div key={ref}><span>Источник / проверка</span>{byKey.get(ref) ? <EntryLink entry={byKey.get(ref)!} compact /> : <span>{ref} · запись не найдена</span>}</div>)}</div>}
            {value.affectedRefs.length > 0 && <div className="pms-neighbors"><b>Затронутые записи</b>{value.affectedRefs.map((ref) => <div key={ref}><span>Может потребовать пересмотра</span>{byKey.get(ref) ? <EntryLink entry={byKey.get(ref)!} compact /> : <span>{ref} · запись не найдена</span>}</div>)}</div>}
            <div className="pms-meta"><span>Ожидаем: {value.expectedResult || "не задано"}</span><span>Дальше: {value.nextStep || "не задано"}</span></div>
            <div className="pms-neighbors"><b>Ответственный</b>{value.ownerRef ? byKey.get(value.ownerRef) ? <EntryLink entry={byKey.get(value.ownerRef)!} compact /> : <span>{value.ownerRef} · не найден</span> : <span>Не назначен</span>}</div>
            {value.supersedes && <p className="pms-caution">Заменяет решение {value.supersedes}.</p>}
            <div className="pms-card-actions">{immutable
              ? <button className="pm-btn small" type="button" onClick={() => value.status === "accepted" ? startDecision(decision.id, true) : startDecision()} disabled={saving}>{value.status === "accepted" ? "Создать решение-замену" : "Создать новое решение"}</button>
              : <button className="pm-btn small" type="button" onClick={() => startDecision(decision.id)} disabled={saving}>Редактировать</button>}</div>
            <details className="pms-history"><summary>История · {decision.revisions.length} версий{decision.supersededBy ? ` · заменено ${decision.supersededBy}` : ""}</summary>{decision.revisions.slice().reverse().map((item) => <div key={item.version}><b>v{item.version} · {item.at} · {item.actor}</b><p>{item.data.status}: {item.data.rationale}</p>{item.data.basisRefs.map((ref) => byKey.get(ref) ? <EntryLink key={ref} entry={byKey.get(ref)!} compact /> : <span key={ref}>{ref}</span>)}</div>)}</details>
          </article>;
        })}</div> : <div className="pm-empty"><strong>Решений пока нет</strong>Фиксируйте варианты и основания; наблюдение о конкуренте само по себе не создаёт действие.</div>}
      </section>
    </div>

    <section className="pms-panel pms-link-panel">
      <div className="pms-panel-title"><div><p className="pm-kicker">03 / TRACEABILITY</p><h3>Связать свидетельство с выводом</h3></div><span>{links.length}</span></div>
      <p className="pms-description">«Зависит от» направлено от вывода к основанию. Навигационная связь только помогает переходить между записями; ни один тип связи не распространяет изменения.</p>
      <form className="pms-link-form" onSubmit={(event) => void saveLink(event)}>
        <StrategyReferencePicker label="Откуда" entries={entries} single value={linkDraft.from ? [linkDraft.from] : []} onChange={(refs) => setLinkDraft({ ...linkDraft, from: refs[0] ?? "" })} />
        <label>Тип связи<select value={linkDraft.kind} onChange={(event) => setLinkDraft({ ...linkDraft, kind: event.target.value as LinkDraft["kind"] })}><option value="depends_on">Зависит от (причинная логика)</option><option value="navigation">Связано / переход</option></select></label>
        <StrategyReferencePicker label="К чему" entries={entries} single value={linkDraft.to ? [linkDraft.to] : []} onChange={(refs) => setLinkDraft({ ...linkDraft, to: refs[0] ?? "" })} emptyLabel="Найти основание или запись" />
        <label>Почему эта связь<input required value={linkDraft.reason} onChange={(event) => setLinkDraft({ ...linkDraft, reason: event.target.value })} /></label>
        <button className="pm-btn primary" type="submit" disabled={saving || !linkDraft.from || !linkDraft.to || linkDraft.from === linkDraft.to || !linkDraft.reason.trim()}>Добавить связь</button>
      </form>
      {strategy.links.length > 0 && <div className="pms-list pms-link-list">{strategy.links.map((link) => <article className="pms-link-row" key={link.id}>
        <div><b>{link.kind === "depends_on" ? "Зависит от" : "Навигационная связь"}</b><span>{link.reason}</span><div><EntryLink entry={byKey.get(link.from) ?? { key: link.from, title: link.from, kind: "Запись", version: null, value: null, sourceUrls: [], sourceNote: "", checkedAt: null, href: strategyHref(link.from) }} compact /> <span className="pms-arrow">→</span> <EntryLink entry={byKey.get(link.to) ?? { key: link.to, title: link.to, kind: "Запись", version: null, value: null, sourceUrls: [], sourceNote: "", checkedAt: null, href: strategyHref(link.to) }} compact /></div></div>
        <button className="pm-btn small danger" type="button" disabled={saving} onClick={() => void submit({ type: "removeStrategyLink", id: link.id })}>Удалить</button>
      </article>)}</div>}
      {links.some((link) => !strategy.links.some((saved) => saved.id === link.id)) && <details className="pms-history" open>
        <summary>Структурные и производные переходы · только чтение</summary>
        <div className="pms-list">{links.filter((link) => !strategy.links.some((saved) => saved.id === link.id)).map((link) => {
          const from = byKey.get(link.from);
          const to = byKey.get(link.to);
          const fallback = (key: string): StrategyEntry => ({ key, title: key, kind: "Запись", version: null, value: null, sourceUrls: [], sourceNote: "", checkedAt: null, href: strategyHref(key) });
          return <article className="pms-link-row" key={link.id}><div><b>{link.kind === "depends_on" ? "Зависит от" : "Навигационный переход"} · вычислено из модели</b><span>{link.reason}</span><div><EntryLink entry={from ?? fallback(link.from)} compact /><span className="pms-arrow">→</span><EntryLink entry={to ?? fallback(link.to)} compact /></div></div><span className="pms-help">Удаление недоступно для производной связи</span></article>;
        })}</div>
      </details>}
      {state.relations.length > 0 && <details className="pms-history"><summary>Существующие связи элементов модели · {state.relations.length}</summary><p>Старые связи отображаются как навигационные; они не становятся причинными зависимостями.</p>{state.relations.map((link) => <p key={link.id}>{link.from} → {link.to} · {link.label}</p>)}</details>}
    </section>

    <div className="pms-columns">
      <section className="pms-panel">
        <div className="pms-panel-title"><div><p className="pm-kicker">04 / CHANGE REVIEW</p><h3>Изменения, ожидающие внимания</h3></div><span>{impactPending.length}</span></div>
        {strategy.impacts.length ? <div className="pms-list">{strategy.impacts.slice().reverse().map((impact) => {
          const status = latestImpactOutcome(impact);
          const review = impactReview[impact.id] ?? { outcome: "retained" as const, reason: "" };
          return <article className="pms-card" key={impact.id}>
            <div className="pms-card-head"><div><small>{impact.at} · {impact.actor} · {impact.source} → {impact.target}</small><h4>{impact.reason || "Изменение связано с выводом"}</h4></div><span className={`pms-proof ${impact.effect === "recomputed" ? "impact-recomputed" : ""}`}>{impact.effect === "recomputed" ? "Пересчитано по правилу v2" : status === "pending" ? "Ожидает пересмотра" : status === "retained" ? "Оставлено" : status === "revised" ? "Изменено" : "Отложено"}</span></div>
            <div className="pms-before-after"><div><b>До</b><pre>{textValue(impact.before) || "Не записано"}</pre></div><div><b>После</b><pre>{textValue(impact.after) || "Не записано"}</pre></div></div>
            <div className="pms-evidence"><span>Тип эффекта: {impact.effect === "recomputed" ? "информационный пересчёт по явной методике, не запрос на пересмотр вывода" : "связанный вывод требует рассмотрения"}</span><span>Путь: {impact.path.join(" → ") || "прямой переход не указан"}</span><span>Источник проверен: {impact.sourceCheckedAt || "дата не сохранена"}</span>{impact.sourceUrls.map((url) => <a key={url} href={safeExternal(url) || undefined} target={safeExternal(url) ? "_blank" : undefined} rel={safeExternal(url) ? "noreferrer" : undefined}>{url}</a>)}{impact.sourceNote && <p>{impact.sourceNote}</p>}</div>
            {impact.reviews.map((item, index) => <p className="pms-review-note" key={`${item.at}-${index}`}>{item.actor} · {item.at} · {item.outcome}: {item.reason}</p>)}
            {impact.effect === "review" && ["pending", "deferred"].includes(status) && <div className="pms-review-controls"><label>Решение по влиянию<select value={review.outcome} onChange={(event) => setImpactReview((current) => ({ ...current, [impact.id]: { ...review, outcome: event.target.value as typeof review.outcome } }))}><option value="revised">Изменить целевой вывод</option><option value="retained">Оставить вывод прежним</option><option value="deferred">Отложить</option></select></label><label>Обоснование<textarea value={review.reason} onChange={(event) => setImpactReview((current) => ({ ...current, [impact.id]: { ...review, reason: event.target.value } }))} /></label>{review.outcome === "revised" && <p className="pms-caution">Сначала откройте целевой вывод, измените его смысл и сохраните. Затем отметьте пересмотр; изменение одной даты проверки недостаточно.</p>}<button className="pm-btn small primary" type="button" disabled={saving || !review.reason.trim()} onClick={() => void reviewImpact(impact.id)}>Сохранить рассмотрение</button></div>}
          </article>;
        })}</div> : <div className="pm-empty"><strong>Нет событий пересмотра</strong>Обновление исходных фактов и пересмотр вывода — разные действия. Новые события появятся после связанного изменения, не от просмотра страницы.</div>}
      </section>
      <section className="pms-panel">
        <div className="pms-panel-title"><div><p className="pm-kicker">05 / GAPS</p><h3>Пробелы в логике и исполнении</h3></div><span>{gaps.length}</span></div>
        {gaps.length ? <ul className="pms-gap-list">{gaps.map((gap, index) => <li key={`${gap.ref}-${gap.message}-${index}`}><a href={strategyHref(gap.ref)}>{byKey.get(gap.ref)?.title ?? gap.ref}</a><span>{gap.message}</span></li>)}</ul> : <p className="pms-description">Пробелы, проверяемые текущими правилами, не найдены. Это не означает, что стратегия доказана.</p>}
        {projectNodes.some(({ data }) => data.kind === "action") && <p className="pms-caution">Ответственные не назначаются автоматически. Заполняйте участника и необходимые навыки только при наличии оснований.</p>}
      </section>
    </div>

    <section className="pms-panel pms-map">
      <div className="pms-panel-title"><div><p className="pm-kicker">06 / POSITIONING METHOD</p><h3>Стратегическая методика и версии</h3></div><button className="pm-btn small" type="button" onClick={startMap} disabled={saving}>Новая версия методики</button></div>
      <p className="pms-description">Это карта стратегии проекта, отдельная от унаследованной исследовательской карты v1/v2. Старая карта не становится действующей стратегической методикой автоматически.</p>
      {currentMap ? <div className="pms-map-summary"><strong>Действующая стратегическая методика: {currentMap.data.title} · v{currentMap.version}</strong><span>Режим: {currentMap.data.mode === "expert" ? "Экспертные точки" : "Детерминированное правило scenario_v2"}</span>
        {currentMap.calculationReason && <p className="pms-description">{currentMap.calculationReason}</p>}
        <div className="pms-axis-grid">{(["x", "y"] as const).map((axis) => <article key={axis}><b>{axis.toUpperCase()} · {currentMap.data[axis].name}</b><span>{currentMap.data[axis].definition}</span><small>{currentMap.data[axis].direction} · шкала {currentMap.data[axis].scaleMin}–{currentMap.data[axis].scaleMax}</small><p>{currentMap.data[axis].criteria}</p>{currentMap.data[axis].basisRefs.length > 0 && <div className="pms-map-bases"><b>Основания</b>{currentMap.data[axis].basisRefs.map((ref) => byKey.get(ref) ? <EntryLink key={ref} entry={byKey.get(ref)!} compact /> : <span key={ref}>{ref} · не найдено</span>)}</div>}</article>)}</div>
        <StrategyPositionMap version={currentMap} entries={byKey} />
        {currentMap.data.mode === "expert" ? <>
          <div className="pms-table-scroll"><table className="pms-table"><thead><tr><th>Запись</th><th>X</th><th>Y</th><th>Обоснование</th><th>Основания</th></tr></thead><tbody>{currentMap.data.points.map((point) => <tr key={point.ref}><th>{byKey.get(point.ref) ? <EntryLink entry={byKey.get(point.ref)!} compact /> : point.ref}</th><td>{point.x ?? "Не определено"}</td><td>{point.y ?? "Не определено"}</td><td>{point.rationale || "Обоснование не записано"}</td><td>{point.basisRefs.length ? point.basisRefs.map((ref) => byKey.get(ref) ? <EntryLink key={ref} entry={byKey.get(ref)!} compact /> : <span key={ref}>{ref}</span>) : "Нет"}</td></tr>)}</tbody></table></div>
        </>
          : <p className="pms-description">v2 — неизменяемая методика расчёта по явным свидетельствам; отсутствие данных остаётся неопределённостью. Сохранение новой версии не изменяет исторические точки.</p>}
        <FrozenMapResults version={currentMap} entries={byKey} /></div>
        : <div className="pm-empty"><strong>Сохранённой методики нет</strong>Точки и координаты не создаются при открытии страницы.</div>}
      {mapDraftOpen && <form className="pms-form" onSubmit={(event) => void saveMap(event)}>
        <div className="pms-fields">
          <label>Название<input required value={mapDraft.title} onChange={(event) => setMapDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label>Метод<select value={mapDraft.mode} onChange={(event) => setMapDraft((current) => {
            const mode = event.target.value as typeof current.mode;
            if (mode === "expert") return { ...current, mode };
            const defaults = defaultStrategyMap();
            return { ...current, mode, x: { ...defaults.x, basisRefs: current.x.basisRefs }, y: { ...defaults.y, basisRefs: current.y.basisRefs }, points: [] };
          })}><option value="scenario_v2">Фиксированное правило v2</option><option value="expert">Экспертные оценки (настраиваемые оси)</option></select></label>
          {(["x", "y"] as const).map((axis) => <React.Fragment key={axis}>
            <label>Ось {axis.toUpperCase()} — название<input disabled={mapDraft.mode === "scenario_v2"} value={mapDraft[axis].name} onChange={(event) => editMapAxis(axis, { name: event.target.value })} /></label>
            <label>Направление<input disabled={mapDraft.mode === "scenario_v2"} value={mapDraft[axis].direction} onChange={(event) => editMapAxis(axis, { direction: event.target.value })} /></label>
            <label>Определение<textarea disabled={mapDraft.mode === "scenario_v2"} value={mapDraft[axis].definition} onChange={(event) => editMapAxis(axis, { definition: event.target.value })} /></label>
            <label>Критерии расположения<textarea disabled={mapDraft.mode === "scenario_v2"} value={mapDraft[axis].criteria} onChange={(event) => editMapAxis(axis, { criteria: event.target.value })} /></label>
            <label>Минимум<input disabled={mapDraft.mode === "scenario_v2"} type="number" value={mapDraft[axis].scaleMin} onChange={(event) => editMapAxis(axis, { scaleMin: Number(event.target.value) })} /></label>
            <label>Максимум<input disabled={mapDraft.mode === "scenario_v2"} type="number" value={mapDraft[axis].scaleMax} onChange={(event) => editMapAxis(axis, { scaleMax: Number(event.target.value) })} /></label>
            <div className="wide"><StrategyReferencePicker label={`Основания оси ${axis.toUpperCase()}`} entries={entries} value={mapDraft[axis].basisRefs} onChange={(basisRefs) => editMapAxis(axis, { basisRefs })} /></div>
          </React.Fragment>)}
        </div>
        {mapDraft.mode === "expert" && <div className="pms-expert-points">
          <p className="pms-caution">Экспертные координаты вводятся вручную и не пересчитываются из маркетинговых заявлений. Оставьте неизвестные значения пустыми.</p>
          {mapDraft.points.map((point, index) => <article className="pms-expert-point" key={`${point.ref}-${index}`}>
            <div className="wide"><StrategyReferencePicker label="Участник карты" entries={entries} single value={point.ref ? [point.ref] : []} onChange={(refs) => setMapDraft((current) => ({ ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? { ...item, ref: refs[0] ?? "" } : item) }))} emptyLabel="Найти участника / TalkHint" /></div>
            <label>X<input type="number" value={point.x ?? ""} onChange={(event) => setMapDraft((current) => ({ ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? { ...item, x: event.target.value === "" ? null : Number(event.target.value) } : item) }))} /></label>
            <label>Y<input type="number" value={point.y ?? ""} onChange={(event) => setMapDraft((current) => ({ ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? { ...item, y: event.target.value === "" ? null : Number(event.target.value) } : item) }))} /></label>
            <label>Обоснование<textarea value={point.rationale} onChange={(event) => setMapDraft((current) => ({ ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? { ...item, rationale: event.target.value } : item) }))} /></label>
            <div className="wide"><StrategyReferencePicker label="Основания экспертной точки" entries={entries} value={point.basisRefs} onChange={(basisRefs) => setMapDraft((current) => ({ ...current, points: current.points.map((item, itemIndex) => itemIndex === index ? { ...item, basisRefs } : item) }))} /></div>
            <button className="pm-btn small danger" type="button" onClick={() => setMapDraft((current) => ({ ...current, points: current.points.filter((_, itemIndex) => itemIndex !== index) }))}>Удалить точку</button>
          </article>)}
          <button className="pm-btn small" type="button" onClick={() => setMapDraft((current) => ({ ...current, points: [...current.points, { ref: "", x: null, y: null, rationale: "", basisRefs: [] }] }))}>Добавить пустую экспертную точку</button>
        </div>}
        {mapError && <p className="pms-error" role="alert">{mapError}</p>}<div className="pms-actions"><button className="pm-btn primary" type="submit" disabled={saving || !mapDraft.title.trim()}>Сохранить новую версию</button><button className="pm-btn" type="button" onClick={() => setMapDraftOpen(false)} disabled={saving}>Отмена</button></div>
      </form>}
      {strategy.mapVersions.length > 0 && <details className="pms-history"><summary>История методик · {strategy.mapVersions.length}</summary>{strategy.mapVersions.slice().reverse().map((version) => <div key={version.id}><b>{version.data.title} · v{version.version} · {version.at} · {version.actor}</b><p>{version.data.mode === "expert" ? "Экспертный метод" : "Правило scenario_v2"}. Методики разных версий не сравниваются напрямую.</p>{(["x", "y"] as const).flatMap((axis) => version.data[axis].basisRefs.map((ref) => byKey.get(ref) ? <EntryLink key={`${axis}-${ref}`} entry={byKey.get(ref)!} compact /> : <span key={`${axis}-${ref}`}>{ref}</span>))}{version.data.points.flatMap((point) => point.basisRefs.map((ref) => byKey.get(ref) ? <EntryLink key={`${point.ref}-${ref}`} entry={byKey.get(ref)!} compact /> : <span key={`${point.ref}-${ref}`}>{ref}</span>))}{version.id !== currentMap?.id && (version.data.mode === "expert" ? version.data.points.length > 0 : (version.calculations?.length ?? 0) > 0) && <StrategyPositionMap version={version} historical />}<FrozenMapResults version={version} entries={byKey} /></div>)}</details>}
    </section>
  </section>;
}
