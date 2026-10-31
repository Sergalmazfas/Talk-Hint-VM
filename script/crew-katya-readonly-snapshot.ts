/**
 * Explicit read-only provider inspection. Does not import readiness, storage,
 * retellPhone, schedulers or a running conversation; never creates an agent/call.
 * No task/personality data or credentials are exported.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { RetellApi, RetellApiError } from "../server/secretaryLab/retellApi";
const origin = "https://talkhint.app";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const out = "generated-artifacts/crew-mcp-extension";
const expectedName = `TalkHint Secretary — Telephone + Engine · ${hash(origin).slice(0, 10)}`;
let stage = "list_agents";
let matchingVersions: number | undefined;
let matchingAgents: number | undefined;
async function main() {
  const api = new RetellApi();
  const matches = (await api.listAgents()).filter(a => a.agent_name === expectedName);
  matchingVersions = matches.length;
  const uniqueIds = [...new Set(matches.map(a => a.agent_id))];
  matchingAgents = uniqueIds.length;
  stage = "select_exact_production_agent";
  if (uniqueIds.length !== 1) throw Error("Exactly one production telephone agent required; no fallback or creation.");
  const id = uniqueIds[0];
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw Error("Invalid provider agent identifier.");
  stage = "read_agent";
  const agent = await api.request(`/get-agent/${encodeURIComponent(id)}`);
  const expectedSocket = origin.replace(/^https:/, "wss:") + "/retell-phone-engine/{{talkhint_phone_ticket}}";
  stage = "verify_production_binding";
  if (agent.agent_name !== expectedName || agent.response_engine?.type !== "custom-llm" ||
      agent.response_engine.llm_websocket_url !== expectedSocket)
    throw Error("Production telephone binding mismatch; no alternative agent used.");
  // Only whitelisted configuration fields, never the raw provider response.
  const snapshot = { format: "talkhint.katya.readonly-provider-snapshot", checkedAt: new Date().toISOString(),
    providerReadOnly: true, agentCreated: false, callCreated: false, runtimeChanged: false,
    provider: { agentId: id, name: expectedName, version: agent.version ?? null,
      engineType: agent.response_engine.type, productionSocketMatches: true,
      voice: agent.voice_id ?? null, language: agent.language ?? null,
      maxCallDurationMs: agent.max_call_duration_ms ?? null,
      silenceEndMs: agent.end_call_after_silence_ms ?? null },
    engineCode: [] as { path: string; sha256: string }[],
    limitations: [
      "Retell использует custom-llm: текст задаёт TalkHint Engine, не Retell.",
      "Хэши ниже относятся к исходникам Dev. Совпадение с опубликованной сборкой не доказано.",
      "Задание, карточки и personality последней production-сессии не прочитаны; это не точный действующий промпт Кати.",
      "Три слоя настоящего промпта остаются заблокированы до получения проверенного контекста; ничего не реконструировано по догадке.",
    ] };
  for (const path of ["server/secretary/agent.ts", "server/secretary/conversationEngine.ts",
    "server/secretary/retellPhone.ts"])
    snapshot.engineCode.push({ path, sha256: hash(await fs.readFile(path, "utf8")) });
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(`${out}/katya-readonly-snapshot.json`, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ readOnly: true, providerBindingVerified: true,
    exactEnginePromptAvailable: false, saved: `${out}/katya-readonly-snapshot.json` }));
}
main().catch(async e => {
  // No provider body, credentials, task content or arbitrary error messages.
  const result = { error: "Readonly Katya snapshot unavailable; no writes or substitute prompt.",
    stage, matchingAgents, matchingVersions, ...(e instanceof RetellApiError ? { status: e.status } : {}) };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(`${out}/katya-readonly-unavailable.json`, JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result));
  process.exitCode = 1;
});
