import type { TeamEvent, TeamMember, TeamView } from "../../shared/team";
import { characters, DIRECTORY, JOURNAL, TEAM_BASE, TEAM_PLAN_HASH, TEAM_STEPS } from "./plan";
import { completedSteps, type TeamContext } from "./repository";
import { semanticHash, textHash } from "../companyData/valueTree";

const string = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const json = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return null; } };
export function teamView(c: TeamContext, environment: string): TeamView {
  const nodes = c.operating.data.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const directory = json(c.documents.find(d => d.id === DIRECTORY)?.text);
  const journal = json(c.documents.find(d => d.id === JOURNAL)?.text);
  const profileDocuments = c.documents.filter(d => d.text.includes('"visualPassport"'))
    .map(doc => ({ doc, profile: json(doc.text) })).filter(p => p.profile?.visualPassport?.roleId);
  const feed: TeamEvent[] = [];
  for (const item of journal?.cases ?? []) for (const event of item.history ?? []) {
    const at = string(event.at ?? event.recordedAt);
    if (at) feed.push({ id: `journal:${item.caseId}:${feed.length}`, at, source: "journal",
      title: string(item.label ?? item.title) ?? item.caseId,
      detail: string(event.note ?? event.decision ?? event.result),
      role: string(event.role), });
  }
  for (const job of c.jobs) feed.push({ id: `lab:${job.key}`, at: new Date(job.updated_at).toISOString(),
    source: "call_lab", title: `Call Lab · ${job.status}`,
    detail: `Сохранённая запись по звонку ${job.call_sid}. Готовность отчёта не доказывает успешный разбор или приёмку владельца.`, role: "P.LAB" });
  for (const r of c.revisions) if (r.actor?.startsWith(`team-package:${TEAM_PLAN_HASH}:`)) {
    const step = Number(r.actor.split(":").at(-1));
    feed.push({ id: `team-write:${r.revision}`, at: new Date(r.created_at).toISOString(), source: "journal",
      title: `Команда · запись ${step + 1}/4 · r${r.revision}`,
      detail: step < 3 ? ["FK B — решение владельца", "Катя — кнопки меню: предложение", "Катя — взять звонок: предложение"][step] :
        "Профили и пустые карточки. Граф и исполнители не изменены.", role: "HEAD.07" });
  }
  for (const control of c.controls) {
    if (control.key.startsWith("hint-daily:")) {
      for (const [day, value] of Object.entries<any>(control.watchdog?.reports ?? {}))
        if (value.at) feed.push({ id: `daily:${day}`, at: value.at, source: "oncall",
          title: `Утренняя сводка за ${day} · ${value.status}`,
          detail: string(value.errorCode), role: "P.OPS" });
    } else for (const [key, value] of Object.entries<any>(control.watchdog ?? {}))
      if (value && typeof value === "object" && (value.lastSeenAt || value.detectedAt))
        feed.push({ id: `oncall:${key}`, at: value.lastSeenAt ?? value.detectedAt,
          source: "oncall", title: string(value.code) ?? "Событие дежурного",
          detail: string(value.reason), role: "P.OPS" });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));
  const members: TeamMember[] = nodes.filter(n => n.kind === "role" && n.id !== "owner").map(n => {
    const character = characters.find(p => p.role === n.id);
    const found = profileDocuments.find(p => p.profile.visualPassport.roleId === n.id &&
      (!character || p.doc.id === character.document));
    const doc = found?.doc, profile = found?.profile, v = profile?.visualPassport;
    // Read only the projection corresponding to the exact current document,
    // not a "latest row" from unrelated historical payload versions.
    const physical = v ? c.profiles.find(p => p.entity_id === n.id &&
      p.source_document_id === doc!.id && Number(p.profile_version) === Number(profile.version) &&
      p.display_name === (v.selectedName ?? null) && p.trait_1 === (v.character?.traits?.[0] ?? null) &&
      p.trait_2 === (v.character?.traits?.[1] ?? null) && p.trait_3 === (v.character?.traits?.[2] ?? null) &&
      p.motto === (v.character?.motto ?? null) && p.portrait_file_url === (v.portrait?.asset ?? null)) : null;
    if (v && !physical) throw Error(`Employee projection unavailable: ${n.code}`);
    const mode = profile?.mode ? c.roles.find(r => r.entity_id === n.id &&
      r.mode_source === `document:${doc!.id}` && r.mode === profile.mode)?.mode : null;
    if (profile?.mode && !mode) throw Error(`Role mode projection unavailable: ${n.code}`);
    const prompt = doc && profile?.prompt ? c.prompts.find(p => p.entity_id === n.id &&
      p.source_document_id === doc.id && p.prompt_version === `${doc.id}:v${profile.version}` &&
      p.utf8_sha256 === textHash(JSON.stringify(profile.prompt)) &&
      textHash(p.text_body) === p.utf8_sha256) : null;
    const duties = nodes.filter(a => a.kind === "action" && (a.roleId === n.id || a.executorId === n.id));
    const relations: TeamMember["relations"] = [];
    const add = (kind: string, id: string | null) => { if (id && byId.has(id))
      relations.push({ kind, id, name: byId.get(id)!.name }); };
    add("Подчиняется", n.managerId ?? null);
    for (const a of duties) {
      add("Кто проверяет меня", a.acceptorId);
      add("Передаёт работу", a.recipientId);
      for (const input of a.inputs) add("Получает от", input.sourceId);
    }
    for (const link of c.operating.data.links) {
      if (link.kind === "accountable_to" && link.from === n.id) add("Подчиняется", link.to);
      if (link.kind === "handoff" && link.from === n.id) add("Передаёт работу", link.to);
      if (link.kind === "handoff" && link.to === n.id) add("Получает от", link.from);
    }
    const executor = n.executorId ? byId.get(n.executorId) : null;
    const status = n.executorId === "replit-current-dev-session" ? "replit" : "disconnected";
    const events = feed.filter(e => e.role === n.code || e.role === n.id);
    const metrics = [...(n.metrics ?? []), ...duties.flatMap(a => a.metrics ?? [])];
    const metricText = (key: "plan" | "fact") => metrics.filter(m => m[key] !== null)
      .map(m => `${m.name}: ${m[key]} ${m.unit} (${m.scope}; ${m.evidence || "источник не заполнен"})`).join("\n") || null;
    return { id: n.id, code: n.code, title: string(v?.position) ?? n.name,
      name: physical?.display_name ?? n.name,
      department: n.parentId === "dir-product" ? "Продукт" : n.parentId === "dir-engineering" ? "Инженерия" :
        string(n.parentId ? byId.get(n.parentId)?.name : null) ?? "Отдел не заполнен",
      mode: string(mode),
      status, statusEvidence: status === "replit" ? "В модели указан текущий исполнитель Replit." :
          "Нет подтверждённого подключённого исполнителя. Работа автоматизации Call Lab/дежурного не доказывает включение этого именного агента.",
      portrait: physical?.portrait_file_url ?? null,
      nameStatus: physical?.owner_selection_status ?? null,
      traits: physical ? [physical.trait_1, physical.trait_2, physical.trait_3] : [null, null, null],
      motto: physical?.motto ?? null,
      duties: duties.map(a => ({ id: a.id, title: a.name, detail: string(a.procedure || a.description || a.purpose) })),
      relations: Array.from(new Map(relations.map(r => [`${r.kind}:${r.id}`, r])).values()),
      tools: Array.from(new Set([...n.resourceIds, ...duties.flatMap(a => a.resourceIds)].map(id => byId.get(id)?.name).filter(Boolean))) as string[],
      prohibitions: Array.from(new Set([n.constraints, ...duties.map(a => a.constraints)].filter(Boolean))),
      model: string(profile?.prompt?.model),
      prompt: { text: prompt?.text_body ?? null, version: prompt?.prompt_version ?? null,
        status: prompt?.status ?? null, acceptedBy: prompt?.accepted_by ?? null },
      metrics: { plan: metricText("plan"), fact: metricText("fact") },
      lastWork: events[0] ? `${events[0].title}: ${events[0].detail ?? "нет подробностей"}` : null,
      lessons: (journal?.cases ?? []).flatMap((item: any) => (item.history ?? [])
        .filter((e: any) => e.role === n.code || e.role === n.id)
        .map((e: any) => string(e.lesson ?? e.learned)).filter(Boolean)),
      history: [
        ...(physical ? [{ at: physical.source_at ?? "", text: `Профиль v${physical.profile_version}; ${doc!.id}; выбор имени: ${physical.owner_selection_status}` }] : []),
        ...events.slice(0, 8).map(e => ({ at: e.at, text: `${e.title}: ${e.detail ?? "нет подробностей"}` })),
      ],
    };
  });
  for (const team of directory?.teams ?? []) members.push({
    id: team.id, name: team.name, title: team.status === "unresolved" ? "Граница продукта не разобрана" : "Команда запланирована",
    code: "—", department: "Работают на клиентов", mode: team.mode, status: team.status,
    statusEvidence: "Пустая карточка. Нет сотрудников, исполнителей, заданий, расписаний и новых расходов.",
    portrait: directory.portraits?.[team.portrait]?.url ?? null, nameStatus: null,
    traits: [null, null, null], motto: null, duties: [], relations: [], tools: [], prohibitions: [],
    model: null, prompt: { text: null, version: null, status: null, acceptedBy: null },
    metrics: { plan: null, fact: null }, lastWork: null, lessons: [], history: [],
  });
  const completed = completedSteps(c);
  const available = environment === "production" && c.workspace === TEAM_BASE.workspace &&
    c.phase === "active" && c.writesOpen && completed >= 0 && completed < TEAM_STEPS;
  return { source: { environment, workspace: c.workspace, revision: c.revision, rootHash: c.rootHash, phase: c.phase },
    owner: { name: directory?.owner?.name ?? "Сергей", code: byId.get("owner")?.code ?? "не заполнено" },
    members, feed: feed.slice(0, 60),
    apply: { available, completed: Math.max(0, completed), total: TEAM_STEPS,
      reason: available ? null : completed === TEAM_STEPS ? "Пакет уже применён." :
        environment !== "production" ? "Dev заморожен. Применение только в production." : "Источник изменён или запись закрыта; требуется новая сверка.",
      pin: available ? { workspace: c.workspace, revision: c.revision, rootHash: c.rootHash,
        planHash: TEAM_PLAN_HASH, step: completed } : null } };
}
