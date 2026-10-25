import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ProjectModelState } from "../../shared/projectModel";
import {
  emptyStrategy, defaultStrategyMap, strategyEntries, strategyLinks, latestImpactOutcome, meaningfulStrategyValue,
  type StrategyCommand, type StrategyNodeInput, type StrategyNode, type StrategyDecision,
} from "../../shared/projectStrategy";
import { ModelError } from "./modelError";
import { researchRows, positioningFor } from "../../shared/competitorResearch";
import type { StrategyMapVersion } from "../../shared/projectStrategy";

const fail = (message: string, status = 409): never => { throw new ModelError(status, message); };
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
export const strategyFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(meaningfulStrategyValue(value)) ?? "null").digest("hex");
export function captureStrategyMap(state: ProjectModelState, method: StrategyMapVersion): StrategyMapVersion {
  const captured = structuredClone(method);
  captured.calculatedAt = new Date().toISOString();
  captured.basisVersions = strategyEntries(state).filter(e => /^(fact|review|support|talkhint|competitor):/.test(e.key))
    .map(e => ({ ref: e.key, version: e.version }));
  if (method.data.mode === "scenario_v2") captured.calculations = researchRows(state.competitorDirectory ?? {
    records: [], talkhint: { checkedAt: "", note: "", scenarios: [] },
  }).map(row => {
    const p = positioningFor(row);
    return { ref: row.kind === "competitor" ? `competitor:${row.id}` : `talkhint:${row.kind === "talkhint_current" ? "current" : "target"}`,
      name: row.snapshot.name, x: p.x, y: p.y, lower: p.lower, upper: p.upper, reason: p.reason };
  });
  return captured;
}
const latest = <T>(record: { revisions: { version: number; data: T }[] } | undefined) => record?.revisions.at(-1);
export function applyStrategyCommand(old: ProjectModelState, command: StrategyCommand, actor: string): ProjectModelState {
  const s = structuredClone(old), c = command, now = new Date().toISOString();
  const strategy = s.strategy ??= emptyStrategy();
  const entries = new Map(strategyEntries(s).map(e => [e.key, e]));
  const exists = (key: string) => entries.get(key) ?? fail("Связанная запись не найдена в этой гипотезе", 404);
  const checkRefs = (refs: string[]) => refs.forEach(exists);
  const checkKind = (key: string | null, allowed: string[]) => {
    if (!key) return;
    exists(key);
    const node = key.startsWith("node:") ? latest(strategy.nodes.find(n => `node:${n.id}` === key))?.data.kind : undefined;
    const element = key.startsWith("element:") ? s.elements.find(n => `element:${n.id}` === key)?.kind : undefined;
    if (!allowed.includes(node ?? element ?? "")) fail("Недопустимый тип ответственного, навыка или зависимости", 400);
  };
  const checkAssignment = (n: StrategyNodeInput) => {
    checkKind(n.assignment.ownerRef, ["person", "role"]);
    n.assignment.skillRefs.forEach(key => checkKind(key, ["skill"]));
    checkRefs(n.assignment.dependencyRefs);
  };
  let before: unknown = null, after: unknown = null;
  switch (c.type) {
    case "saveStrategyNode": {
      const record = c.id ? strategy.nodes.find(n => n.id === c.id) ?? fail("Запись не найдена", 404) : undefined;
      if ((latest(record)?.version ?? 0) !== c.baseVersion) fail("Устаревшая версия записи");
      if (record && latest(record)!.data.kind !== c.node.kind)
        fail("Тип записи сохраняет её идентичность; для другого типа создайте новую запись");
      checkAssignment(c.node);
      if (record && [...c.node.assignment.skillRefs, ...c.node.assignment.dependencyRefs].includes(`node:${record.id}`))
        fail("Запись не может зависеть от себя", 400);
      if (isDeepStrictEqual(latest(record)?.data, c.node)) return old;
      if (strategy.nodes.length >= 500 && !record) fail("Достигнут лимит записей", 413);
      if ((record?.revisions.length ?? 0) >= 100) fail("Достигнут лимит версий; история сохранена", 413);
      const target: StrategyNode = record ?? { id: id("NODE"), revisions: [] };
      before = latest(target)?.data ?? null;
      target.revisions.push({ version: c.baseVersion + 1, at: now, actor, data: structuredClone(c.node) });
      if (!record) strategy.nodes.push(target);
      after = { id: target.id, data: c.node };
      break;
    }
    case "saveStrategyDecision": {
      const record = c.id ? strategy.decisions.find(d => d.id === c.id) ?? fail("Решение не найдено", 404) : undefined;
      const previous = latest(record);
      if ((previous?.version ?? 0) !== c.baseVersion) fail("Устаревшая версия решения");
      if (previous && previous.data.status !== "proposed") fail("Рассмотренное решение неизменно; создайте замену");
      checkRefs([...c.decision.basisRefs, ...c.decision.affectedRefs]);
      checkKind(c.decision.ownerRef, ["person", "role"]);
      if (c.decision.status === "superseded") fail("Замену фиксирует новое принятое решение", 400);
      const predecessor = c.decision.supersedes
        ? strategy.decisions.find(d => d.id === c.decision.supersedes) ?? fail("Заменяемое решение не найдено", 404) : undefined;
      if (predecessor && (predecessor.id === record?.id || latest(predecessor)?.data.status !== "accepted"))
        fail("Заменить можно только другое принятое решение");
      if (isDeepStrictEqual(previous?.data, c.decision)) return old;
      if (strategy.decisions.length >= 500 && !record) fail("Достигнут лимит решений", 413);
      if ((record?.revisions.length ?? 0) >= 100) fail("Достигнут лимит версий решения", 413);
      const target: StrategyDecision = record ?? { id: id("STRATEGY-DEC"), revisions: [] };
      before = previous?.data ?? null;
      target.revisions.push({ version: c.baseVersion + 1, at: now, actor, data: structuredClone(c.decision) });
      if (!record) strategy.decisions.push(target);
      if (predecessor && c.decision.status === "accepted") {
        const prev = latest(predecessor)!;
        predecessor.revisions.push({ version: prev.version + 1, at: now, actor, data: { ...structuredClone(prev.data), status: "superseded" } });
        predecessor.supersededBy = target.id;
      }
      after = { id: target.id, data: c.decision };
      break;
    }
    case "saveStrategyLink": {
      exists(c.from); exists(c.to);
      if (c.from === c.to) fail("Выберите разные записи", 400);
      const previous = c.id ? strategy.links.find(l => l.id === c.id) ?? fail("Связь не найдена", 404) : undefined;
      if (strategy.links.some(l => l.id !== previous?.id && l.from === c.from && l.to === c.to && l.kind === c.kind))
        fail("Такая связь уже существует");
      if (strategy.links.length >= 1500 && !previous) fail("Достигнут лимит связей", 413);
      const link = { id: previous?.id ?? id("STRATEGY-LINK"), from: c.from, to: c.to, kind: c.kind, reason: c.reason };
      if (isDeepStrictEqual(previous, link)) return old;
      before = previous ?? null; after = link;
      if (previous) strategy.links[strategy.links.indexOf(previous)] = link;
      else strategy.links.push(link);
      break;
    }
    case "removeStrategyLink": {
      const link = strategy.links.find(l => l.id === c.id) ?? fail("Связь не найдена", 404);
      before = link; strategy.links = strategy.links.filter(l => l.id !== c.id); break;
    }
    case "reviewStrategyImpact": {
      const impact = strategy.impacts.find(i => i.id === c.id) ?? fail("Событие не найдено", 404);
      const previous = impact.reviews.at(-1);
      if (previous?.outcome === c.outcome && previous.reason === c.reason) return old;
      if (["retained", "revised"].includes(latestImpactOutcome(impact))) fail("Событие уже рассмотрено; история неизменна");
      if (c.outcome === "revised" && strategyFingerprint(exists(impact.target).value) === impact.targetFingerprint)
        fail("Сначала измените связанную запись или оставьте вывод прежним с обоснованием");
      if (impact.reviews.length >= 100) fail("Достигнут лимит записей рассмотрения", 413);
      before = structuredClone(impact);
      impact.reviews.push({ at: now, actor, outcome: c.outcome, reason: c.reason }); after = impact;
      const element = s.elements.find(e => `element:${e.id}` === impact.target);
      if (element && !strategy.impacts.some(i => i.target === impact.target && i.effect !== "recomputed" &&
        ["pending", "deferred"].includes(latestImpactOutcome(i)))) element.needsReview = false;
      break;
    }
    case "saveStrategyMap": {
      if ((strategy.mapVersions.at(-1)?.version ?? 0) !== c.baseVersion) fail("Устаревшая версия методики");
      checkRefs([...c.map.x.basisRefs, ...c.map.y.basisRefs, ...c.map.points.flatMap(p => [p.ref, ...p.basisRefs])]);
      if (c.map.mode === "scenario_v2") {
        const d = defaultStrategyMap();
        for (const axis of ["x", "y"] as const)
          if (!isDeepStrictEqual({ ...c.map[axis], basisRefs: [] }, d[axis]))
            fail("Правило v2 фиксировано. Для изменения осей выберите экспертную методику", 400);
        if (c.map.points.length) fail("В методике v2 точки вычисляются из свидетельств, не задаются вручную", 400);
      }
      if (isDeepStrictEqual(strategy.mapVersions.at(-1)?.data, c.map)) return old;
      if (strategy.mapVersions.length >= 100) fail("Достигнут лимит версий методики", 413);
      if (!strategy.mapVersions.length) strategy.mapVersions.push(captureStrategyMap(s, {
        id: id("MAP"), version: 0, at: now, actor, data: defaultStrategyMap(),
      }));
      before = strategy.mapVersions.at(-1)!;
      const map = { id: id("MAP"), version: c.baseVersion + 1, at: now, actor, data: structuredClone(c.map) };
      const captured = captureStrategyMap(s, map);
      strategy.mapVersions.push(captured); after = captured; break;
    }
  }
  s.decisions.push({ id: id("DEC"), at: now, actor, action: "Обновлена связная модель",
    reason: c.type, elementIds: [], strategyChange: { command: c.type, before, after: structuredClone(after) } });
  s.revision++;
  return s;
}

