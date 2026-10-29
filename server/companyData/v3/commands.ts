import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import { applyHypothesisCommand } from "../../projectModel/hypotheses";
import { activeModelSize } from "../../projectModel/sizeBudget";
import { ModelError } from "../../projectModel/domain";
import { semanticHash } from "../valueTree";
import { at, arrayAt, arrayLength, decode, type Frame } from "./codec";
import { entityArrayEdits } from "./entityArrays";
import { projectFragment } from "./projection";
import { IncrementalCompanyRepository, type DeltaEdit } from "./repository";
import type { SqlFrameStore } from "./store";

const empty = (revision: number): ProjectModelState => ({
  schema: 1, revision, elements: [], relations: [], documents: [], decisions: [], proposals: [], taskDrafts: [],
});
const arrays = ["elements", "relations", "documents", "proposals", "taskDrafts"] as const;

async function workingState(store: SqlFrameStore, root: string, hypothesis: string, commands: ModelCommand[]) {
  const alternatives: { id: string; title: string; model: ProjectModelState }[] = [];
  let prefix: string[] = [];
  const rootFrame = await store.get(root);
  if (rootFrame.kind !== "object") throw new Error("Invalid company root");
  if (rootFrame.keys.includes("alternatives")) {
    const array = await at(root, ["alternatives"], store), length = await arrayLength(array, store);
    for (let i = 0; i < length; i++) {
      const path = ["alternatives", String(i)], id = await decode(await at(root, [...path, "id"], store), store);
      const title = await decode(await at(root, [...path, "title"], store), store);
      alternatives.push({ id, title, model: empty(0) });
      if (id === hypothesis) prefix = [...path, "model"];
    }
  }
  if (hypothesis !== "original" && !prefix.length) throw new ModelError(404, "Hypothesis missing");
  const selected = await at(root, prefix, store), frame = await store.get(selected);
  if (frame.kind !== "object") throw new Error("Invalid company hypothesis");
  const roots: { key: string; hash: string }[] = [];
  for (let i = 0; i < frame.keys.length; i++) {
    const key = frame.keys[i];
    if (["alternatives", "decisions", "operatingModel", "hypothesisContext"].includes(key)) continue;
    roots.push({ key, hash: frame.children[i] });
  }
  // An ordinary document/decision write never loads ANY operating graph.
  let operating: any;
  if (commands.some(c => c.type === "saveOperatingModel") && frame.keys.includes("operatingModel")) {
    const op = await at(selected, ["operatingModel"], store), f = await store.get(op);
    if (f.kind !== "object") throw new Error("Invalid operating model");
    operating = {};
    for (let i = 0; i < f.keys.length; i++) {
      if (f.keys[i] === "revisions") {
        const n = await arrayLength(f.children[i], store);
        if (n) roots.push({ key: "$lastOperatingRevision", hash: await arrayAt(f.children[i], n - 1, store) });
      } else roots.push({ key: `$operating:${f.keys[i]}`, hash: f.children[i] });
    }
  }
  await store.prefetch(roots.map(r => r.hash));
  const view: any = { decisions: [] };
  for (const r of roots) {
    const value = await decode(r.hash, store);
    if (r.key === "$lastOperatingRevision") operating.revisions = [value];
    else if (r.key.startsWith("$operating:")) operating[r.key.slice(11)] = value;
    else view[r.key] = value;
  }
  if (operating) view.operatingModel = { ...operating, revisions: operating.revisions ?? [] };
  return { view: view as ProjectModelState, prefix, alternatives };
}
function scopedColumns(all: Map<string, Frame>, prefix: string) {
  const columns = new Map<string, Frame>();
  for (const [key, value] of Array.from(all)) if (key === prefix || key.startsWith(prefix + "/"))
    columns.set(key.slice(prefix.length), value);
  return columns;
}

/**
 * Same pure domain commands, but hydrate only the selected active working set.
 * Immutable decisions/old operating revisions stay as SQL references and never
 * enter structuredClone/project/readRoot. A full response is an explicit read.
 */
