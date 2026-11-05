import OpenAI from "openai";
import { RetellSecretaryLab, type RetellLabProfile, type RetellReport } from "./retell";
import { SecretaryConversationEngine, secretaryTestTools, type EngineStream } from "../secretary/conversationEngine";
import { confirmedSecretaryOwnerName } from "../secretary/ownerIdentity";
import type { PersonalityBinding } from "../secretary/personalities/types";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import { compactSpeedPrompt, speedProfiles, speedStream, type SpeedVariant } from "./speedExperiment";
import { SpeedBudget } from "./speedBudget";
import { SpeedLimitError, SpeedRequestBudget, speedLimitText, speedSettlement } from "./speedRequestBudget";
import type { RetellEngineApi, RetellEngineRegistry } from "./retellEngine";
import { devReportArchive } from "./devReportArchive";
import { WAITING_DEV_DURATION_MS, WAITING_DEV_SUFFIX, WAITING_DEV_INSTRUCTIONS } from "./waitingPolicy";

export function speedEngine(owner: string, instruction: string, variant: SpeedVariant, personality?: PersonalityBinding) {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw Error("SPEED_DEV_ONLY");
  const profile = speedProfiles[variant];
  const requestBudget = new SpeedRequestBudget(variant === "C" ? 2_000_000 : 1_000_000);
  const metrics = { variant, requests: 0, usageRequests: 0, input: 0, output: 0,
    conservativeModelMicroUsd: 0, requestLog: [] as any[], requestBudget: requestBudget.snapshot(),
    limitReason: null as null | { code: string; message: string } };
  const update = () => { metrics.requestBudget = requestBudget.snapshot(); };
  const limit = (e: unknown) => {
    if (e instanceof SpeedLimitError) metrics.limitReason = { code: e.code, message: speedLimitText(e.code) };
    update();
  };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 25_000 });
  const adapter = { responses: { create: async (body: any, options: any) => {
    if (options?.signal?.aborted) throw options.signal.reason ?? Error("Cancelled before admission");
    // Pin ordinary pricing; never inherit a project's auto/priority tier.
    if (body.service_tier === undefined) body = { ...body, service_tier: "default" };
    let reservation: ReturnType<SpeedRequestBudget["admit"]>;
    try { reservation = requestBudget.admit(body); } catch (e) { limit(e); throw e; }
    metrics.requests++; update(); // Provider attempts, never locally rejected response events.
    const started = performance.now();
    const log: any = { model: body.model, httpStatus: null, requestId: null, firstTextMs: null,
      startedAt: new Date().toISOString(), firstTextAt: null,
      complete: false, outputChars: 0, outputText: "", error: null };
    metrics.requestLog.push(log);
    try {
      const { data, response } = await client.responses.create(body, options).withResponse();
      log.httpStatus = response.status; log.requestId = response.headers.get("x-request-id");
      return (async function* () {
        try { for await (const event of data as any) {
          if (event.type === "response.output_text.delta") {
            log.firstTextMs ??= performance.now() - started; log.outputChars += event.delta.length;
            log.firstTextAt ??= new Date().toISOString();
            log.outputText += event.delta;
          }
          const u = event.response?.usage;
          if (u && ["response.completed", "response.incomplete", "response.failed"].includes(event.type) &&
            requestBudget.complete(reservation, u)) {
            metrics.usageRequests++; metrics.input += u.input_tokens; metrics.output += u.output_tokens;
            // Deliberately upper-bounds ordinary input AND cache writes, not a bill.
            metrics.conservativeModelMicroUsd += Math.ceil(u.input_tokens * 5 + u.output_tokens * 10);
            log.usage = u;
          }
          if (event.type === "response.completed") log.complete = true;
          if (event.type === "response.incomplete") log.error = "OUTPUT_INCOMPLETE";
          yield event;
        } } catch (e) {
          log.error ??= options?.signal?.aborted ? "CANCELLED_USAGE_UNKNOWN" : "STREAM_ERROR";
          limit(e); throw e;
        } finally { requestBudget.unknown(reservation); update(); }
      })();
    } catch (e: any) {
      log.httpStatus = e.status ?? log.httpStatus; log.requestId = e.request_id ?? log.requestId;
      log.error = e.code ?? "PROVIDER_OR_NETWORK_ERROR";
      requestBudget.unknown(reservation); limit(e); throw e;
    }
  } } };
  const rawStream = speedStream(adapter, variant, secretaryTestTools);
  const measured: EngineStream = request => rawStream(request);
  const compact = variant === "A" ? undefined : compactSpeedPrompt({
    owner: confirmedSecretaryOwnerName(owner), personality,
    plan: { instruction, testOnly: true, authorizedTestContext: SECRETARY_TEST_CONTEXT }, runtimeUtc: new Date().toISOString(),
  });
  const engine = new SecretaryConversationEngine(owner, instruction, measured, false, personality, [], undefined,
    compact ? { instructions: compact.instructions + (variant === "C" ? WAITING_DEV_INSTRUCTIONS : ""), model: profile.model } : undefined);
  (engine.report as any).speed = metrics;
  return engine;
}

