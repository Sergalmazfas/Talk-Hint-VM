/**
 * Explicit Dev-only database proof. No network transports or business fixtures.
 * Creates an isolated synthetic model namespace, always removes it.
 * Run: NODE_ENV=development npx tsx server/projectModel/devSmoke.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dbReady, pool } from "../db";
import { PgModelRepository } from "./repository";

async function main() {
  if (process.env.NODE_ENV !== "development") throw Error("Dev-only smoke");
  await dbReady;
  if (!pool) throw Error("Dev database unavailable");
  const owner = `project-model-smoke-${randomUUID()}`;
  const other = `${owner}-other`;
  const repo = new PgModelRepository(async () => pool!);
  try {
    const start = await repo.read(owner);
    assert.equal(start.revision, 0);
    const command = { type: "saveDocument" as const, title: "Smoke", text: "Кириллица ¿/¡", url: "", elementIds: ["TH-CLIENT"] };
    const concurrent = await Promise.allSettled([repo.update(owner, 0, command), repo.update(owner, 0, command)]);
    assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(r => r.status === "rejected").length, 1);
    const restartedRepo = new PgModelRepository(async () => pool!);
    const saved = await restartedRepo.read(owner);
    assert.equal(saved.revision, 1);
    assert.equal(saved.documents.at(-1)?.text, "Кириллица ¿/¡");
    assert.equal(saved.documents.filter(d => d.title === "Smoke").length, 1);
    assert.equal(saved.decisions.at(-1)?.documentAfter?.title, "Smoke");
    const independent = await repo.read(other);
    assert.equal(independent.revision, 0);
    assert.equal(independent.documents.some(d => d.title === "Smoke"), false);
    await assert.rejects(repo.update(owner, 0, command));
    assert.equal((await repo.read(owner)).revision, 1);
    console.log("Project Model Dev PG smoke PASS: persistence/restart, Unicode, concurrent lease/conflict, no duplicate mutation, audit snapshot, isolation, stale retry. No external actions.");
  } finally {
    await pool.query("DELETE FROM talkhint_project_model_history WHERE owner_key = ANY($1::text[])", [[owner, other]]);
    await pool.query("DELETE FROM talkhint_project_models WHERE owner_key = ANY($1::text[])", [[owner, other]]);
    await pool.end();
  }
}
main().catch(error => { console.error("Project Model Dev smoke FAILED", error instanceof Error ? error.message : "unknown"); process.exitCode = 1; });
