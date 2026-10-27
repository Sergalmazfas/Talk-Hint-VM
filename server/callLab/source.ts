let registeredOwner: string | undefined;
export function registerLabSourceOwner(id: string) { registeredOwner = id; }
export function hintSourceMarker(userId: string | undefined) {
  const env = process.env.NODE_ENV === "production" ? "production" : "development";
  if (!userId || userId !== registeredOwner || process.env.LAB_ENABLED !== "true" ||
      process.env.LAB_TARGET_ENVIRONMENT !== env) return null;
  return { mode: "hint", environment: env, closedAt: new Date().toISOString() };
}

export function authorizedHintSource(call: any, control: any, environment: string) {
  const marker = call.metadata?.labHintSource;
  if (!control.enabled || call.user_id !== control.owner_id || environment !== control.environment ||
      marker?.mode !== "hint" || marker?.environment !== environment ||
      !marker.closedAt || Date.parse(call.started_at) < Date.parse(control.activated_at) ||
      call.metadata?.diagnosticAudioBlocked === true) return null;
  const transcript = typeof call.transcript === "string" ? call.transcript : "";
  if (!transcript.trim() || !call.ended_at) return null;
  const latency = call.metadata?.hintLatency;
  const entries = Array.isArray(latency?.entries) ? latency.entries : [];
  return {
    call_id: call.call_sid, mode: "hint", environment, synthetic: false,
    owner_verified: true, processing_authorized: true,
    source_basis: "Владелец разрешил внутренний разбор уже сохранённого текста/телеметрии; новых аудиозаписей нет",
    ended_at: new Date(call.ended_at).toISOString(),
    duration_ms: Date.parse(call.ended_at) - Date.parse(call.started_at),
    languages: [], goal: call.metadata?.goalText ?? null, transcript,
    hints: entries.map((e: any, i: number) => ({
      id: String(e.utteranceId ?? `recorded-hint-${i}`), text: e.text,
      outcome: e.outcome, delivered_at: e.deliveredAt ?? null, sent_at: e.sentAt ?? null,
      drop_reason: e.dropReason ?? null,
    })),
    // The persisted recorder is capped and text is bounded; never invent complete history.
    full_hint_history: false, reference_verified: false,
    latency_summary: latency?.summary ?? null,
    limitations: ["Сохранённый текст не является проверенным STT reference; WER неизвестен",
      "Показатель speech-match не равен полезности владельцу",
      "До подсказки считается от STT final, не от физического конца речи; измерения с iPhone не подтверждены",
      "Журнал подсказок и их тексты могут быть усечены; пропуски и полное покрытие неизвестны",
      "Языки/тарифы/полный usage не подтверждены; новые записи аудио, replay и звонки не выполнялись"],
  };
}