/** Multiplexing uses the existing authenticated Dev routes and socket registry. */
export function speedLab(deps: {
  registry: RetellEngineRegistry; api: (v: SpeedVariant) => RetellEngineApi; check: () => Promise<object>;
  agentName: string; variantsBySession: Map<string, SpeedVariant>;
  bufferModesBySession?: Map<string, boolean>;
}) {
  const budget = new SpeedBudget();
  const bufferModeByOwner = new Map<string, boolean>();
  const labs = new Map<SpeedVariant, RetellSecretaryLab>();
  for (const variant of ["A", "B", "C"] as const) {
    const profile: RetellLabProfile = {
      agentName: variant === "A" ? deps.agentName :
        `${deps.agentName} · speed ${variant}${variant === "C" ? WAITING_DEV_SUFFIX : ""}`,
      ...(variant === "C" ? { durationMs: WAITING_DEV_DURATION_MS,
        waitingAudio: (id: string, active: boolean, speaking: boolean) => deps.registry.waitingAudio(id, active, speaking),
        waitingPlaybackEnded: (id: string) => deps.registry.waitingPlaybackEnded(id) } : {}),
      mode: "retell-engine", check: deps.check,
      reserve: (owner, instruction, id, personality) => {
        deps.variantsBySession.set(id, variant);
        if (variant === "C") deps.bufferModesBySession?.set(id, bufferModeByOwner.get(owner) ?? true);
        return deps.registry.reserve(owner, instruction, id, personality);
      },
      registered: (id, callId) => deps.registry.registered(id, callId),
      ended: id => deps.registry.ended(id),
    };
    labs.set(variant, new RetellSecretaryLab(deps.api(variant), Date.now,
      () => process.env.NODE_ENV === "development", profile));
  }
  const owners = new Map<string, { lab: RetellSecretaryLab; owner: string; requestId: string }>();
  const savedAt = new Map<string, number>();
  const saves = new Map<string, Promise<void>>();
  const archiveStatus = new Map<string, string>();
  const archiveReport = (owner: string, report: RetellReport, force = false): Promise<void> => {
    if (report.profileId !== "C") return Promise.resolve();
    if (saves.has(report.id)) return force
      ? saves.get(report.id)!.then(() => archiveReport(owner, report, true))
      : saves.get(report.id)!;
    if (!force && Date.now() - (savedAt.get(report.id) ?? 0) < 5000) return Promise.resolve();
    // Snapshot now: the mutable engine continues receiving deltas during SQL I/O.
    const snapshot = JSON.parse(JSON.stringify(report));
    archiveStatus.set(report.id, "pending");
    const pending = devReportArchive().then(a => a.save(owner, snapshot)).then(() => {
      savedAt.set(report.id, Date.now()); archiveStatus.set(report.id, "saved");
    }).catch(() => {
      archiveStatus.set(report.id, "failed");
      console.error("[SecretaryLab] DEV_REPORT_ARCHIVE_WRITE_FAILED");
    }).finally(() => saves.delete(report.id));
    saves.set(report.id, pending); return pending;
  };
  const variantOf = (value: unknown): SpeedVariant => {
    if (value === undefined) return "A";
    if (value !== "A" && value !== "B" && value !== "C") throw Object.assign(Error("SPEED_VARIANT_INVALID"), { status: 400 });
    return value;
  };
  const finish = async (id: string) => {
    const row = owners.get(id); if (!row) return;
    const r = row.lab.report(row.owner, id).report;
    if (r.status !== "ended") return;
    await archiveReport(row.owner, r, true);
    const m = (r.engine as any)?.speed;
    const seconds = r.providerDurationSeconds ?? Math.min(r.profileId === "C" ? WAITING_DEV_DURATION_MS / 1000 : 300,
      (Date.parse(r.endedAt!) - Date.parse(r.createdAt)) / 1000 + 5);
    const debit = m?.requestBudget ? speedSettlement(m, seconds) : m && m.requests <= 12 && m.requests === m.usageRequests
      ? Math.ceil(m.conservativeModelMicroUsd + Math.max(0, seconds) / 60 * 70_000) : null;
    await budget.settle(row.requestId, debit);
  };
  const find = (owner: string, id: string) => {
    const row = owners.get(id);
    if (!row || row.owner !== owner) throw Object.assign(Error("Session not found"), { status: 404 });
    return row.lab;
  };
  const withLimit = (report: RetellReport) => {
    const reason = (report.engine as any)?.speed?.limitReason;
    return reason ? { ...report, labLimit: reason } : report;
  };
  class SpeedLab extends RetellSecretaryLab {
    async readiness(owner: string) {
      for (const id of Array.from(owners.keys())) await finish(id);
      const state = await budget.state();
      const stored = await (await devReportArchive()).list(owner);
      const live = Array.from(labs.values()).flatMap(l => l.reports(owner));
      const history = Array.from(new Map([...stored, ...live].map(r => [r.id, withLimit(r)])).values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return { ...await labs.get("A")!.readiness(owner), history, persistentCReports: true,
        speedVariants: (["A", "B", "C"] as const).map(id => ({ id,
          label: `${id} · ${speedProfiles[id].model} · ${speedProfiles[id].reasoning} · ${speedProfiles[id].maxOutput}` })),
        speedBudget: { limitUsd: state.limitMicroUsd / 1e6, spentUsd: state.spentMicroUsd / 1e6,
          reservedUsd: state.reservedMicroUsd / 1e6, remainingUsd: state.remainingMicroUsd / 1e6,
          blocked: Object.values(state.runs).some(r => r.status === "reserved"),
          accounting: "conservative estimate, not invoice" } };
    }
    async create(owner: string, input: any) {
      const variant = variantOf(input?.speedVariant);
      if (!input || input.consent !== true || typeof input.instruction !== "string" ||
        input.instruction.trim().length < 8 || input.instruction.length > 4000 ||
        !/^[0-9a-f-]{36}$/i.test(input.clientRequestId ?? "") ||
        (input.responseBuffer !== undefined && (variant !== "C" || typeof input.responseBuffer !== "boolean")) ||
        Object.keys(input).some(k => !["instruction", "consent", "clientRequestId", "personality", "speedVariant", "responseBuffer"].includes(k)))
        throw Object.assign(Error("Invalid speed experiment input"), { status: 400 });
      for (const id of Array.from(owners.keys())) await finish(id);
      const lab = labs.get(variant)!;
      const previous = Array.from(owners).find(([, r]) => r.owner === owner && r.requestId === input.clientRequestId);
      const { speedVariant: _, responseBuffer: __, ...body } = input;
      if (previous) {
        if (previous[1].lab !== lab) throw Object.assign(Error("Request variant conflict"), { status: 409 });
        return lab.create(owner, body);
      }
      try { await budget.reserve(input.clientRequestId, variant); }
      catch (e: any) { throw Object.assign(e, { status: 409 }); }
      const priorIds = new Set(lab.reports(owner).map(r => r.id));
      bufferModeByOwner.set(owner, input.responseBuffer !== false);
      try {
        const result = await lab.create(owner, body);
        owners.set(result.id, { lab, owner, requestId: input.clientRequestId });
        return result;
      } catch (e) {
        const failed = lab.reports(owner).find(r => !priorIds.has(r.id));
        await budget.settle(input.clientRequestId,
          failed?.reason === "create_result_unknown" || failed?.status === "stop_failed" ? null : 0);
        throw e;
      } finally {
        bufferModeByOwner.delete(owner);
      }
    }
    report(owner: string, id: string) {
      const result = find(owner, id).report(owner, id);
      void archiveReport(owner, result.report);
      return { ...result, report: { ...withLimit(result.report), archiveStatus: archiveStatus.get(id) } };
    }
    async archivedReport(owner: string, id: string) {
      const report = await (await devReportArchive()).get(owner, id);
      return report ? { report } : undefined;
    }
    reports(owner: string) { return Array.from(labs.values()).flatMap(l => l.reports(owner)).map(withLimit); }
    async connected(owner: string, id: string) { return find(owner, id).connected(owner, id); }
    waitingAudio(owner: string, id: string, input: unknown) { return find(owner, id).waitingAudio(owner, id, input); }
    observe(owner: string, id: string, input: any) { return find(owner, id).observe(owner, id, input); }
    async stop(owner: string, id: string, reason?: string) {
      await find(owner, id).stop(owner, id, reason);
      await finish(id); return this.report(owner, id).report;
    }
    sweep() {
      for (const row of Array.from(owners.values()))
        for (const report of row.lab.reports(row.owner)) void archiveReport(row.owner, report);
      for (const l of Array.from(labs.values())) l.sweep();
    }
  }
  return new SpeedLab();
}
