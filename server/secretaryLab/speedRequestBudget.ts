/** Local envelope inside the existing durable $2 admission. No refill/reset. */
export const SPEED_MODEL_ENVELOPE = 1_000_000;
export const SPEED_VOICE_ENVELOPE = 1_000_000; // 5 minutes at a protective $0.20/min ceiling, NOT a tariff.
export class SpeedLimitError extends Error {
  constructor(public code: string) { super(code); }
}
export const speedLimitMessage = "Тестовая сессия завершена: достигнут безопасный лимит стенда. Это не ошибка модели. Никакие реальные действия не выполнены.";
export function speedLimitText(code: string) {
  if (code === "SPEED_INPUT_BUDGET_BOUND") return "Тест остановлен: объём контекста превышает безопасный лимит стенда. Реальные действия не выполнены.";
  if (code === "SPEED_USAGE_UNVERIFIABLE") return "Тест остановлен: расход не удалось подтвердить. Новые платные запросы не запускаются.";
  if (code === "SPEED_SERVICE_TIER_DENIED") return "Тест остановлен: тариф запроса не разрешён для этого стенда.";
  return speedLimitMessage;
}
type Reservation = { inputBound: number; maxOutput: number; held: number; state: "pending" | "known" | "unknown" };
export class SpeedRequestBudget {
  constructor(private envelope = SPEED_MODEL_ENVELOPE) {
    if (![1_000_000, 2_000_000].includes(envelope)) throw Error("SPEED_ENVELOPE_INVALID");
  }
  private rows: Reservation[] = [];
  private stopped = false;
  private verifiable = true;
  private denied = 0;
  private deny(code: string): never {
    this.stopped = true; this.denied++;
    throw new SpeedLimitError(code);
  }
  snapshot() {
    return { version: 1, modelEnvelopeMicroUsd: this.envelope,
      voiceEnvelopeMicroUsd: SPEED_VOICE_ENVELOPE, admitted: this.rows.length, denied: this.denied,
      totalHeldMicroUsd: this.rows.reduce((n, r) => n + r.held, 0),
      unknown: this.rows.filter(r => r.state === "unknown").length,
      pending: this.rows.filter(r => r.state === "pending").length, verifiable: this.verifiable };
  }
  admit(body: any) {
    if (this.stopped) this.deny("SPEED_SESSION_BUDGET_EXHAUSTED");
    const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    if (bytes > 20_000 || !Number.isSafeInteger(body.max_output_tokens) ||
      body.max_output_tokens < 1 || body.max_output_tokens > 1600)
      this.deny("SPEED_INPUT_BUDGET_BOUND");
    // UTF-8 byte bound + generous protocol framing margin. All input, including
    // cache writes, at $5/M; all output/reasoning at $10/M. Standard tier only.
    if (body.service_tier && body.service_tier !== "default") this.deny("SPEED_SERVICE_TIER_DENIED");
    const inputBound = bytes + 4096;
    const held = inputBound * 5 + body.max_output_tokens * 10;
    if (this.snapshot().totalHeldMicroUsd + held > this.envelope)
      this.deny("SPEED_SESSION_BUDGET_EXHAUSTED");
    const row: Reservation = { inputBound, maxOutput: body.max_output_tokens, held, state: "pending" };
    this.rows.push(row); return row;
  }
  complete(row: Reservation, usage: any) {
    if (!this.rows.includes(row) || row.state !== "pending") return false;
    if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || usage.input_tokens > row.inputBound ||
      !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0 || usage.output_tokens > row.maxOutput) {
      this.verifiable = false; row.state = "unknown";
      this.deny("SPEED_USAGE_UNVERIFIABLE");
    }
    row.held = usage.input_tokens * 5 + usage.output_tokens * 10;
    row.state = "known"; return true;
  }
  unknown(row: Reservation) {
    if (row.state === "pending") row.state = "unknown"; // Never refund missing/cancelled usage.
  }
}
export function speedSettlement(m: any, seconds: number): number | null {
  const b = m?.requestBudget;
  const envelope = m?.variant === "C" ? 2_000_000 : SPEED_MODEL_ENVELOPE;
  if (!b || b.version !== 1 || !b.verifiable || ![SPEED_MODEL_ENVELOPE, envelope].includes(b.modelEnvelopeMicroUsd) ||
    b.voiceEnvelopeMicroUsd !== SPEED_VOICE_ENVELOPE ||
    !Number.isSafeInteger(b.admitted) || b.admitted < 0 || b.admitted !== m.requests ||
    !Number.isSafeInteger(b.totalHeldMicroUsd) || b.totalHeldMicroUsd < 0 ||
    b.totalHeldMicroUsd > b.modelEnvelopeMicroUsd || !Number.isFinite(seconds) || seconds < 0 || seconds > 300)
    return null; // Retain entire admission on crash/corruption/unbounded evidence.
  return Math.ceil(b.totalHeldMicroUsd + seconds / 300 * SPEED_VOICE_ENVELOPE);
}
