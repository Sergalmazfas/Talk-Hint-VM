import type { Express } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { adminActionOrigin } from "../adminWeb";
import { pool } from "../db";
import { codeVersion } from "../codeVersion";
import { CrewStore } from "./store";
import { applyOwnerCommand, commandSchema, initialState, log, staleTasks } from "./domain";
import { AnthropicCrewProvider, CrewProviderError } from "./anthropic";
import { CrewRuntime } from "./runtime";
import { crewControlPage } from "./controlPage";
import { readHintEvidence } from "./hintEvidence";
import { HINT_AGENTS, HINT_PRICING_URL } from "./hintPilot";
import { startCrewDispatcher } from "./dispatcher";
import { registerTestMcp } from "./testMcp";
import { bindSecretaryAutomation } from "./secretaryAutomation";
import { secretaryCharacters } from "./secretaryReview";
import { revokeTest } from "./testGrant";
import { startCrewMaintenance } from "./maintenance";
import { productionProductRepository } from "../productCrew/production";
import { TEAM_OWNER } from "../team/plan";
import { auditStructure } from "./structureAudit";
import { commandFailure } from "./commandError";

const environment = () => process.env.NODE_ENV === "production" ? "production" : "development";
export function registerCrewRoutes(app: Express) {
  const store = () => {
    if (!pool) throw Error("DATABASE_UNAVAILABLE");
    return new CrewStore(pool, environment());
  };
  const provider = new AnthropicCrewProvider();
  let runtime: CrewRuntime | null = null;
  const getRuntime = () => runtime ??= new CrewRuntime(store(), provider, environment());
  const company = productionProductRepository(async () => {
    if (environment() !== "production" || !pool) throw Error("PRODUCTION_ONLY");
    return pool;
  });
  const readCompany = () => company.read(TEAM_OWNER, "new-country");
  bindSecretaryAutomation({ store, model: readCompany, environment: environment() });
  registerTestMcp(app, { environment: environment(), store, secret: () => process.env.CREW_TEST_KEY,
    evidence: () => readHintEvidence(pool!, TEAM_OWNER),
    models: async () => (await provider.listModels()).map(m => m.id), model: readCompany });
  const csrf = (req: any) => {
    if (!req.session) throw Error("OWNER_SESSION_REQUIRED");
    return req.session.crewCsrf ??= randomBytes(32).toString("hex");
  };
  const protect = (req: any, res: any, next: any) => {
    // Authenticated Bearer is not ambient browser authority; all cookie actions
    // require the owner session token as well as the existing Origin boundary.
    if (req.get("authorization")?.startsWith("Bearer ")) return next();
    const token = String(req.get("x-crew-csrf") ?? ""), expected = String(req.session?.crewCsrf ?? "");
    if (!expected || !/^[a-f0-9]{64}$/.test(token) || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
      return res.status(403).json({ error: "CREW_CSRF_REQUIRED" });
    next();
  };
  const api = "/api/admin/ai-crew";
  app.use(api, requireBenchmarkAdmin, adminActionOrigin);
  app.get("/admin/ai-crew", requireBenchmarkAdmin, (_req, res) =>
    res.set("Cache-Control", "no-store").type("html").send(crewControlPage));
  const deployment = async () => {
    const build = codeVersion();
    await store().change(s => {
      // Same code can be published twice; a process restart of the same
      // compiled build is not a second publication.
      if (s.journal.some(e => e.kind === "publication_observed" &&
        (e.detail as any)?.sourceHash === build.sourceHash && (e.detail as any)?.builtAt === build.builtAt &&
        (e.detail as any)?.commit === build.commit)) return;
      log(s, `${environment()}-server`, "publication_observed", { ...build, environment: environment(),
        linkStatus: "build_manifest_roadmap_reference" }, new Date().toISOString());
    });
  };
  app.get(api, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const token = csrf(req);
      let state, initialized = true;
      try { state = await store().read(); }
      catch { state = initialState(); initialized = false; }
      res.json({ initialized, environment: environment(), state, stale: staleTasks(state, Date.now()),
        codeVersion: codeVersion(), keyConfigured: !!process.env.ANTHROPIC_API_KEY, csrf: token,
        notice: "Disabled and zero budget by default. Model recommendations in employee profiles are not activation." });
    } catch { res.status(503).json({ error: "CREW_STATUS_UNAVAILABLE" }); }
  });
  app.post(api + "/initialize", protect, async (_req, res) => {
    try {
      await store().initialize();
      await deployment();
      res.json({ initialized: true, agentsStarted: false });
    } catch { res.status(503).json({ error: "CREW_INITIALIZATION_FAILED" }); }
  });
  app.get(api + "/models", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json({ environment: environment(), models: await provider.listModels(), source: "Anthropic GET /v1/models" }); }
    catch { res.status(503).json({ error: "ANTHROPIC_MODELS_UNCONFIRMED" }); }
  });
  app.post(api + "/disable", protect, async (req, res) => {
    try {
      await store().change(s => {
        s.control.enabled = false; s.control.epoch++;
        log(s, String(req.user!.id), "emergency_stop", { epoch: s.control.epoch }, new Date().toISOString());
      });
      runtime?.stopLocal(); res.json({ enabled: false });
    } catch { runtime?.stopLocal(); res.status(503).json({ error: "STOP_NOT_PERSISTED_LOCAL_ABORTED" }); }
  });
  app.post(api + "/crew-test/revoke", protect, async (req, res) => {
    if (!Number.isSafeInteger(req.body?.revision)) return res.status(400).json({ error: "REVISION_REQUIRED" });
    try {
      await store().change(s => revokeTest(s, String(req.user!.id), new Date().toISOString()), req.body.revision);
      runtime?.stopLocal();
      res.json({ saved: true, revision: req.body.revision + 1 });
    } catch { res.status(409).json({ error: "REVOKE_NOT_CONFIRMED_READ_STATE" }); }
  });
  app.get(api + "/structure-check", async (_req, res) => {
    try { res.json(auditStructure(await readCompany(), await store().read(), new Date().toISOString())); }
    catch { res.status(503).json({ error: "STRUCTURE_READ_UNAVAILABLE" }); }
  });
  app.post(api + "/command", protect, async (req, res) => {
    const parsed = commandSchema.safeParse(req.body?.command);
    if (!parsed.success || !Number.isSafeInteger(req.body?.revision)) return res.status(400).json({ error: "INVALID_CREW_COMMAND" });
    let stage: "models" | "characters" | "evidence" | "command" = "models";
    try {
      const models = (["agent", "hint_pilot_prepare"].includes(parsed.data.kind) ||
        parsed.data.kind === "secretary_review_config" && parsed.data.enabled)
        ? (await provider.listModels()).map(m => m.id) : [];
      stage = "characters";
      if (parsed.data.kind === "secretary_review_config" && parsed.data.enabled)
        secretaryCharacters(await readCompany());
      stage = "evidence";
      if (parsed.data.kind === "hint_pilot_prepare" && environment() !== "production") throw Error("PRODUCTION_EVIDENCE_ONLY");
      const evidence = parsed.data.kind === "hint_pilot_prepare" ? await readHintEvidence(pool!, String(req.user!.id)) : undefined;
      stage = "command";
      await store().change(s => applyOwnerCommand(s, parsed.data, String(req.user!.id), new Date().toISOString(), models, evidence), req.body.revision);
      if (parsed.data.kind === "control" && !parsed.data.enabled) runtime?.stopLocal();
      res.json({ saved: true, productChanged: false });
    } catch (error) {
      const failure = commandFailure(error, stage);
      console.warn("[ai-crew] owner_command_failed", { code: failure.error, stage,
        command: parsed.data.kind, expectedRevision: req.body.revision });
      res.status(409).json(failure);
    }
  });
  app.get(api + "/hint-pilot", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (environment() !== "production") return res.status(409).json({ error: "PRODUCTION_EVIDENCE_ONLY" });
    try {
      res.json({ evidence: await readHintEvidence(pool!, String(req.user!.id)), agents: HINT_AGENTS,
        pricingUrl: HINT_PRICING_URL, ratesStatus: "requires_owner_confirmation", agentsStarted: false });
    } catch { res.status(503).json({ error: "HINT_EVIDENCE_UNAVAILABLE" }); }
  });
  app.post(api + "/probe", protect, async (req, res) => {
    if (environment() !== "production") return res.status(409).json({ error: "PRODUCTION_PROBE_ONLY" });
    try {
      const models = await provider.listModels();
      const modelId = req.body?.modelId;
      if (typeof modelId !== "string" || !models.some(m => m.id === modelId)) return res.status(400).json({ error: "MODEL_NOT_IN_RESPONSE" });
      await store().change(s => {
        if (s.probe) throw Error("PROBE_ALREADY_USED");
        s.probe = { modelId, at: new Date().toISOString(), status: "started" };
        log(s, String(req.user!.id), "diagnostic_not_agent", { modelId, maxOutputTokens: 8 }, s.probe.at);
      });
      try {
        const result = await provider.message(modelId, "Reply only OK.", 8, AbortSignal.timeout(15000));
        await store().change(s => {
          log(s, String(req.user!.id), "anthropic_http_response", { stage: "owner_probe",
            modelId, category: "response_received", httpStatus: result.http?.httpStatus ?? null,
            requestId: result.http?.requestId ?? null }, new Date().toISOString());
          s.probe!.status = "done"; s.probe!.usage = result.usage;
          log(s, String(req.user!.id), "diagnostic_complete", { modelRequested: modelId, modelEffective: result.model,
            usage: result.usage, agentsStarted: false }, new Date().toISOString());
        });
        res.json({ success: true, model: result.model, usage: result.usage, environment: "production", agentsStarted: false });
      } catch (e) {
        await store().change(s => {
          log(s, String(req.user!.id), "anthropic_http_response", { stage: "owner_probe", modelId,
            category: e instanceof CrewProviderError ? e.category : "local_error",
            httpStatus: e instanceof CrewProviderError ? e.http.httpStatus : null,
            requestId: e instanceof CrewProviderError ? e.http.requestId : null }, new Date().toISOString());
          s.probe!.status = "unknown";
        });
        res.status(503).json({ error: "PROBE_UNCONFIRMED_NO_RETRY" });
      }
    } catch { res.status(409).json({ error: "PROBE_NOT_STARTED_RELOAD_STATE" }); }
  });
  // Production server owns the dispatcher. No timer in Dev, no provider call
  // until the durable global switch, positive budget and assignments all exist.
  startCrewDispatcher({ environment: environment(), observePublication: deployment,
    tick: () => getRuntime().tick() });
  startCrewMaintenance({ environment: environment(), store, model: readCompany, stopLocal: () => runtime?.stopLocal() });
}
