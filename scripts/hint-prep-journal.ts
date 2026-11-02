/**
 * Two explicit descriptive journal entries via the existing production MCP.
 * No role creation, owner acceptance, runtime control or automatic retry.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
const dir = "generated-artifacts/hint-prep";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const endpoint = "https://talkhint.app/api/product-crew/mcp";
async function rpc(name: string, args: object) {
  if (!process.env.PRODUCT_CREW_KEY) throw Error("PRODUCT_CREW_KEY_NOT_CONFIGURED");
  const r = await fetch(endpoint, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(180000),
    headers: { "Content-Type": "application/json", "X-API-Key": process.env.PRODUCT_CREW_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }) });
  const b = await r.json() as any;
  if (!r.ok || b.error || b.result?.isError) throw Error(`MCP_STOP_NO_RETRY_HTTP_${r.status}`);
  return JSON.parse(b.result.content[0].text);
}
async function main() {
  const phase = process.argv[2];
  if (!["freeze", "result"].includes(phase)) throw Error("EXPLICIT_FREEZE_OR_RESULT_REQUIRED");
  const frozenText = await readFile(`${dir}/frozen-plan.json`, "utf8");
  const manifest = JSON.parse(await readFile(`${dir}/freeze-manifest.json`, "utf8"));
  if (hash(frozenText) !== manifest.sha256) throw Error("FROZEN_PLAN_CHANGED_STOP");
  // Match the existing MCP text schema's .trim() BEFORE comparing readback.
  const description = (phase === "freeze"
    ? `План зафиксирован ДО открытия расшифровки для этой сверки.\n${frozenText}`
    : await readFile(`${dir}/owner-summary.md`, "utf8")).trim();
  if (description.length > 12000) throw Error("ENTRY_TOO_LARGE_NO_TRUNCATION");
  const team = await rpc("get_team", {});
  if (!team.roles.some((r: any) => r.id === "product-manager-specialist") ||
      !team.roles.some((r: any) => r.id === "lg-qa-role")) throw Error("TEAM_MISMATCH_STOP");
  const requestId = randomUUID();
  const args = { revision: team.revision, requestId,
    title: phase === "freeze" ? "P.PREP · замороженный план шины 295/75 R22.5" : "P.PREP · сверка гипотезы подготовки на одной записи",
    description, client: "Паша Хинтович; итог владельцу, независимая проверка Фомы ожидается",
    need: "Проверить гипотезу подготовки звонка без доступа к расшифровке на этапе плана",
    roleId: "product-manager-specialist", processId: "product-hypotheses", relatedIds: [],
    nextStep: phase === "freeze" ? "Открыть расшифровку только после повторного чтения этой записи" : "Фома: независимая проверка; владельцу — решение. Рабочий Hint и PREP_PROMPT не менять.",
    source: "Решение владельца: P.PREP; вручную Replit, не агент и не работа Паши/Фомы",
    sourceDate: new Date().toISOString(), classification: "hypothesis",
    evidence: JSON.stringify({ planSha256: manifest.sha256, frozenAt: manifest.frozenAt,
      inputSha256: manifest.inputSha256, coordinatorPriorExposure: true,
      ownerCard: "не предоставлена", status: "proposed",
      limitation: "Описательная запись в журнале модели AI Crew, не исполнение runtime-агента." }),
  };
  const logPath = `${dir}/${phase}-journal.json`;
  // Write intent first. Any existing intent/unknown forbids automatic retries.
  const log: any = { status: "intent", phase, revisionBefore: team.revision,
    readHash: hash(JSON.stringify(team)), requestId, at: new Date().toISOString(),
    expectedCommands: 1, argumentsHash: hash(JSON.stringify(args)) };
  await writeFile(logPath, JSON.stringify(log, null, 2), { flag: "wx" });
  const saved = await rpc("record_information", args);
  log.response = saved;
  log.status = "write_returned";
  await writeFile(logPath, JSON.stringify(log, null, 2));
  if (!saved.saved || saved.replayed || saved.revision !== team.revision + 1 || !saved.record?.id)
    throw Error("WRITE_MISMATCH_STOP_NO_RETRY");
  const readback = await rpc("get_work", { recordId: saved.record.id });
  log.readback = readback; log.revisionAfter = readback.revision;
  await writeFile(logPath, JSON.stringify(log, null, 2));
  if (readback.revision !== saved.revision || readback.record?.description !== description)
    throw Error("READBACK_MISMATCH_STOP_NO_RETRY");
  log.status = "verified"; log.verifiedAt = new Date().toISOString();
  await writeFile(logPath, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ status: log.status, recordId: saved.record.id,
    revisionBefore: team.revision, revisionAfter: readback.revision, planSha256: manifest.sha256 }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "JOURNAL_FAILED"); process.exitCode = 1; });
