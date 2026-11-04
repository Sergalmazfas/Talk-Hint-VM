const bridgeWord = /^(поняла|хорошо|услышала|так|got|it|okay|understood|entendido|de|acuerdo|comprendido)[.!?, ]*$/i;
/** Keep provider word clocks, never duplicate names/numbers or raw word text. */
export function phoneSpeechTiming(transcript: any[]) {
  return transcript.map((t, index) => {
    const words = Array.isArray(t.words) ? t.words : [];
    const start = words[0]?.start, end = words.at(-1)?.end;
    const content = t.role === "agent" ?
      words.find((w: any) => !bridgeWord.test(String(w.word).trim()))?.start : null;
    return { index, role: t.role, start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null, content: Number.isFinite(content) ? content : null };
  });
}
/** No transcript/phone/name is exported; model timings are not labelled as sound. */
export function phoneMetrics(engine: any, provider?: any) {
  const events: any[] = engine?.interruption?.events ?? [];
  const generations = events.filter(e => e.kind === "generation_started").map(e => {
    const token = events.find(t => t.id === e.id && t.kind === "first_token" && Date.parse(t.at) >= Date.parse(e.at));
    return { id: e.id, start: e.at, firstToken: token?.at ?? null,
      ttftMs: token ? Date.parse(token.at) - Date.parse(e.at) : null };
  });
  const pairs: { endToSoundMs: number; endToContentMs: number | null }[] = [];
  const postCall = Array.isArray(provider?.transcript_object) && provider.transcript_object.length > 0;
  const transcript = postCall ? phoneSpeechTiming(provider.transcript_object) :
    (Array.isArray(engine?.playback) ? engine.playback : []);
  for (let i = 0; i < transcript.length; i++) {
    const user = transcript[i]; if (user.role !== "user") continue;
    // Adjacent user fragments are one utterance, not separate completed turns.
    if (transcript[i + 1]?.role === "user") continue;
    const agent = transcript[i + 1];
    if (agent?.role !== "agent") continue;
    const end = user.end, start = agent.start;
    if (![end, start].every(Number.isFinite) || start < end) continue;
    const content = agent.content;
    pairs.push({ endToSoundMs: Math.round((start - end) * 1000),
      endToContentMs: Number.isFinite(content) && content >= end ? Math.round((content - end) * 1000) : null });
  }
  const percentile = (values: number[], p: number) => values.length ?
    values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
  const interruption = engine?.interruption;
  return {
    variant: engine?.runtime?.variant ?? "unknown", promptMode: engine?.runtime?.promptMode ?? "unknown",
    audioTimingSource: pairs.length ? (postCall ? "retell-call-word-clocks" : "retell-websocket-word-clocks") : "unavailable",
    clientPlaybackVerified: false,
    providerReportedE2eMs: provider?.latency?.e2e &&
      [provider.latency.e2e.p50, provider.latency.e2e.p95].every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0) ?
      { p50: provider.latency.e2e.p50, p95: provider.latency.e2e.p95 } : null,
    fallbackReason: engine?.runtime?.fallbackReason ?? null,
    restarts: interruption?.restarts ?? null,
    classifications: interruption ? { a: interruption.a, b: interruption.b, c: interruption.c } : null,
    bridges: interruption?.bridges ?? null, generations,
    audioSamples: pairs.length, endToSoundMedianMs: percentile(pairs.map(p => p.endToSoundMs), .5),
    endToSoundP95Ms: percentile(pairs.map(p => p.endToSoundMs), .95),
    endToContentMedianMs: percentile(pairs.flatMap(p => p.endToContentMs === null ? [] : [p.endToContentMs]), .5),
    endToContentP95Ms: percentile(pairs.flatMap(p => p.endToContentMs === null ? [] : [p.endToContentMs]), .95),
    limitations: [
      ...(pairs.length ? [] : ["Нет подтверждённых аудиотаймингов Retell: задержка до звука не измерена"]),
      "TTFT не равен задержке до звука. Цифры и исправления требуют проверки исходной расшифровки Лёвой и Томой",
    ],
  };
}
