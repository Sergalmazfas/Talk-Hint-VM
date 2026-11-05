import { randomUUID } from "node:crypto";
import type { RehearsalScene, RehearsalResult } from "../../shared/rehearsal";
import { RetellSecretaryLab, type RetellLabProfile, type RetellReport } from "../secretaryLab/retell";
import { RetellEngineApi, retellEngineRegistry, engineCallbackBase } from "../secretaryLab/retellEngine";
import { speedEngine, speedSeriesBudget } from "../secretaryLab/speedRuntime";
import { speedSettlement, timedRehearsalSettlement } from "../secretaryLab/speedRequestBudget";
import { rehearsalBindings } from "../secretaryLab/rehearsalBinding";
import { defaultRehearsalScenes, rehearsalCodeHash, rehearsalInstruction, rehearsalVersions, sceneFromInput, sceneFromText, type FrozenVersion } from "./catalog";
import { RehearsalStore, requireRehearsalDev, type SavedRehearsal } from "./store";
import { RehearsalAudio } from "./audio";
import { reviewRehearsal } from "./review";
import { availablePersonalityVersion, listPersonalities } from "../secretary/personalities/store";
function failure(message: string, status = 409): never { throw Object.assign(Error(message), { status }); }
export class RehearsalRuntime {
  private active = new Map<string, { owner: string; row: SavedRehearsal; lab: RetellSecretaryLab; api: RetellEngineApi }>();
  private creating = new Set<string>();
  private reviews = new Map<string, Promise<void>>();
  private audioLocks = new Map<string, Promise<void>>();
  private finalizing = new Set<string>();
  private settlements = new Map<string, Promise<void>>();
  constructor(private store = new RehearsalStore(), private audio = new RehearsalAudio(),
    private budget = speedSeriesBudget) {}
  private settle(id: string, debit: number | null): Promise<void> {
    let pending = this.settlements.get(id);
    if (!pending) {
      pending = this.budget.settle(id, debit);
      this.settlements.set(id, pending);
    }
    return pending!;
  }
  async snapshot(owner: string) {
    requireRehearsalDev();
    const saved = await this.store.list(owner), b = await this.budget.state(), settings = await this.store.settings(owner);
    let reason: string | undefined;
    try { await this.audio.ready(); if (!process.env.RETELL_API_KEY || !process.env.OPENAI_API_KEY ||
      !process.env.ANTHROPIC_API_KEY) throw Error("REHEARSAL_PROVIDER_NOT_CONFIGURED"); }
    catch { reason = "Для репетиции нужны закрытый App Storage и Retell/OpenAI/Anthropic в Secrets. Платный запуск заблокирован."; }
    return { ready: !reason, reason, settings, versions: rehearsalVersions(), scenes: [...defaultRehearsalScenes(), ...saved.scenes],
      history: saved.history, budget: { enforcement: "duration", durationSeconds: 180,
        unknownCostRuns: b.unknownCostRuns ?? 0, limitUsd: b.limitMicroUsd / 1e6, spentUsd: b.spentMicroUsd / 1e6,
        reservedUsd: b.reservedMicroUsd / 1e6, remainingUsd: b.remainingMicroUsd / 1e6 } };
  }
  async saveScene(owner: string, input: unknown) {
    requireRehearsalDev();
    const scene = input && typeof input === "object" && "text" in input
      ? sceneFromText(randomUUID(), input) : sceneFromInput(randomUUID(), input);
    await this.store.save(owner, { ...scene, kind: "rehearsal-scene" }); return { scene };
  }
  async saveSettings(owner: string, input: any) {
    requireRehearsalDev();
    if (!input || Object.keys(input).length !== 1 || typeof input.recordingConsent !== "boolean")
      failure("INVALID_REHEARSAL_SETTINGS", 400);
    return { settings: await this.store.saveSettings(owner, input.recordingConsent) };
  }
  private async lab(owner: string, scene: RehearsalScene, version: FrozenVersion) {
    const catalog = await listPersonalities("Катя", undefined, 100);
    const candidates = catalog.items.filter(p => p.name === "Катя" && p.currentVersion === 2);
    if (candidates.length !== 1) failure("REHEARSAL_KATYA_V2_NOT_UNIQUE");
    const selection = { id: candidates[0].id, version: 2, mode: "work" as const };
    const personality = await availablePersonalityVersion(selection.id, 2, "work");
    const api = new RetellEngineApi(engineCallbackBase, undefined, version.speed, version.hash.slice(0, 20));
    const profile: RetellLabProfile = {
      agentName: `TalkHint Rehearsal DEV · ${version.hash.slice(0, 20)}`, mode: "rehearsal",
      durationMs: 180_000,
      waitingAudio: (id, active, speaking) => retellEngineRegistry.waitingAudio(id, active, speaking),
      waitingPlaybackEnded: id => retellEngineRegistry.waitingPlaybackEnded(id),
      check: async () => ({ mode: "rehearsal" }),
      reserve: (who, instruction, id) => {
        rehearsalBindings.set(id, { waiting: version.waiting, buffered: version.speed === "C", manners: version.manners,
          create: (w, text) => speedEngine(w, text, version.speed, personality, {
            productionRules: version.productionRules, waiting: version.waiting, manners: version.manners, noLoop: version.noLoop, timed: true,
          }) });
        return retellEngineRegistry.reserve(who, instruction, id);
      },
      registered: (id, callId) => retellEngineRegistry.registered(id, callId),
      ended: id => {
        retellEngineRegistry.ended(id);
        // Deferred until Retell has committed terminal state. No paid retry or generation.
        setTimeout(() => { void this.finalize(owner, id).catch(() => {}); }, 0).unref();
      },
    };
    return { lab: new RetellSecretaryLab(api, Date.now, () => process.env.NODE_ENV === "development", profile), api, selection };
  }
  async create(owner: string, input: any) {
    requireRehearsalDev();
    if (!input || Object.keys(input).some(k => !["sceneId", "versionId", "sceneHash", "versionHash", "clientRequestId", "consent", "recordingConsent"].includes(k)) ||
      input.consent !== true || input.recordingConsent !== true || !/^[a-f0-9-]{36}$/i.test(input.clientRequestId ?? ""))
      failure("REHEARSAL_CONFIRMATION_REQUIRED", 400);
    if (this.creating.has(owner)) failure("REHEARSAL_START_IN_PROGRESS");
    this.creating.add(owner);
    try {
      const snapshot = await this.snapshot(owner);
      if (!snapshot.ready) failure("REHEARSAL_NOT_READY");
      if (!snapshot.settings.recordingConsent) failure("REHEARSAL_RECORDING_CONSENT_REQUIRED", 403);
      const scene = snapshot.scenes.find(s => s.id === input.sceneId);
      const version = rehearsalVersions().find(v => v.id === input.versionId);
      if (!scene || !version?.available) failure("REHEARSAL_SELECTION_CHANGED", 400);
      if (input.sceneHash !== scene.hash || input.versionHash !== version.hash) failure("REHEARSAL_SNAPSHOT_CHANGED_RELOAD");
      const { lab, api, selection } = await this.lab(owner, scene, version);
      await this.budget.reserveTimed(input.clientRequestId, version.speed, "voice");
      let admitted = false;
      try {
        const created = await lab.create(owner, { instruction: rehearsalInstruction(scene), consent: true,
          clientRequestId: input.clientRequestId, personality: selection });
        admitted = true;
        const report = { ...created.report, rehearsal: { scene: structuredClone(scene), version: structuredClone(version),
          review: { status: "not_started" }, audio: { status: "pending" }, recordingConsent: true,
          codeVersion: "dev-source-sha256:" + rehearsalCodeHash() } } as RehearsalResult;
        const row: SavedRehearsal = { id: created.id, kind: "rehearsal", requestId: input.clientRequestId, report };
        this.active.set(row.id, { owner, row, lab, api });
        await this.store.save(owner, row); // no ticket/token ever saved
        return { ...created, report };
      } catch (e) {
        // Unclear provider admission is NOT retried. Conservatively retain entire debit.
        const reports = lab.reports(owner);
        const unknown = admitted || reports.some(r => r.reason === "create_result_unknown" || r.status === "stop_failed");
        if (admitted) {
          const created = Array.from(this.active.values()).find(r => r.owner === owner && r.row.requestId === input.clientRequestId);
          if (created) await created.lab.stop(owner, created.row.id).catch(() => {});
        }
        await this.settle(input.clientRequestId, unknown ? null : 0); throw e;
      }
    } finally { this.creating.delete(owner); }
  }
  private live(owner: string, id: string) {
    const live = this.active.get(id);
    if (!live || live.owner !== owner) failure("REHEARSAL_NOT_ACTIVE", 404);
    return live;
  }
  async get(owner: string, id: string): Promise<{ report: import("../../shared/rehearsal").RehearsalResult }> {
    requireRehearsalDev();
    const live = this.active.get(id);
    if (live && live.owner === owner) {
      let fresh: RetellReport;
      try { fresh = live.lab.report(owner, id).report; }
      catch (e: any) {
        if (e?.status !== 404) throw e;
        this.active.delete(id); return this.get(owner, id);
      }
      live.row.report = { ...fresh, rehearsal: live.row.report.rehearsal } as RehearsalResult;
      if (fresh.status === "ended") {
        const metrics = (fresh.engine as any)?.speed;
        const seconds = fresh.providerDurationSeconds ?? Math.max(0, (Date.parse(fresh.endedAt!) - Date.parse(fresh.createdAt)) / 1000 + 5);
        await this.settle(live.row.requestId, metrics?.requestBudget?.policy === "time-only"
          ? timedRehearsalSettlement(metrics, seconds) : metrics?.requestBudget ? speedSettlement(metrics, seconds) : null);
      }
      await this.store.save(owner, live.row);
      return { report: live.row.report };
    }
    const row = await this.store.get(owner, id);
    if (["connecting", "live", "stop_failed"].includes(row.report.status))
      row.report.reason = "SERVER_RESTART_RECONCILIATION_REQUIRED_NO_RETRY";
    if (row.report.rehearsal.review.status === "running" && !this.reviews.has(id)) {
      row.report.rehearsal.review.status = "unknown";
      row.report.rehearsal.review.error = "REVIEW_INTERRUPTED_NO_RETRY";
      if (row.reviewRequestId) await this.settle(row.reviewRequestId, null);
      await this.store.save(owner, row);
    }
    return { report: row.report };
  }
  async connected(owner: string, id: string) {
    await this.live(owner, id).lab.connected(owner, id); return this.get(owner, id);
  }
  private async finalize(owner: string, id: string) {
    if (this.finalizing.has(id)) return;
    this.finalizing.add(id);
    try {
      const current = await this.get(owner, id);
      if (current.report.status !== "ended") return;
      // The user authorized review after a rehearsal. This does not activate AI Crew.
      await Promise.allSettled([this.captureAudio(owner, id), this.analyse(owner, id)]);
    } finally { this.finalizing.delete(id); }
  }
  waiting(owner: string, id: string, body: unknown) { requireRehearsalDev(); return this.live(owner, id).lab.waitingAudio(owner, id, body); }
  async stop(owner: string, id: string) {
    requireRehearsalDev(); const live = this.active.get(id);
    if (live?.owner === owner) { await live.lab.stop(owner, id); return this.get(owner, id); }
    // Persisted call identity survives browser/server restart; no phone lookup or dial.
    const row = await this.store.get(owner, id);
    if (row.report.status !== "ended") {
      const api = new RetellEngineApi(); const callId = (row.report as any).callId;
      const call = await api.request(`/v2/get-call/${encodeURIComponent(callId)}`);
      if (call.call_id !== callId || call.call_type !== "web_call") failure("REHEARSAL_IDENTITY_CHANGED");
      if (!["ended", "error", "not_connected"].includes(call.call_status))
        await api.request(`/v2/stop-call/${encodeURIComponent(callId)}`, undefined, "POST");
      const final = await api.request(`/v2/get-call/${encodeURIComponent(callId)}`);
      if (!["ended", "error", "not_connected"].includes(final.call_status)) failure("REHEARSAL_STOP_UNKNOWN_NO_RETRY");
      row.report.status = "ended"; row.report.endedAt = new Date().toISOString();
      row.report.reason = "owner_stop_after_server_restart";
      await this.settle(row.requestId, null); await this.store.save(owner, row);
    }
    return { report: row.report };
  }
  async captureAudio(owner: string, id: string) {
    requireRehearsalDev();
    if (!this.audioLocks.has(id)) {
      const operation = (async () => {
        await this.get(owner, id);
        const row = this.active.get(id)?.owner === owner ? this.active.get(id)!.row : await this.store.get(owner, id);
        try {
          for (let attempt = 0; attempt < 6; attempt++) {
            await this.audio.capture(owner, row, this.active.get(id)?.api ?? new RetellEngineApi());
            if (row.report.rehearsal.audio.status !== "pending" || attempt === 5) break;
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        catch {
          row.report.rehearsal.audio = { status: "failed", reason: "Запись ещё не архивирована: нужна проверка источника/хранилища." };
        }
        await this.store.save(owner, row);
      })().finally(() => this.audioLocks.delete(id));
      this.audioLocks.set(id, operation);
    }
    await this.audioLocks.get(id); return this.get(owner, id);
  }
  async readAudio(owner: string, id: string) { requireRehearsalDev(); return this.audio.read(await this.store.get(owner, id)); }
  async analyse(owner: string, id: string) {
    requireRehearsalDev(); await this.get(owner, id);
    const row = this.active.get(id)?.owner === owner ? this.active.get(id)!.row : await this.store.get(owner, id);
    if (row.report.rehearsal.review.status !== "not_started") return { report: row.report };
    if (row.report.status !== "ended" || !row.report.turns.length) failure("REHEARSAL_REVIEW_NEEDS_ENDED_TRANSCRIPT");
    const requestId = randomUUID();
    try { await this.budget.reserveTimed(requestId, "C", "review"); }
    catch {
      row.report.rehearsal.review = { status: "failed", error: "REHEARSAL_REVIEW_BUDGET_UNAVAILABLE_NO_REQUEST_SENT" };
      await this.store.save(owner, row);
      return { report: row.report };
    }
    row.reviewRequestId = requestId; row.report.rehearsal.review.status = "running";
    const save = () => this.store.save(owner, row);
    try { await save(); } catch {
      row.report.rehearsal.review = { status: "failed", error: "REVIEW_NOT_PERSISTED_NO_REQUEST_SENT" };
      await this.settle(requestId, 0);
      throw Error("REHEARSAL_REVIEW_PERSIST_FAILED");
    }
    const job = (async () => {
      try {
        const debit = await reviewRehearsal(row, save);
        await this.settle(requestId, debit);
      } catch {
        row.report.rehearsal.review.status = "unknown";
        row.report.rehearsal.review.error = "REHEARSAL_REVIEW_UNCONFIRMED_NO_RETRY";
        await this.settle(requestId, null);
      } finally { await save(); }
    })().finally(() => this.reviews.delete(id));
    this.reviews.set(id, job);
    return { report: row.report };
  }
}
