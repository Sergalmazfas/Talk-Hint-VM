import { createHash } from "node:crypto";
import type { ModelCommand } from "../../shared/projectModel";
import { ModelError } from "./modelError";

type Proof = { owner: string; revision: number; digest: string; commands: ModelCommand[] };
// Server-memory capabilities: neither JSON fields nor copied arrays carry authority.
const batches = new WeakMap<ModelCommand[], Proof>();
const preparations = new WeakMap<object, Proof>();
const digest = (commands: ModelCommand[]) => createHash("sha256").update(JSON.stringify(commands)).digest("hex");
const invalid = () => { throw new ModelError(400, "Invalid transaction size"); };

/** Called only after the fixed production Secretary macro adds its receipt. */
export function authorizeSecretaryDepartmentBatch(owner: string, revision: number, commands: ModelCommand[]) {
  const ids = ["DOC-PLANNED-secretary-project-head", "DOC-PLANNED-secretary-lab-engineer",
    "DOC-PLANNED-secretary-qa", "DOC-SECRETARY-DEPARTMENT-STRUCTURE", "DOC-TEAM-PROJECTION-MANAGERS"];
  if (commands.length !== 7 || commands[0].type !== "saveOperatingModel") invalid();
  for (let i = 0; i < ids.length; i++) {
    const c = commands[i + 1];
    const allowedType = i === 4 ? c.type === "createDocument" || c.type === "saveDocument" : c.type === "createDocument";
    if (!allowedType || !("id" in c) || c.id !== ids[i]) invalid();
  }
  const receipt = commands[6];
  if (receipt.type !== "createElement" || !receipt.id?.startsWith("PC-CHANGE-") ||
      receipt.element.coordination?.roleId !== "secretary-project-head" ||
      receipt.element.coordination?.processId !== "DOC-SECRETARY-DEPARTMENT-STRUCTURE" ||
      receipt.element.coordination?.state !== "received") invalid();
  batches.set(commands, { owner, revision, digest: digest(commands), commands });
}

function matches(p: Proof, owner: string, revision: number) {
  return p.owner === owner && p.revision === revision && p.commands.length === 7 &&
    digest(p.commands) === p.digest;
}

export function assertTransactionBatch(owner: string, revision: number, commands: ModelCommand[], hypothesis: string) {
  const proof = batches.get(commands);
  if (proof) {
    if (hypothesis !== "new-country" || !matches(proof, owner, revision)) invalid();
  } else if (!commands.length || commands.length > 3) invalid();
}

/** Carry only a validated macro's authority to its exact delta-preparation closure. */
export function bindSecretaryDepartmentPreparation(owner: string, revision: number, commands: ModelCommand[],
  hypothesis: string, prepare: object) {
  assertTransactionBatch(owner, revision, commands, hypothesis);
  const proof = batches.get(commands);
  if (proof) preparations.set(prepare, proof);
}

export function assertRevisionAdvance(owner: string, revision: number, prepare: object, advance: number) {
  const proof = preparations.get(prepare);
  // A seven-command macro must advance exactly seven, not an arbitrary larger delta.
  const valid = proof ? advance === 7 && matches(proof, owner, revision) :
    Number.isSafeInteger(advance) && advance >= 1 && advance <= 3;
  if (!valid) throw new ModelError(400, "Invalid company revision advance");
}
