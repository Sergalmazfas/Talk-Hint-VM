/** Read-only provider inventory. No DB, SDK generation, agent creation or call. */
import { mkdir, writeFile } from "node:fs/promises";
import { RetellApi } from "../server/secretaryLab/retellApi";

async function main() {
  const models = [];
  for (const model of ["gpt-6.1-sol", "gpt-6-sol"]) {
    const response = await fetch(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    models.push({ requestedModel: model, status: response.status, id: response.ok ? body.id : null,
      errorCode: response.ok ? null : body.error?.code ?? "unspecified",
      requestId: response.headers.get("x-request-id"), generationVerified: false });
  }
  const api = new RetellApi();
  const matches = (await api.listAgents()).filter(a =>
    a.agent_name?.startsWith("TalkHint Secretary — Telephone + Engine"));
  const agents = [];
  for (const candidate of matches) {
    const a = await api.request(`/get-agent/${encodeURIComponent(candidate.agent_id)}`);
    // A capability may appear in the callback; do NOT serialize response_engine.
    agents.push({ id: a.agent_id, version: a.version, name: a.agent_name, voice: a.voice_id,
      responseEngine: a.response_engine?.type, language: a.language,
      responsiveness: a.responsiveness ?? null,
      dynamicResponsiveness: a.enable_dynamic_responsiveness ?? null,
      interruptionSensitivity: a.interruption_sensitivity ?? null,
      sttMode: a.stt_mode ?? null, backchannel: a.enable_backchannel ?? null,
      storage: a.data_storage_setting ?? null,
      productionOrigin: (() => { try { return new URL(a.response_engine?.llm_websocket_url).hostname; } catch { return null; } })() });
  }
  const result = { at: new Date().toISOString(), readOnly: true, callsPlaced: 0, generationRequests: 0, models, agents };
  await mkdir("generated-artifacts/secretary-speed", { recursive: true });
  await writeFile("generated-artifacts/secretary-speed/provider-audit.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error("Read-only provider audit failed; no mutation or retry performed."); process.exitCode = 1; });
