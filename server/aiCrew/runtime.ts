import { randomUUID } from "node:crypto";
import { CREW_SYSTEM, CrewProviderError, type CrewProvider, type CrewHttp } from "./anthropic";
import { log, type Agent, type CrewState } from "./domain";
import type { StateStore } from "./store";
import { finishPilotRun, hintMaxOutput, pilotInput } from "./hintPilot";
import { crewDiagnostic } from "./dispatcher";
import { enforceTestSafety, validGrant, unknownTestRun, stopTest, TEST_ACTOR } from "./testGrant";
import { isSupersededChargedUnknown } from "./failedPilot";
import { finishSecretaryRun, secretaryInput, secretaryReserve, secretarySettle } from "./secretaryReview";
import { secretaryOutputSchema } from "./secretaryOutput";

export class CrewRuntime {
  private active = new Map<string, AbortController>();
  private ticking = false;
  constructor(private store: StateStore, private provider: CrewProvider,
    private environment: string, private now = () => new Date()) {}
  stopLocal() { for (const c of Array.from(this.active.values())) c.abort(); }
  async tick() {
    if (this.ticking || this.environment !== "production") return;
    this.ticking = true;
    try {
      const initial = await this.store.read();
      if (!initial.control.enabled || initial.control.dailyLimitMicroUsd === 0) return;
      // Owner-created assignments only. No employee discovery or automatic activation.
      const claimed = await this.store.change(s => {
        const now = this.now(), at = now.toISOString();
        enforceTestSafety(s, at);
        if (!s.control.enabled || !s.control.dailyLimitMicroUsd) return null;
        for (const schedule of s.schedules) {
          if (s.control.testSeriesId) continue;
          const task = s.tasks.find(t => t.id === schedule.taskId);
          if (task?.phase !== "analysis" || task.closed || Date.parse(schedule.nextAt) > +now) continue;
          const eventId = `schedule:${schedule.agentId}:${schedule.taskId}:${schedule.nextAt}`;
          if (!s.runs.some(r => r.eventId === eventId))
            s.runs.push({ id: randomUUID(), taskId: task.id, agentId: schedule.agentId, eventId, at, status: "queued" });
          schedule.nextAt = new Date(+now + schedule.everyMinutes * 60000).toISOString();
        }
        const run = s.runs.find(r => r.status === "queued" &&
          (!s.tasks.find(t => t.id === r.taskId)?.secretaryReview || s.secretarySettings?.enabled) &&
          (!s.control.testSeriesId ||
          s.tasks.find(t => t.id === r.taskId)?.testSeriesId === s.control.testSeriesId));
        if (!run) return null;
        const task = s.tasks.find(t => t.id === run.taskId), agent = s.agents.find(a => a.agentId === run.agentId);
        if (!task || task.closed || task.phase !== "analysis" || !agent) return null;
        const series = task.testSeriesId;
        if (series && (!validGrant(s, +now) || s.testGrant?.id !== series ||
            s.control.testSeriesId !== series || s.runs.some(r => r.testSeriesId === series &&
              r.status === "unknown" && !isSupersededChargedUnknown(s, r))))
          return null;
        let secretaryPrepared: string | undefined;
        if (task.secretaryReview) {
          try { secretaryPrepared = secretaryInput(s, task, agent.agentId, agent.modelId); }
          catch {
            task.secretaryReview.status = "blocked"; task.secretaryReview.error = "SECRETARY_PRECHECK_FAILED";
            run.status = "discarded"; run.cost = 0; run.completedAt = at;
            log(s, agent.agentId, "secretary_precheck_failed", { taskId: task.id, runId: run.id }, at);
            return null;
          }
        }
        const input = secretaryPrepared ?? (task.hintPilot ? pilotInput(s, task, agent.agentId, agent.modelId) : JSON.stringify({ title: task.title, problem: task.steps[0].note,
          analysis: task.steps.filter(x => x.phase === "analysis").at(-1)?.note }));
        if (Buffer.byteLength(input, "utf8") > (task.secretaryReview ? 128000 : task.hintPilot ? 48000 : 16000)) {
          if (!task.secretaryReview) throw Error("TASK_TOO_LARGE");
          task.secretaryReview.status = "blocked"; task.secretaryReview.error = "SECRETARY_INPUT_TOO_LARGE";
          run.status = "discarded"; run.cost = 0; run.completedAt = at;
          log(s, agent.agentId, "secretary_input_too_large", { taskId: task.id, runId: run.id }, at);
          return null;
        }
        const canComplete = !!task.secretaryReview && agent.agentId === "secretary-lab-engineer";
        const maxTokens = canComplete ? 6000 : agent.agentId === "secretary-qa" ? 4000 : hintMaxOutput(agent.agentId);
        const schema = task.secretaryReview ? secretaryOutputSchema(task.secretaryReview.status) : undefined;
        // No tools, images or caching. Thinking (required by Opus 5.5) and
        // visible text share maxTokens and the same billed output rate.
        // Conservative UTF-8 byte bound + framing; owner-frozen rates.
        const requestBound = Buffer.byteLength(input + CREW_SYSTEM, "utf8") +
          (schema ? Buffer.byteLength(JSON.stringify(schema), "utf8") : 0) + 4096;
        // Reserve BOTH known requests before the first: completion adds at most
        // 64k bytes of serialized partial + 4096 framing, never an unbounded retry.
        const reserve = (requestBound * (canComplete ? 2 : 1) + (canComplete ? 64000 + 4096 : 0)) *
          agent.inputMicroUsdPerToken + maxTokens * (canComplete ? 3 : 1) * agent.outputMicroUsdPerToken;
        if (!Number.isSafeInteger(reserve) || reserve <= 0) throw Error("UNPRICED_AGENT");
        const day = at.slice(0, 10), b = s.budget[day] ??= { spent: 0, reserved: 0 };
        if (series && s.testGrant!.spent + s.testGrant!.reserved + reserve > s.testGrant!.limit) {
          stopTest(s, at, "series_budget_exhausted"); return null;
        }
        if (b.spent + b.reserved + reserve > s.control.dailyLimitMicroUsd) {
          if (task.secretaryReview) {
            task.secretaryReview.status = "blocked"; task.secretaryReview.error = "GLOBAL_DAILY_BUDGET";
            run.status = "discarded"; run.cost = 0; run.completedAt = at;
          }
          crewDiagnostic("run_budget_blocked", { reserveMicroUsd: reserve,
            limitMicroUsd: s.control.dailyLimitMicroUsd, spentMicroUsd: b.spent, reservedMicroUsd: b.reserved });
          return null;
        }
        const secretaryMonth = task.secretaryReview ? at.slice(0, 7) : undefined;
        if (secretaryMonth && !secretaryReserve(s, reserve, secretaryMonth)) {
          task.secretaryReview!.status = "blocked"; task.secretaryReview!.error = "DEPARTMENT_MONTHLY_BUDGET";
          run.status = "discarded"; run.cost = 0; run.completedAt = at;
          log(s, agent.agentId, "secretary_budget_blocked", { taskId: task.id, month: secretaryMonth }, at);
          return null;
        }
        b.reserved += reserve;
        if (series) s.testGrant!.reserved += reserve;
        Object.assign(run, { status: "running", day, epoch: s.control.epoch, reserved: reserve,
          ...(secretaryMonth ? { secretaryMonth, startedAt: at } : {}),
          modelId: agent.modelId, ...(series ? { testSeriesId: series, startedAt: at } : {}) });
        log(s, series ? TEST_ACTOR : agent.agentId, "run_reserved", { runId: run.id, taskId: run.taskId,
          agentId: agent.agentId, day, reserve, modelId: agent.modelId, maxOutputTokens: maxTokens }, at);
        if (task.secretaryReview) task.secretaryReview.outputVersion = 2;
        return { run: structuredClone(run), agent: { ...agent }, input, maxTokens, schema, canComplete };
      });
      if (!claimed) return;
      const controller = new AbortController();
      this.active.set(claimed.run.id, controller);
      let monitorBusy = false;
      const timer = setTimeout(() => controller.abort(), 120000);
      const monitor = setInterval(async () => {
        if (monitorBusy) return;
        monitorBusy = true;
        try {
          const s = await this.store.read();
          if (!s.control.enabled || s.control.epoch !== claimed.run.epoch ||
              (claimed.run.secretaryMonth && !s.secretarySettings?.enabled) ||
              (claimed.run.testSeriesId && !validGrant(s, +this.now()))) controller.abort();
        } catch { controller.abort(); }
        finally { monitorBusy = false; }
      }, 1000);
      let stage = "preflight", responseLogged = false, observedHttp: CrewHttp | undefined;
      const recordResponse = async (http: CrewHttp, category: string) => {
        await this.store.change(s => {
          log(s, claimed.run.testSeriesId ? TEST_ACTOR : claimed.agent.agentId, "anthropic_http_response",
            { runId: claimed.run.id, taskId: claimed.run.taskId, modelId: claimed.agent.modelId,
              stage, category, httpStatus: http.httpStatus, requestId: http.requestId }, this.now().toISOString());
        });
        responseLogged = true;
      };
      try {
        const gate = await this.store.read();
        if (!gate.control.enabled || gate.control.epoch !== claimed.run.epoch ||
            (claimed.run.secretaryMonth && !gate.secretarySettings?.enabled) ||
            (claimed.run.testSeriesId && !validGrant(gate, +this.now()))) throw Error("STOPPED");
        stage = "provider";
        let result = await this.provider.message(claimed.agent.modelId, claimed.input, claimed.maxTokens, controller.signal,
          claimed.schema ? { schema: claimed.schema } : undefined);
        observedHttp = result.http;
        if (observedHttp) await recordResponse(observedHttp, "response_received");
        if (claimed.canComplete && result.stopReason === "max_tokens" && result.model === claimed.agent.modelId &&
            Buffer.byteLength(JSON.stringify({ partial: result.text }), "utf8") <= 63000) {
          const fresh = await this.store.read();
          if (!fresh.control.enabled || fresh.control.epoch !== claimed.run.epoch ||
              !fresh.secretarySettings?.enabled || controller.signal.aborted ||
              fresh.runs.find(r => r.id === claimed.run.id)?.status !== "running") throw Error("STOPPED");
          await this.store.change(s => log(s, claimed.agent.agentId, "secretary_output_completion_requested",
            { runId: claimed.run.id, attempt: 2, reason: "max_tokens", firstUsage: result.usage }, this.now().toISOString()));
          stage = "completion";
          const completed = await this.provider.message(claimed.agent.modelId, claimed.input, claimed.maxTokens * 2,
            controller.signal, { schema: claimed.schema!, partial: result.text }).catch(async error => {
              // The first request was already paid. Even an explicit 4xx on
              // completion must not refund the whole run as a zero-cost reject.
              const http = error instanceof CrewProviderError ?
                error.http : { httpStatus: null, requestId: null };
              observedHttp = http;
              await recordResponse(http, "completion_unconfirmed");
              throw new CrewProviderError("completion_unconfirmed", http);
            });
          observedHttp = completed.http;
          if (observedHttp) await recordResponse(observedHttp, "completion_response_received");
          result = { ...completed, usage: {
            input_tokens: result.usage.input_tokens + completed.usage.input_tokens,
            output_tokens: result.usage.output_tokens + completed.usage.output_tokens,
          } };
        }
        stage = "settlement";
        await this.store.change(s => {
          const run = s.runs.find(r => r.id === claimed.run.id)!;
          // A watchdog or previous unknown outcome is final. No late refund,
          // result adoption or second settlement after an ambiguous request.
          if (run.status !== "running") return;
          const budget = s.budget[run.day!]!;
          const cost = result.usage.input_tokens * claimed.agent.inputMicroUsdPerToken +
            result.usage.output_tokens * claimed.agent.outputMicroUsdPerToken;
          if (!Number.isSafeInteger(cost) || cost < 0) throw Error("UNVERIFIED_USAGE");
          budget.reserved -= run.reserved!; budget.spent += cost;
          if (run.secretaryMonth) secretarySettle(s, run.secretaryMonth, run.reserved!, cost);
          if (run.testSeriesId) {
            s.testGrant!.reserved -= run.reserved!; s.testGrant!.spent += cost;
          }
          run.usage = result.usage; run.cost = cost; run.completedAt = this.now().toISOString();
          const currentTask = s.tasks.find(t => t.id === run.taskId);
          const canSave = s.control.enabled && s.control.epoch === run.epoch && !controller.signal.aborted &&
            (!run.secretaryMonth || s.secretarySettings?.enabled) &&
            (!run.testSeriesId || validGrant(s, +this.now())) &&
            currentTask?.phase === "analysis" && !currentTask.closed;
          run.status = canSave ? "done" : "discarded";
          if (run.testSeriesId && !validGrant(s, +this.now())) stopTest(s, run.completedAt, "grant_ended_during_request");
          if (cost > run.reserved!) { s.control.enabled = false; s.control.epoch++; run.status = "discarded"; }
          if (run.status === "done") {
            const doc = { id: randomUUID(), taskId: run.taskId, runId: run.id, agentId: run.agentId,
              at: run.completedAt, text: run.secretaryMonth ? result.text : result.text.slice(0, 16000), status: "proposed" as const };
            s.documents.push(doc);
            const task = s.tasks.find(t => t.id === run.taskId);
            if (task && !task.closed && task.phase === "analysis") {
              task.steps.at(-1)!.updatedAt = run.completedAt;
              if (task.secretaryReview) {
                if (result.model !== run.modelId) {
                  run.status = "discarded"; task.secretaryReview.status = "blocked";
                  task.secretaryReview.error = "MODEL_ID_MISMATCH";
                  doc.text = "MODEL_ID_MISMATCH: результат не подтверждён";
                } else {
                  if (result.stopReason === "max_tokens" || result.stopReason === "refusal")
                    task.secretaryReview.error = result.stopReason === "max_tokens" ?
                      "OUTPUT_TRUNCATED_UNVERIFIED" : "PROVIDER_REFUSAL_UNVERIFIED";
                  finishSecretaryRun(s, task, doc.id,
                    ["max_tokens", "refusal"].includes(result.stopReason ?? "") ? "null" : doc.text, run.completedAt);
                }
                log(s, run.agentId, "secretary_review_handoff", { taskId: task.id,
                  documentId: doc.id, status: task.secretaryReview.status, ownerAcceptance: false }, run.completedAt);
              } else if (task.hintPilot) {
                // Exact requested model identity is required for pilot evidence.
                if (result.model !== run.modelId) {
                  run.status = "discarded";
                  doc.text = "MODEL_ID_MISMATCH: результат не принят в пилот";
                } else {
                  finishPilotRun(s, task, doc.id, doc.text, run.completedAt);
                  log(s, run.testSeriesId ? TEST_ACTOR : run.agentId, "hint_pilot_handoff", { taskId: task.id, documentId: doc.id,
                    agentId: run.agentId,
                    status: task.hintPilot.status, verdict: task.hintPilot.verdict ?? null,
                    ownerAcceptance: false }, run.completedAt);
                  if (task.hintPilot.status === "owner") {
                    // Same transaction as Foma's result: no enabled window
                    // after a completed chain. Preserve the owner's limit.
                    s.control.enabled = false; s.control.epoch++;
                    log(s, run.testSeriesId ? TEST_ACTOR : "production-server", "hint_pilot_auto_off", { taskId: task.id,
                      dailyLimitMicroUsd: s.control.dailyLimitMicroUsd, epoch: s.control.epoch,
                      reason: "chain_complete_owner_review_required" }, run.completedAt);
                  }
                }
              }
            }
          }
          log(s, run.testSeriesId ? TEST_ACTOR : run.agentId, "run_settled", { runId: run.id, taskId: run.taskId,
            agentId: run.agentId, day: run.day, cost, usage: run.usage,
            modelRequested: run.modelId, modelEffective: result.model, status: run.status,
            accounting: "usage × owner-frozen rates; not provider invoice" }, run.completedAt);
        });
      } catch (e) {
        const category = e instanceof CrewProviderError ? e.category : "local_error";
        const http = e instanceof CrewProviderError ? e.http : observedHttp ?? { httpStatus: null, requestId: null };
        if (!responseLogged) await recordResponse(http, category);
        // Ambiguous network/abort/crash: keep the whole reservation. Never
        // retry a paid generation or falsely account it as zero.
        await this.store.change(s => {
          const r = s.runs.find(r => r.id === claimed.run.id)!;
          unknownTestRun(s, r.id, this.now().toISOString());
          log(s, r.testSeriesId ? TEST_ACTOR : r.agentId, "run_unknown", { runId: r.id, taskId: r.taskId,
            agentId: r.agentId, reservationRetained: true, stage, category,
            httpStatus: http.httpStatus, requestId: http.requestId }, this.now().toISOString());
        });
      } finally {
        clearInterval(monitor); clearTimeout(timer); this.active.delete(claimed.run.id);
      }
    } finally { this.ticking = false; }
  }
}