export class CommandCompanyRepository {
  lastReceipt: Awaited<ReturnType<IncrementalCompanyRepository["commitDelta"]>> | undefined;
  constructor(readonly data: IncrementalCompanyRepository) {}
  read = (owner: string, hypothesis = "original") => this.data.read(owner, hypothesis);
  readRevision = (owner: string, revision: number, hypothesis = "original") => this.data.readRevision(owner, revision, hypothesis);
  readDocumentSnapshot = (owner: string, hypothesis: string, id: string) => this.data.readDocumentSnapshot(owner, hypothesis, id);
  update(owner: string, expected: number, command: ModelCommand, hypothesis = "original") {
    return this.updateMany(owner, expected, [command], hypothesis);
  }
  async writeMany(owner: string, expected: number, commands: ModelCommand[], hypothesis = "original") {
    if (!commands.length || commands.length > 3) throw new ModelError(400, "Expected one to three company commands");
    this.lastReceipt = await this.data.commitDelta(owner, expected, async store => {
      const { rows } = await store.db.query("SELECT root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [store.workspace]);
      const root = rows[0].root_hash as string;
      const { view, prefix, alternatives } = await workingState(store, root, hypothesis, commands);
      let scopedRoot = hypothesis === "original" ? { ...view, alternatives } :
        { ...empty(expected), alternatives: alternatives.map(a => a.id === hypothesis ? { ...a, model: view } : a) };
      scopedRoot.revision = expected;
      const before = view;
      for (const command of commands) scopedRoot = applyHypothesisCommand(scopedRoot, hypothesis, command, owner) as typeof scopedRoot;
      // Domain audit objects can contain optional `before: undefined` on creation.
      // Match the existing JSON persistence boundary, without serializing history.
      scopedRoot = JSON.parse(JSON.stringify(scopedRoot));
      const { alternatives: _alternatives, ...originalAfter } = scopedRoot;
      const after = hypothesis === "original" ? originalAfter :
        scopedRoot.alternatives.find(a => a.id === hypothesis)!.model;
      const fragment = empty(scopedRoot.revision), selected = empty(scopedRoot.revision);
      for (const key of arrays) (selected as any)[key] = (after[key] as any[]).filter(
        row => !before[key].some((old: any) => old.id === row.id && semanticHash(old) === semanticHash(row)));
      selected.decisions = after.decisions;
      const newOps = after.operatingModel?.revisions.slice(before.operatingModel?.revisions.length ?? 0) ?? [];
      if (newOps.length) selected.operatingModel = { ...after.operatingModel!, revisions: newOps };
      if (newOps.length) for (const id of ["DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"]) {
        const d = after.documents.find(d => d.id === id);
        if (d && !selected.documents.some(x => x.id === id)) selected.documents.push(d);
      }
      if (hypothesis === "original") Object.assign(fragment, selected);
      else fragment.alternatives = [{ id: hypothesis, title: alternatives.find(a => a.id === hypothesis)!.title, model: selected }];
      const namespace = new Map<string, string>([
        ...after.elements.map(e => [e.id, "element"] as [string, string]),
        ...after.documents.map(d => [d.id, "document"] as [string, string]),
        ...(after.competitorDirectory?.records ?? []).map(c => [c.id, "competitor"] as [string, string]),
      ]);
      const columns = await projectFragment(fragment, store, store.schema, namespace);
      const fragmentPrefix = hypothesis === "original" ? "" : "/alternatives/0/model";
      const edits: DeltaEdit[] = [];
      for (const key of arrays) {
        const oldArray = await at(root, [...prefix, key], store), old = before[key] as any[], next = after[key] as any[];
        edits.push(...await entityArrayEdits({ old, next, oldArray, path: [...prefix, key], store,
          documentHypothesis: key === "documents" ? hypothesis : undefined,
          columnsFor: id => scopedColumns(columns,
            `${fragmentPrefix}/${key}/${(selected[key] as any[]).findIndex(r => r.id === id)}`),
        }));
      }
      const decisions = await at(root, [...prefix, "decisions"], store), count = await arrayLength(decisions, store);
      for (let i = 0; i < after.decisions.length; i++) edits.push({
        path: [...prefix, "decisions"], insertAt: count + i, value: after.decisions[i],
        columns: scopedColumns(columns, `${fragmentPrefix}/decisions/${i}`),
      });
      if (newOps.length) {
        if (!before.operatingModel) edits.push({ path: [...prefix, "operatingModel"], value: after.operatingModel,
          columns: scopedColumns(columns, `${fragmentPrefix}/operatingModel`) });
        else {
          const path = [...prefix, "operatingModel", "revisions"];
          const n = await arrayLength(await at(root, path, store), store);
          for (let i = 0; i < newOps.length; i++) edits.push({ path, insertAt: n + i, value: newOps[i],
            columns: scopedColumns(columns, `${fragmentPrefix}/operatingModel/revisions/${i}`) });
        }
      }
      for (const key of Object.keys(after)) {
        if ([...arrays, "decisions", "operatingModel", "alternatives", "hypothesisContext"].includes(key as any)) continue;
        if (!Object.prototype.hasOwnProperty.call(before, key) ||
            semanticHash((before as any)[key]) !== semanticHash((after as any)[key]))
          edits.push({ path: [...prefix, key], value: (after as any)[key] });
      }
      const delta = activeModelSize(after) - activeModelSize(before);
      const sizes = await store.db.query(`SELECT hypothesis_id,active_utf16 FROM company_v3_size_budgets
        WHERE workspace_id=$1 AND hypothesis_id=ANY($2::text[]) FOR UPDATE`, [store.workspace, [hypothesis, "$root"]]);
      if (sizes.rows.length !== 2) throw new Error("Company active size inventory missing");
      for (const r of sizes.rows) {
        const adjustment = delta + (r.hypothesis_id === "$root" && hypothesis !== "original" ?
          String(scopedRoot.revision).length - String(expected).length : 0);
        const size = Number(r.active_utf16) + adjustment;
        const limit = r.hypothesis_id === "$root" ? 8_000_000 : hypothesis === "original" ? 5_000_000 : 6_500_000;
        if (size > limit) throw new ModelError(413, "Company active character budget exceeded; history retained");
        await store.db.query(`UPDATE company_v3_size_budgets SET active_utf16=$3
          WHERE workspace_id=$1 AND hypothesis_id=$2`, [store.workspace, r.hypothesis_id, size]);
      }
      store.stats.company_v3_size_budgets = { inserted: 0, updated: 2, logicalBytes: 16 };
      return { edits, revisionAdvance: scopedRoot.revision - expected };
    }, owner);
    return this.lastReceipt;
  }
  async updateMany(owner: string, expected: number, commands: ModelCommand[], hypothesis = "original") {
    await this.writeMany(owner, expected, commands, hypothesis);
    // Old API promises the complete selected model; export cost is not writer verification.
    return this.read(owner, hypothesis);
  }
}
