import type { Pool, PoolClient } from "pg";
import type { ModelDocument, ProjectModelState } from "../../shared/projectModel";
import type { OperatingRevision } from "../../shared/operatingModel";
import { at, arrayAt, arrayLength, decode } from "../companyData/v3/codec";
import { SqlFrameStore } from "../companyData/v3/store";
import { readBusinessContract } from "../companyData/v3/businessContract";
import { IncrementalCompanyRepository, type DeltaEdit } from "../companyData/v3/repository";
import { projectFragment } from "../companyData/v3/projection";
import { entityArrayEdits } from "../companyData/v3/entityArrays";
import { semanticHash, textHash } from "../companyData/valueTree";
import { ModelError } from "../projectModel/modelError";
import { DIRECTORY, JOURNAL, JOURNAL_SHA, proposedStep, TEAM_BASE, TEAM_PLAN_HASH, TEAM_ROOTS, TEAM_STEPS } from "./plan";
import { portraitManifest } from "./portraits";
import type { TeamPartnersPin } from "../../shared/team";
import { PARTNERS_BASE, PARTNERS_NEXT_ROOT, PARTNERS_DOCUMENT_HASH, partnersDocument } from "./partnersApproval";

export interface TeamContext {
  workspace: string; owner: string; revision: number; rootHash: string;
  phase: string; writesOpen: boolean; prefix: string[];
  operating: OperatingRevision; operatingLength: number;
  documents: ModelDocument[]; elements: any[]; hypothesisRevision: number;
  profiles: any[]; roles: any[]; prompts: any[]; jobs: any[]; controls: any[]; revisions: any[];
  actor: string;
  secretaryTasks?: any[];
  secretaryDefault?: string | null;
  secretaryOwnerName?: string;
}
/** Only bounded active subtrees. Never preload/export the historical model. */
export async function readContext(db: PoolClient, owner: string, environment: string,
  options: { test?: boolean; store?: SqlFrameStore } = {}): Promise<TeamContext> {
  const q = await db.query(`SELECT w.*,c.phase,c.writes_open,h.actor
    FROM company_v3_workspaces w LEFT JOIN company_cutover_controls c
    ON c.workspace_id=w.workspace_id AND c.owner_key=w.owner_key AND c.environment=w.environment
    JOIN company_v3_revision_heads h ON h.workspace_id=w.workspace_id AND h.revision=w.current_revision
    WHERE w.owner_key=$1 AND w.environment=$2`, [owner, environment]);
  const w = q.rows[0];
  const test = options.test && environment === "development" && owner.startsWith("team-review:");
  if (!w || w.schema_version !== 3 ||
      !(test ? w.generation === "test" : environment === "production" && w.generation === "normalized" &&
        ["active", "verifying"].includes(w.phase)))
    throw new ModelError(503, "Активный production-источник команды недоступен; legacy/Dev не подставляется.");
  const store = options.store ?? new SqlFrameStore(db, w.workspace_id, await readBusinessContract(db));
  const alternatives = await at(w.root_hash, ["alternatives"], store);
  let prefix: string[] | undefined;
  for (let i = 0; i < await arrayLength(alternatives, store); i++)
    if (await decode(await at(w.root_hash, ["alternatives", String(i), "id"], store), store) === "new-country")
      prefix = ["alternatives", String(i), "model"];
  if (!prefix) throw new ModelError(503, "new-country недоступна");
  const docsHash = await at(w.root_hash, [...prefix, "documents"], store);
  const elementsHash = await at(w.root_hash, [...prefix, "elements"], store);
  const opsHash = await at(w.root_hash, [...prefix, "operatingModel", "revisions"], store);
  const n = await arrayLength(opsHash, store);
  if (!n) throw new ModelError(503, "Роли не описаны");
  const opHash = await arrayAt(opsHash, n - 1, store);
  await store.prefetch([docsHash, elementsHash, opHash]);
  const documents = await decode(docsHash, store) as ModelDocument[];
  const operating = await decode(opHash, store) as OperatingRevision;
  const elements = await decode(elementsHash, store) as any[];
  const revision = Number(w.current_revision);
  return { workspace: w.workspace_id, owner, revision, rootHash: w.root_hash,
    phase: test ? "test" : w.phase, writesOpen: test ? true : w.writes_open,
    prefix, documents, operating, operatingLength: n, elements,
    hypothesisRevision: Number(await decode(await at(w.root_hash, [...prefix, "revision"], store), store)),
    profiles: (await db.query("SELECT * FROM company_v3_employee_profiles WHERE workspace_id=$1 AND hypothesis_id='new-country'",
      [w.workspace_id])).rows,
    roles: (await db.query("SELECT * FROM company_v3_roles WHERE workspace_id=$1 AND hypothesis_id='new-country'",
      [w.workspace_id])).rows,
    prompts: (await db.query(`SELECT p.*,COALESCE(s.exact_text,p.text_body) AS text_body
      FROM company_v3_role_prompt_versions p LEFT JOIN company_v3_payload_text_refs r
      ON r.workspace_id=p.workspace_id AND r.target_table='company_role_prompt_versions'
      AND r.record_hash=p.record_hash AND r.column_name='text_body'
      LEFT JOIN company_v3_text_snapshots s ON s.workspace_id=r.workspace_id AND s.snapshot_hash=r.snapshot_hash
      WHERE p.workspace_id=$1 AND p.hypothesis_id='new-country'`,
      [w.workspace_id])).rows,
    jobs: (await db.query("SELECT key,call_sid,status,updated_at,report,journal FROM call_lab_jobs WHERE owner_id=$1 AND environment=$2 ORDER BY updated_at DESC LIMIT 20",
      [owner, environment])).rows,
    controls: (await db.query("SELECT key,enabled,watchdog FROM call_lab_controls WHERE owner_id=$1 AND environment=$2",
      [owner, environment])).rows,
    revisions: (await db.query("SELECT revision,actor,created_at FROM company_v3_revision_heads WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 20",
      [w.workspace_id])).rows,
    secretaryTasks: test ? [] : (await db.query(`SELECT t.*,
      c.metadata AS call_metadata,c.ended_at AS call_ended_at
      FROM secretary_tasks t LEFT JOIN calls c ON c.call_sid=t.call_sid AND c.user_id=t.user_id
      WHERE t.user_id=$1 ORDER BY t.updated_at DESC LIMIT 20`, [owner])).rows,
    secretaryDefault: test ? null : (await db.query(
      "SELECT provider FROM secretary_outgoing_defaults WHERE user_id=$1", [owner])).rows[0]?.provider ?? null,
    secretaryOwnerName: test ? "" : (await db.query(
      "SELECT concat_ws(' ',first_name,last_name) AS name FROM users WHERE id=$1", [owner])).rows[0]?.name ?? "",
    actor: w.actor };
}
export function completedSteps(c: TeamContext) {
  const directory = c.documents.find(d => d.id === DIRECTORY);
  if (directory && c.revision >= TEAM_BASE.revision + TEAM_STEPS &&
      JSON.parse(directory.text).packageHash === TEAM_PLAN_HASH) return TEAM_STEPS;
  const completed = c.revision - TEAM_BASE.revision;
  if (!Number.isInteger(completed) || completed < 0 || completed > TEAM_STEPS) return -1;
  if (!completed) return c.rootHash === TEAM_BASE.rootHash ? 0 : -1;
  return c.actor === `team-package:${TEAM_PLAN_HASH}:${completed - 1}` && c.rootHash === TEAM_ROOTS[completed] ? completed : -1;
}
export class TeamRepository {
  constructor(readonly pool: Pool, readonly environment = "production", readonly test = false,
    readonly discoverTestPins = false) {
    if (discoverTestPins && (!test || environment !== "development")) throw Error("Pin calibration is isolated Dev-test only");
  }
  async read(owner: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const c = await readContext(db, owner, this.environment, { test: this.test });
      await db.query("COMMIT"); return c;
    } catch (e) { await db.query("ROLLBACK"); throw e; }
    finally { db.release(); }
  }
  async apply(owner: string, expected: { revision: number; rootHash: string; workspace: string; step: number; planHash: string }) {
    if (expected.planHash !== TEAM_PLAN_HASH) throw new ModelError(409, "Пакет изменился");
    const repo = new IncrementalCompanyRepository(this.pool, this.environment as any, this.test);
    return repo.commitDelta(owner, expected.revision, async store => {
      const c = await readContext(store.db, owner, this.environment, { test: this.test, store });
      const completed = this.discoverTestPins ? c.revision - TEAM_BASE.revision : completedSteps(c);
      if (c.workspace !== expected.workspace || c.rootHash !== expected.rootHash ||
          completed !== expected.step || completed < 0 || completed >= TEAM_STEPS || !c.writesOpen ||
          (!this.test && (c.workspace !== TEAM_BASE.workspace || c.phase !== "active")))
        throw new ModelError(409, "Pin или этап не совпал; перечитайте источник.");
      const journal = c.documents.find(d => d.id === JOURNAL);
      if (!completed && (!journal || textHash(journal.text) !== JOURNAL_SHA))
        throw new ModelError(409, "Журнал изменён");
      const change = proposedStep(completed, c.documents, c.operating, portraitManifest);
      const nextDocs = c.documents.map(d => change.documents.find(n => n.id === d.id) ?? d);
      nextDocs.push(...change.documents.filter(d => !c.documents.some(o => o.id === d.id)));
      const fragment: ProjectModelState = { schema: 1, revision: expected.revision + 1,
        elements: [], relations: [], documents: [], proposals: [], decisions: [], taskDrafts: [],
        alternatives: [{ id: "new-country", title: "Новая страна", model: {
          schema: 1, revision: c.hypothesisRevision + 1, elements: [], relations: [], proposals: [], decisions: [],
          taskDrafts: [], documents: change.documents,
          ...(change.operating ? { operatingModel: { revisions: [change.operating] } } : {}),
        } }] };
      const namespace = new Map<string, string>([
        ...c.elements.map(e => [e.id, "element"] as [string, string]),
        ...nextDocs.map(d => [d.id, "document"] as [string, string]),
      ]);
      const columns = await projectFragment(fragment, store, store.schema, namespace);
      const scoped = (path: string) => {
        const output = new Map();
        for (const [k, v] of Array.from(columns)) if (k === path || k.startsWith(path + "/")) output.set(k.slice(path.length), v);
        return output;
      };
      const edits: DeltaEdit[] = await entityArrayEdits({
        old: c.documents, next: nextDocs, oldArray: await at(c.rootHash, [...c.prefix, "documents"], store),
        path: [...c.prefix, "documents"], store, documentHypothesis: "new-country",
        columnsFor: id => scoped(`/alternatives/0/model/documents/${change.documents.findIndex(d => d.id === id)}`),
      });
      edits.push({ path: [...c.prefix, "revision"], value: c.hypothesisRevision + 1 });
      const delta = JSON.stringify(nextDocs).length - JSON.stringify(c.documents).length;
      const sizes = await store.db.query(`SELECT hypothesis_id,active_utf16 FROM company_v3_size_budgets
        WHERE workspace_id=$1 AND hypothesis_id IN ('new-country','$root') FOR UPDATE`, [c.workspace]);
      if (sizes.rows.length !== 2) throw Error("Size inventory missing");
      for (const r of sizes.rows) {
        const size = Number(r.active_utf16) + delta +
          String(c.hypothesisRevision + 1).length - String(c.hypothesisRevision).length +
          (r.hypothesis_id === "$root" ? String(c.revision + 1).length - String(c.revision).length : 0);
        if (size > (r.hypothesis_id === "$root" ? 8_000_000 : 6_500_000)) throw new ModelError(413, "Лимит активной модели");
        await store.db.query("UPDATE company_v3_size_budgets SET active_utf16=$3 WHERE workspace_id=$1 AND hypothesis_id=$2",
          [c.workspace, r.hypothesis_id, size]);
      }
      return { edits, expectedRootHash: this.discoverTestPins ? undefined : TEAM_ROOTS[completed + 1] };
    }, `team-package:${TEAM_PLAN_HASH}:${expected.step}`);
  }
  async applyPartners(owner: string, expected: TeamPartnersPin) {
    if (expected.documentHash !== PARTNERS_DOCUMENT_HASH || expected.revision !== 918 ||
        expected.rootHash !== PARTNERS_BASE.rootHash ||
        (!this.test && (expected.workspace !== PARTNERS_BASE.workspace || this.environment !== "production")))
      throw new ModelError(409, "Закреплённый pin изменился");
    const repo = new IncrementalCompanyRepository(this.pool, this.environment as any, this.test);
    return repo.commitDelta(owner, expected.revision, async store => {
      const c = await readContext(store.db, owner, this.environment, { test: this.test, store });
      const document = partnersDocument();
      if (c.workspace !== expected.workspace || c.rootHash !== expected.rootHash || !c.writesOpen ||
          (!this.test && c.phase !== "active") || c.documents.some(d => d.id === document.id) ||
          c.elements.some(e => e.id === document.id))
        throw new ModelError(409, "Источник изменился; автоматическое повторение запрещено");
      const fragment: ProjectModelState = { schema: 1, revision: c.revision + 1,
        elements: [], relations: [], documents: [], proposals: [], decisions: [], taskDrafts: [],
        alternatives: [{ id: "new-country", title: "Новая страна", model: {
          schema: 1, revision: c.hypothesisRevision + 1, elements: [], relations: [], proposals: [],
          decisions: [], taskDrafts: [], documents: [document],
        } }] };
      const namespace = new Map<string, string>([
        ...c.elements.map(e => [e.id, "element"] as [string, string]),
        ...[...c.documents, document].map(d => [d.id, "document"] as [string, string]),
      ]);
      const columns = await projectFragment(fragment, store, store.schema, namespace);
      const edits: DeltaEdit[] = await entityArrayEdits({
        old: c.documents, next: [...c.documents, document],
        oldArray: await at(c.rootHash, [...c.prefix, "documents"], store),
        path: [...c.prefix, "documents"], store, documentHypothesis: "new-country",
        columnsFor: () => {
          const scoped = new Map();
          const prefix = "/alternatives/0/model/documents/0";
          for (const [key, value] of Array.from(columns))
            if (key === prefix || key.startsWith(prefix + "/")) scoped.set(key.slice(prefix.length), value);
          return scoped;
        },
      });
      edits.push({ path: [...c.prefix, "revision"], value: c.hypothesisRevision + 1 });
      const delta = JSON.stringify([...c.documents, document]).length - JSON.stringify(c.documents).length;
      const sizes = await store.db.query(`SELECT hypothesis_id,active_utf16 FROM company_v3_size_budgets
        WHERE workspace_id=$1 AND hypothesis_id IN ('new-country','$root') FOR UPDATE`, [c.workspace]);
      if (sizes.rows.length !== 2) throw Error("Size inventory missing");
      for (const row of sizes.rows) {
        const size = Number(row.active_utf16) + delta +
          String(c.hypothesisRevision + 1).length - String(c.hypothesisRevision).length +
          (row.hypothesis_id === "$root" ? String(c.revision + 1).length - String(c.revision).length : 0);
        if (size > (row.hypothesis_id === "$root" ? 8_000_000 : 6_500_000))
          throw new ModelError(413, "Лимит активной модели");
        await store.db.query("UPDATE company_v3_size_budgets SET active_utf16=$3 WHERE workspace_id=$1 AND hypothesis_id=$2",
          [c.workspace, row.hypothesis_id, size]);
      }
      return { edits, expectedRootHash: this.discoverTestPins ? undefined : PARTNERS_NEXT_ROOT };
    }, `team-external-partners:${PARTNERS_DOCUMENT_HASH}`);
  }
}
