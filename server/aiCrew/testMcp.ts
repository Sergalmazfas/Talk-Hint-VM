import express, { type Express } from "express";
import { z } from "zod";
import type { StateStore } from "./store";
import { applyTestAction, authorizeTest, checkTestKey, keyHash, TEST_ACTOR, testActions } from "./testGrant";
import type { HintEvidence } from "./hintEvidence";
import { log } from "./domain";
import { auditStructure } from "./structureAudit";
import type { ProjectModelState } from "../../shared/projectModel";

const mutations = ["crew_test_prepare", "crew_test_enable", "crew_test_start", "crew_test_off", "crew_test_close_stalled"] as const;
const base = { revision: z.number().int().nonnegative(), requestId: z.string().uuid() };
const writeSchema = z.object({ ...base, command: testActions }).strict();
const readNames = ["crew_test_state", "crew_structure_check"];
export const crewTestTools = [...readNames, ...mutations];
export function registerTestMcp(app: Express, o: {
  environment: string; store: () => StateStore; secret: () => string | undefined;
  evidence: () => Promise<HintEvidence>; models: () => Promise<string[]>;
  model: () => Promise<ProjectModelState>; now?: () => Date;
}) {
  // Separate endpoint/scope; PRODUCT_CREW_KEY/OAuth/owner cookies confer no authority.
  app.post("/api/crew-test/mcp", express.json({ limit: "8kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (o.environment !== "production" || !checkTestKey(req.get("X-API-Key"), o.secret()) ||
        req.get("Origin")) { res.status(403).json({ error: "CREW_TEST_DENIED" }); return; }
    const now = () => (o.now?.() ?? new Date()).toISOString(), rpc = req.body;
    if (!rpc || rpc.jsonrpc !== "2.0" || !["string", "number"].includes(typeof rpc.id)) {
      res.status(400).json({ error: "INVALID_RPC" }); return;
    }
    try {
      const hash = keyHash(req.get("X-API-Key")!);
      const authorize = () => o.store().change(s => authorizeTest(s, hash, now()));
      let result: unknown;
      if (rpc.method === "tools/call") {
        const { name, arguments: args = {} } = rpc.params ?? {};
        if (!crewTestTools.includes(name)) throw Error("TOOL_NOT_ALLOWED");
        if (readNames.includes(name)) {
          z.object({}).strict().parse(args);
          await authorize();
          if (name === "crew_structure_check") {
            result = auditStructure(await o.model(), await o.store().read(), now());
          } else {
            const s = await o.store().read(), tasks = s.tasks.filter(t => t.testSeriesId === s.testGrant?.id);
            const ids = new Set(tasks.map(t => t.id));
            result = { revision: s.revision, control: s.control,
              grant: s.testGrant ? { ...s.testGrant, keyHash: undefined } : null,
              tasks: tasks.map(({ hintPilot, ...t }) => ({ ...t, hintPilot: hintPilot ?
                { ...hintPilot, evidence: undefined } : undefined })),
              runs: s.runs.filter(r => ids.has(r.taskId)),
              legacyStalledCandidates: s.tasks.filter(t => !t.closed && t.hintPilot?.candidate === "latency" &&
                t.hintPilot.status === "author" && !ids.has(t.id)).map(t => ({
                  taskId: t.id, status: t.hintPilot!.status,
                  runs: s.runs.filter(r => r.taskId === t.id).map(r => ({
                    status: r.status, cost: r.cost, reserved: r.reserved,
                  })),
                })),
              documents: s.documents.filter(d => ids.has(d.taskId)),
              journal: s.journal.filter(e => e.actor === TEST_ACTOR ||
                ids.has((e.detail as any)?.taskId)),
              structureReports: s.structureReports ?? [] };
          }
        } else {
          const a = writeSchema.parse(args);
          const expected = `crew_test_${a.command.action}`;
          if (name !== expected) throw Error("TOOL_COMMAND_MISMATCH");
          // Precheck scope before fetching owner-only excerpts/model catalog.
          const before = await o.store().read();
          if (before.revision !== a.revision) throw Error("STALE_REVISION");
          if (before.testGrant && (before.testGrant.keyHash !== hash || before.testGrant.revokedAt ||
              Date.parse(now()) >= Date.parse(before.testGrant.expiresAt))) throw Error("CREW_TEST_DENIED");
          const evidence = a.command.action === "prepare" ? await o.evidence() : undefined;
          const models = a.command.action === "prepare" ? await o.models() : [];
          await o.store().change(s => {
            authorizeTest(s, hash, now());
            if (s.journal.some(e => e.actor === TEST_ACTOR && (e.detail as any)?.requestId === a.requestId))
              throw Error("REQUEST_ALREADY_USED_NO_RETRY");
            applyTestAction(s, a.command, now(), models, evidence);
            log(s, TEST_ACTOR, "crew_test_command", { requestId: a.requestId, action: a.command.action }, now());
          }, a.revision);
          result = { saved: true, revision: a.revision + 1 };
        }
      } else {
        if (!["initialize", "tools/list", "ping"].includes(rpc.method)) throw Error("METHOD_NOT_ALLOWED");
        await authorize();
        result = rpc.method === "tools/list" ? { tools: crewTestTools.map(name => ({
          name, description: "crew-test: серия Hint, без изменения продукта и приёмки.",
          inputSchema: readNames.includes(name) ? { type: "object", properties: {}, additionalProperties: false } :
            { type: "object", additionalProperties: false, required: ["revision", "requestId", "command"],
              properties: { revision: { type: "integer", minimum: 0 }, requestId: { type: "string", format: "uuid" },
                command: { oneOf: [
                  { type: "object", additionalProperties: false, required: ["action", "candidate"],
                    properties: { action: { const: "prepare" }, candidate: { const: "latency" } } },
                  ...["enable", "start", "close_stalled"].map(action => ({ type: "object", additionalProperties: false,
                    required: ["action", "taskId"], properties: { action: { const: action }, taskId: { type: "string", format: "uuid" } } })),
                  { type: "object", additionalProperties: false, required: ["action"], properties: { action: { const: "off" } } },
                ] } } },
          annotations: { readOnlyHint: readNames.includes(name), destructiveHint: false, idempotentHint: false },
        })) } : rpc.method === "initialize" ? { protocolVersion: "2024-11-05",
          capabilities: { tools: {} }, serverInfo: { name: "TalkHint crew-test", version: "1" } } : {};
      }
      res.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "tools/call" ?
        { content: [{ type: "text", text: JSON.stringify(result) }] } : result });
    } catch {
      // No input, credentials, provider/internal error text in response or logs.
      res.status(409).json({ jsonrpc: "2.0", id: rpc.id,
        error: { code: -32000, message: "CREW_TEST_STOP_READ_STATE_NO_RETRY" } });
    }
  });
}
