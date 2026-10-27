/** Arithmetic over the saved snapshot only. ACK, UI claims and human use are distinct. */
export function hintMeasurements(source: any) {
  const entries: any[] | null = Array.isArray(source?.hints) ? source.hints : null;
  const ui: any[] | null = Array.isArray(source?.ui_visibility?.events) ? source.ui_visibility.events : null;
  const ids = (kind: string) => new Set((ui ?? []).filter(e =>
    e.kind === kind && e.utteranceId != null).map(e => String(e.utteranceId)));
  const shown = ids("hint"), translations = ids("translation_ru");
  const translatedShown = Array.from(shown).filter(id => translations.has(id)).length;
  const sent = entries?.filter(e => e.outcome === "sent") ?? [];
  const drops: Record<string, number> = {};
  for (const e of entries ?? []) if (e.outcome === "dropped") {
    const reason = typeof e.drop_reason === "string" && /^[a-z_]{1,48}$/.test(e.drop_reason)
      ? e.drop_reason : "unspecified";
    drops[reason] = (drops[reason] ?? 0) + 1;
  }
  const millis = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) return Date.parse(value);
    return null;
  };
  const latency = sent.flatMap(e => {
    const start = millis(e.stt_final_at), end = millis(e.delivered_at);
    return start !== null && end !== null && end >= start ? [end - start] : [];
  }).sort((a, b) => a - b);
  const percentile = (p: number) => latency.length ? latency[Math.max(0, Math.ceil(p * latency.length) - 1)] : null;
  return {
    basis: "saved_snapshot_only", complete_hint_history: source?.full_hint_history === true,
    recorded_attempts: entries?.length ?? null,
    with_recorded_text: entries ? entries.filter(e => typeof e.text === "string" && e.text.trim()).length : null,
    sent: entries ? sent.length : null,
    acknowledged: entries ? sent.filter(e => millis(e.delivered_at) !== null).length : null,
    dropped: entries ? entries.filter(e => e.outcome === "dropped").length : null,
    drop_reasons: drops,
    opening_ui_claims: ui ? new Set(ui.filter(e => e.kind === "opening" && e.presentationId)
      .map(e => e.presentationId)).size : null,
    hints_ui_claimed: ui ? shown.size : null,
    translations_ui_claimed: ui ? translatedShown : null,
    translation_among_ui_claims: ui && shown.size ? {
      numerator: translatedShown, denominator: shown.size, percent: 100 * translatedShown / shown.size,
    } : null,
    stt_final_to_ack_ms: { samples: latency.length, p50: percentile(.5), p95: percentile(.95),
      method: "nearest_rank; saved sent events with both timestamps; not screen or speech-end latency" },
    guest_translation_count: null,
    before_owner_reply_count: null,
    limitations: ["UI events are client claims, not reading, speaking or independent screen verification.",
      "Missing UI claims do not prove non-display. Device clocks are not verified.",
      "Text-bearing records are not a verified count of all generated hints or moments of need.",
      "Guest translation payloads and verified reply-time alignment are not preserved in this snapshot."],
  };
}
