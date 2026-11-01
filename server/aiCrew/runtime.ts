import { randomUUID } from "node:crypto";
import { CREW_SYSTEM, type CrewProvider } from "./anthropic";
import { log, type Agent, type CrewState } from "./domain";
import type { StateStore } from "./store";
import { finishPilotRun, HINT_MAX_OUTPUT, pilotInput } from "./hintPilot";

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
        if (!s.control.enabled || !s.control.dailyLimitMicroUsd) return null;
        for (const schedule of s.schedules) {
          const task = s.tasks.find(t => t.id === schedule.taskId);
          if (task?.phase !== "analysis" || task.closed || Date.parse(schedule.nextAt) > +now) continue;
          const eventId = `schedule:${schedule.agentId}:${schedule.taskId}:${schedule.nextAt}`;
          if (!s.runs.some(r => r.eventId === eventId))
            s.runs.push({ id: randomUUID(), taskId: task.id, agentId: schedule.agentId, eventId, at, status: "queued" });
          schedule.nextAt = new Date(+now + schedule.everyMinutes * 60000).toISOString();
        }
        const run = s.runs.find(r => r.status === "queued");
        if (!run) return null;
        const task = s.tasks.find(t => t.id === run.taskId), agent = s.agents.find(a => a.agentId === run.agentId);
        if (!task || task.closed || task.phase !== "analysis" || !agent) return null;
        const input = task.hintPilot ? pilotInput(s, task, agent.agentId, agent.modelId) : JSON.stringify({ title: task.title, problem: task.steps[0].note,
          analysis: task.steps.filter(x => x.phase === "analysis").at(-1)?.note });
        if (Buffer.byteLength(input, "utf8") > (task.hintPilot ? 48000 : 16000)) throw Error("TASK_TOO_LARGE");
        const maxTokens = HINT_MAX_OUTPUT;
        // No tools, images, caching or thinking. Conservative UTF-8 byte bound
        // plus framing margin; rates must be explicitly owner-supplied.
        const reserve = (Buffer.byteLength(input + CREW_SYSTEM, "utf8") + 4096) * agent.inputMicroUsdPerToken +
          maxTokens * agent.outputMicroUsdPerToken;
        if (!Number.isSafeInteger(reserve) || reserve <= 0) throw Error("UNPRICED_AGENT");
        const day = at.slice(0, 10), b = s.budget[day] ??= { spent: 0, reserved: 0 };
        if (b.spent + b.reserved + reserve > s.control.dailyLimitMicroUsd) return null;
        b.reserved += reserve;
        Object.assign(run, { status: "running", day, epoch: s.control.epoch, reserved: reserve, modelId: agent.modelId });
        log(s, agent.agentId, "run_reserved", { runId: run.id, taskId: run.taskId, day, reserve, modelId: agent.modelId }, at);
        return { run: structuredClone(run), agent: { ...agent }, input, maxTokens };
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
          if (!s.control.enabled || s.control.epoch !== claimed.run.epoch) controller.abort();
        } catch { controller.abort(); }
        finally { monitorBusy = false; }
      }, 1000);
      try {
        const gate = await this.store.read();
        if (!gate.control.enabled || gate.control.epoch !== claimed.run.epoch) throw Error("STOPPED");
        const result = await this.provider.message(claimed.agent.modelId, claimed.input, claimed.maxTokens, controller.signal);
        await this.store.change(s => {
          const run = s.runs.find(r => r.id === claimed.run.id)!;
          const budget = s.budget[run.day!]!;
          const cost = result.usage.input_tokens * claimed.agent.inputMicroUsdPerToken +
            result.usage.output_tokens * claimed.agent.outputMicroUsdPerToken;
          if (!Number.isSafeInteger(cost) || cost < 0) throw Error("UNVERIFIED_USAGE");
          budget.reserved -= run.reserved!; budget.spent += cost;
          run.usage = result.usage; run.cost = cost; run.completedAt = this.now().toISOString();
          const currentTask = s.tasks.find(t => t.id === run.taskId);
          const canSave = s.control.enabled && s.control.epoch === run.epoch && !controller.signal.aborted &&
            currentTask?.phase === "analysis" && !currentTask.closed;
          run.status = canSave ? "done" : "discarded";
          if (cost > run.reserved!) { s.control.enabled = false; s.control.epoch++; run.status = "discarded"; }
          if (run.status === "done") {
            const doc = { id: randomUUID(), taskId: run.taskId, runId: run.id, agentId: run.agentId,
              at: run.completedAt, text: result.text.slice(0, 16000), status: "proposed" as const };
            s.documents.push(doc);
            const task = s.tasks.find(t => t.id === run.taskId);
            if (task && !task.closed && task.phase === "analysis") {
              task.steps.at(-1)!.updatedAt = run.completedAt;
              if (task.hintPilot) {
                // Exact requested model identity is required for pilot evidence.
                if (result.model !== run.modelId) {
                  run.status = "discarded";
                  doc.text = "MODEL_ID_MISMATCH: результат не принят в пилот";
                } else {
                  finishPilotRun(s, task, doc.id, doc.text, run.completedAt);
                  log(s, run.agentId, "hint_pilot_handoff", { taskId: task.id, documentId: doc.id,
                    status: task.hintPilot.status, verdict: task.hintPilot.verdict ?? null,
                    ownerAcceptance: false }, run.completedAt);
                  if (task.hintPilot.status === "owner") {
                    // Same transaction as Foma's result: no enabled window
                    // after a completed chain. Preserve the owner's limit.
                    s.control.enabled = false; s.control.epoch++;
                    log(s, "production-server", "hint_pilot_auto_off", { taskId: task.id,
                      dailyLimitMicroUsd: s.control.dailyLimitMicroUsd, epoch: s.control.epoch,
                      reason: "chain_complete_owner_review_required" }, run.completedAt);
                  }
                }
              }
            }
          }
          log(s, run.agentId, "run_settled", { runId: run.id, taskId: run.taskId, day: run.day, cost, usage: run.usage,
            modelRequested: run.modelId, modelEffective: result.model, status: run.status,
            accounting: "usage × owner-frozen rates; not provider invoice" }, run.completedAt);
        });
      } catch {
        // Ambiguous network/abort/crash: keep the whole reservation. Never
        // retry a paid generation or falsely account it as zero.
        await this.store.change(s => {
          const r = s.runs.find(r => r.id === claimed.run.id)!;
          if (r.status === "running") r.status = "unknown";
          log(s, r.agentId, "run_unknown", { runId: r.id, taskId: r.taskId, reservationRetained: true }, this.now().toISOString());
        });
      } finally {
        clearInterval(monitor); clearTimeout(timer); this.active.delete(claimed.run.id);
      }
    } finally { this.ticking = false; }
  }
}
