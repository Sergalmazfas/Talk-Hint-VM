import type { ProjectModelState } from "../../shared/projectModel";
import type { CrewState } from "./domain";
import { ownerProductProhibition } from "../../shared/ownerProductPolicy";
import { employeeModelRecommendationSchema, employeeWorkplaceSchema } from "../../shared/employeeSections";
import { secretaryDepartmentRoles } from "../../shared/secretaryDepartment";

type Finding = { status: "ok" | "problem"; where: string; check: string };
/** Read-only, deterministic. Unknown/missing fields are problems, not inferred OK.
 * Output contains IDs/check codes only; no call text, names, prompts or phones. */
export function auditStructure(model: ProjectModelState, crew: CrewState, at: string) {
  const nodes = model.operatingModel?.revisions.at(-1)?.data.nodes ?? [];
  const out: Finding[] = [];
  const add = (ok: boolean, where: string, check: string) => out.push({ status: ok ? "ok" : "problem", where, check });
  const required = new Set(["head-product", "product-manager-specialist", "laboratory-engineer-role", "lg-qa-role",
    ...secretaryDepartmentRoles.map(r => r.id)]);
  const inScope = (id: string) => {
    if (required.has(id)) return true;
    let current = nodes.find(n => n.id === id);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (["product-manager-specialist", secretaryDepartmentRoles[0].id].includes(current.id)) return true;
      seen.add(current.id); current = nodes.find(n => n.id === current?.managerId);
    }
    return false;
  };
  const targets = nodes.filter(n => n.kind === "role" && (inScope(n.id) ||
    n.code.startsWith("P.LG") || n.code === "P.LAB"));
  for (const id of Array.from(required)) if (!targets.some(n => n.id === id)) add(false, id, "role_missing");
  const exec = (id: string | null) => {
    const n = nodes.find(n => n.id === id);
    return n?.executorId ?? (n?.kind === "resource" ? n.id : null);
  };
  for (const role of targets) {
    const profiles = model.documents.flatMap(d => {
      try { const p = JSON.parse(d.text); return p?.visualPassport?.roleId === role.id ? [p] : []; }
      catch { return []; }
    });
    add(profiles.length === 1, role.id, "exactly_one_profile");
    const p = profiles.length === 1 ? profiles[0] : null;
    add(employeeWorkplaceSchema.safeParse(p?.employeeSections?.workplace).success, role.id, "workplace");
    add(employeeModelRecommendationSchema.safeParse(p?.employeeSections?.modelRecommendation).success,
      role.id, "model_recommendation_disabled");
    const bans = p?.prohibitions;
    add((Array.isArray(bans) ? bans : typeof bans === "string" ? [bans] : [])
      .some((b: unknown) => typeof b === "string" && b.toLowerCase().includes(ownerProductProhibition)),
    role.id, "owner_product_prohibition");
    const actions = nodes.filter(n => n.kind === "action" && n.roleId === role.id);
    add(actions.length > 0, role.id, "duties_present");
    for (const a of actions) {
      add(!!a.schedule?.trigger?.trim(), a.id, "duty_trigger");
      add(!!a.success?.trim() || nodes.some(n => n.kind === "result" && n.parentId === a.id), a.id, "duty_result");
      add(!!a.clientId && nodes.some(n => n.id === a.clientId), a.id, "duty_customer");
      add(!!a.acceptorId && nodes.some(n => n.id === a.acceptorId), a.id, "duty_acceptor");
    }
    let current = role, depth = 0, reachedOwner = false, maria = role.id === "head-product";
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id)) { add(false, role.id, "hierarchy_loop"); break; }
      visited.add(current.id);
      if (current.id === "owner") { reachedOwner = true; break; }
      if (current.id === "head-product") maria = true;
      const parent = nodes.find(n => n.id === current.managerId);
      if (!parent) break;
      current = parent; depth++;
      if (depth > nodes.length) break;
    }
    add(reachedOwner && maria && depth <= 3, role.id, "hierarchy_to_maria_owner_depth_le_3");
    const expected = role.id === "head-product" ? "owner" :
      ["product-manager-specialist", secretaryDepartmentRoles[0].id].includes(role.id) ? "head-product" :
      secretaryDepartmentRoles.slice(1).some(r => r.id === role.id) ? secretaryDepartmentRoles[0].id :
      ["laboratory-engineer-role", "lg-qa-role"].includes(role.id) ? "product-manager-specialist" : role.managerId;
    add(role.managerId === expected, role.id, "immediate_manager");
  }
  // All actions, not just Hint, including the same executor in different roles.
  for (const a of nodes.filter(n => n.kind === "action")) {
    const author = a.executorId ?? exec(a.roleId);
    const acceptor = exec(a.acceptorId);
    add(!!a.acceptorId && a.acceptorId !== a.roleId && a.acceptorId !== a.executorId &&
      !(author && acceptor && author === acceptor), a.id, "no_self_acceptance");
    if (a.roleId && a.acceptorId && (!author || !acceptor))
      add(false, a.id, "executor_identity_not_established");
  }
  const stale = crew.tasks.filter(t => !t.closed).map(t => {
    const step = t.steps.at(-1);
    const hours = step ? (Date.parse(at) - Date.parse(step.updatedAt)) / 3600000 : NaN;
    return { taskId: t.id, holder: step?.holder ?? null,
      hours: Number.isFinite(hours) ? Math.max(0, Math.round(hours * 100) / 100) : null,
      stale: !Number.isFinite(hours) || hours > crew.control.staleHours };
  });
  for (const t of stale) add(!t.stale, t.taskId, "task_last_entry_within_stale_hours");
  return { day: at.slice(0, 10), at, modelRevision: model.revision, findings: out, stale,
    summary: { ok: out.filter(f => f.status === "ok").length, problems: out.filter(f => f.status === "problem").length },
    modelsCalled: 0, modelWrites: 0 };
}