/** Called once on the FINAL state of a command, including appended private reviews. */
export function collectStrategyImpacts(old: ProjectModelState, next: ProjectModelState, actor: string): ProjectModelState {
  if (!next.strategy || old === next) return next;
  const strategy = next.strategy;
  const before = new Map(strategyEntries(old).map(e => [e.key, e]));
  let after = new Map(strategyEntries(next).map(e => [e.key, e]));
  const links = strategyLinks(next).filter(l => l.kind === "depends_on");
  const reverse = new Map<string, typeof links>();
  for (const l of links) { const list = reverse.get(l.to) ?? []; list.push(l); reverse.set(l.to, list); }
  const changed = Array.from(before.entries()).filter(([key, prior]) =>
    strategyFingerprint(prior.value) !== strategyFingerprint(after.get(key)?.value ?? null));
  const mapSources = new Set<string>();
  for (const [source] of changed) {
    if (source === "map:current") continue;
    const visited = new Set([source]), queue = [source];
    for (let index = 0; index < queue.length; index++)
      for (const link of reverse.get(queue[index]) ?? []) {
        if (link.from === "map:current") { mapSources.add(source); break; }
        if (!visited.has(link.from)) { visited.add(link.from); queue.push(link.from); }
      }
  }
  const active = strategy.mapVersions.at(-1);
  let recalculated = false;
  if (active?.data.mode === "scenario_v2" && mapSources.size > 0) {
    if (strategy.mapVersions.length >= 100) fail("Достигнут лимит версий карты; история сохранена", 413);
    const now = new Date().toISOString();
    const captured = captureStrategyMap(next, {
      id: id("MAP"), version: active.version + 1, at: now, actor, data: structuredClone(active.data),
      calculationSourceRefs: Array.from(mapSources),
      calculationReason: "Детерминированный пересчёт по изменившимся основаниям; методика и стратегические решения не изменены",
    });
    strategy.mapVersions.push(captured);
    next.decisions.push({ id: id("DEC"), at: now, actor, action: "Пересчитана карта по прежней методике",
      reason: captured.calculationReason!, elementIds: [], strategyChange: {
        command: "recalculateStrategyMap", before: structuredClone(active), after: structuredClone(captured),
      } });
    recalculated = true;
    after = new Map(strategyEntries(next).map(e => [e.key, e]));
  }
  for (const [source, prior] of Array.from(before.entries())) {
    const current = after.get(source);
    if (strategyFingerprint(prior.value) === strategyFingerprint(current?.value ?? null)) continue;
    const eventId = createHash("sha256").update(`${old.revision}:${source}:${strategyFingerprint(prior.value)}:${strategyFingerprint(current?.value ?? null)}`).digest("hex");
    const seen = new Set([source]), queue = [{ key: source, path: [source], reasons: [] as string[] }];
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      for (const link of reverse.get(item.key) ?? []) {
        if (seen.has(link.from) || !after.has(link.from)) continue;
        seen.add(link.from);
        const path = [...item.path, link.from], reasons = [...item.reasons, link.reason];
        queue.push({ key: link.from, path, reasons });
        if (strategy.impacts.some(i => i.eventId === eventId && i.target === link.from)) continue;
        if (strategy.impacts.length >= 3000) fail("Достигнут лимит событий влияния; история сохранена", 413);
        const entry = current ?? prior;
        const recomputed = link.from === "map:current" && recalculated && mapSources.has(source);
        strategy.impacts.push({
          id: id("IMPACT"), eventId, source, target: link.from, before: structuredClone(prior.value),
          after: structuredClone(current?.value ?? null), sourceUrls: [...entry.sourceUrls], sourceNote: entry.sourceNote,
          sourceCheckedAt: entry.checkedAt, at: new Date().toISOString(), path, reason: reasons.join(" → "),
          effect: recomputed ? "recomputed" : "review", targetFingerprint: strategyFingerprint(after.get(link.from)!.value), actor, reviews: [],
        });
        const e = next.elements.find(e => `element:${e.id}` === link.from);
        if (e && !recomputed) e.needsReview = true;
      }
    }
  }
  for (const impact of strategy.impacts)
    if (impact.effect !== "recomputed" && ["pending", "deferred"].includes(latestImpactOutcome(impact))) {
      const e = next.elements.find(e => `element:${e.id}` === impact.target);
      if (e) e.needsReview = true;
    }
  if (JSON.stringify(next).length > 5_000_000) fail("Модель превысила допустимый размер; история не обрезана", 413);
  return next;
}
