import type { ComparisonMode } from "../../shared/secretaryLabComparison";
import type { LabCostLine, LabRunCost, LabTariffSnapshot, LabTokenUsage, LabRealtimeUsage } from "../../shared/secretaryLabCost";

/** Audited public standard rates, not this workspace's subscription or invoice.
 * Never update a report's snapshot when displaying/evaluating/exporting it. */
export function captureLabTariff(): LabTariffSnapshot {
  return {
    version: 1, checkedAt: "2026-10-24", capturedAt: new Date().toISOString(),
    sources: [
      { label: "ElevenLabs Agents", url: "https://elevenlabs.io/pricing/agents" },
      { label: "Retell component pricing", url: "https://www.retellai.com/pricing" },
      { label: "OpenAI API pricing", url: "https://developers.openai.com/api/docs/pricing" },
    ],
    rates: { elevenAdditionalMinute: 0.08, elevenBurstMinute: 0.16, retellInfraMinute: 0.055,
      retellPlatformVoiceMinute: 0.015, retellSolMinute: 0.064, liveMinute: 0.05,
      solInputMillion: 2, solCachedMillion: 0.1, solOutputMillion: 10,
      realtimeTextInputMillion: 4, realtimeTextCachedMillion: 0.4, realtimeTextOutputMillion: 24,
      realtimeAudioInputMillion: 32, realtimeAudioCachedMillion: 0.4, realtimeAudioOutputMillion: 64 },
  };
}
interface CostFacts {
  model: string; voice: string; createdAt: string; endedAt?: string;
  status?: string;
  voiceProvider?: string; transport?: string; ttsModel?: string; profileId?: string;
  tariffSnapshot?: LabTariffSnapshot;
  realtimeUsage?: LabRealtimeUsage;
  audioConnectedAt?: string;
  providerDurationSeconds?: number;
  events: Array<{ type: string; atMs: number }>;
  engine?: { model: string; usage?: LabTokenUsage };
}
const finite = (n: number) => Number.isFinite(n) && n >= 0;
export function calculateLabCost(mode: ComparisonMode, r: CostFacts): LabRunCost | undefined {
  const tariff = r.tariffSnapshot;
  // Legacy reports have no historic tariff or reliable usage. Do not reprice them.
  if (!tariff) return undefined;
  const rates = tariff.rates;
  const start = r.events.find(e => (mode === "gpt" ? e.type === "realtime_ready" : mode === "eleven-engine"
    ? e.type === "audio_connected" : e.type === "provider_call_connected") && finite(e.atMs));
  const startAt = r.audioConnectedAt ? Date.parse(r.audioConnectedAt) : start ? Date.parse(r.createdAt) + start.atMs : NaN;
  const elapsed = r.endedAt ? (Date.parse(r.endedAt) - startAt) / 1000 : NaN;
  const providerDuration = r.providerDurationSeconds;
  const duration = r.status === "stop_failed" ? null : providerDuration !== undefined && finite(providerDuration)
    ? providerDuration : finite(elapsed) ? elapsed : null;
  const minutes = duration === null ? null : duration / 60;
  const lines: LabCostLine[] = [];
  const add = (label: string, quantity: number | null, rateUsd: number | null, note: string,
    unit: LabCostLine["unit"] = "minute", status?: LabCostLine["status"]) => {
    const amount = quantity !== null && rateUsd !== null ? quantity * rateUsd : null;
    lines.push({ label, quantity, rateUsd, amountUsd: amount, unit,
      status: status ?? (amount === null ? "unknown" : "estimated"), note });
  };
  const included = (label: string, note: string) => add(label, null, null, note, "item", "included");
  const model = r.engine?.model ?? r.model;
  const usage = r.engine?.usage ?? null;
  const notes = ["Не счёт и не подтверждённое списание. USD без налогов, скидок и распределения месячной подписки.",
    "Длительность — локальная оценка от подтверждения подключения аудио до остановки, не биллинговый таймер провайдера.",
    "Неизвестная ставка или отсутствующий расход не равны нулю."];
  if (mode === "eleven-engine") {
    const supported = ["eleven_multilingual_v2", "eleven_flash_v2_5"].includes(r.ttsModel ?? "") && !!r.voice && !!r.profileId;
    add("Аудиоплатформа · ElevenLabs Agents", minutes, supported ? rates.elevenAdditionalMinute : null,
      `Сценарий дополнительных минут, не тариф аккаунта. План/остаток пакета неизвестны; burst $${rates.elevenBurstMinute}/мин. Профиль ${r.profileId ?? "неизвестен"}, TTS ${r.ttsModel ?? "неизвестен"}, голос ${r.voice || "неизвестен"}.`);
    included("STT · Scribe realtime", "Включён в Agents; не добавляем цену отдельного STT API.");
    included(`TTS · ${r.ttsModel ?? "неизвестна"}`, "Включён в Agents; Flash не означает скидку по тарифу отдельного TTS API.");
    add("Условия аккаунта / голоса", null, null, "Пакет минут, burst, индивидуальные условия и возможные надбавки голоса не подтверждены.");
  } else if (mode === "retell" || mode === "retell-engine") {
    add("Аудиоплатформа · Retell Voice Infra", minutes, rates.retellInfraMinute, "Публичный standard PAYG; STT включён.");
    included("STT · Retell", "Входит в Voice Infra; отдельный STT не суммируется.");
    add(`TTS · ${r.voice || "неизвестный голос"}`, minutes,
      r.voice === "retell-Merritt" ? rates.retellPlatformVoiceMinute : null, "Retell Platform Voice; для другого голоса нужна его ставка.");
    if (mode === "retell") add(`LLM · Retell managed ${model}`, minutes,
      model === "gpt-6.1-sol" ? rates.retellSolMinute : null, "Standard tier; токены провайдер не сообщил, оплата поминутная.");
  } else {
    const native = r.voiceProvider === "openai" && r.transport === "webrtc";
    if (native && r.model === "gpt-realtime-2.1") {
      const u = r.realtimeUsage;
      const measured = u && u.requests > 0 && u.requests === u.measuredRequests;
      for (const modality of ["text", "audio"] as const) {
        const prefix = modality === "text" ? "realtimeText" : "realtimeAudio";
        add(`OpenAI Realtime · ${modality} input`, measured ? (u[`${modality}Input`] - u[`${modality}Cached`]) / 1e6 : null,
          rates[`${prefix}InputMillion`], "Некэшированные input tokens.", "million_tokens");
        add(`OpenAI Realtime · ${modality} cached`, measured ? u[`${modality}Cached`] / 1e6 : null,
          rates[`${prefix}CachedMillion`], "Кэш вычтен из обычного input.", "million_tokens");
        add(`OpenAI Realtime · ${modality} output`, measured ? u[`${modality}Output`] / 1e6 : null,
          rates[`${prefix}OutputMillion`], "Включая оборванные ответы с полученным usage.", "million_tokens");
      }
      notes.push("Аудиоплатформа OpenAI Realtime тарифицируется токенами, не минутами GPT-Live.");
    } else {
      add(`Аудиоплатформа · ${r.model}`, minutes, native && r.model === "gpt-live-1" ? rates.liveMinute : null,
        "GPT-Live поминутно с посекундной оплатой; backend model/tools оплачиваются отдельно.");
      add("Backend model / tokens", null, null, "Отдельная стоимость backend не раскрыта в отчёте GPT-Live; не считаем её бесплатной.");
    }
    if (native) {
      included("STT · native audio", "Нативная обработка аудио включена.");
      included(`TTS · ${r.voice}`, "Нативный голос включён, отдельный TTS не добавляется.");
      add("Display STT · gpt-4o-mini-transcribe", null, null, "Дополнительная транскрипция включена в конфигурации; её расход не получен.");
    } else add("Внешние STT/TTS", null, null, "Исторический simulated transport: расход и тариф не подтверждены.");
  }
  if (mode.endsWith("-engine")) {
    const measured = usage && usage.requests > 0 && usage.requests === usage.measuredRequests &&
      [usage.input, usage.cachedInput, usage.output].every(finite) && usage.cachedInput <= usage.input;
    const knownModel = model === "gpt-6.1-sol";
    add(`TalkHint Engine · ${model} · input`, measured ? (usage.input - usage.cachedInput) / 1e6 : null,
      knownModel ? rates.solInputMillion : null, "Некэшированные входные токены.", "million_tokens");
    add("TalkHint Engine · cached input", measured ? usage.cachedInput / 1e6 : null,
      knownModel ? rates.solCachedMillion : null, "Кэш — часть input, не прибавляется повторно.", "million_tokens");
    add("TalkHint Engine · output", measured ? usage.output / 1e6 : null,
      knownModel ? rates.solOutputMillion : null, "Включая reasoning tokens; все раунды инструментов. Оборванный запрос без usage оставляет стоимость неизвестной.", "million_tokens");
    notes.push("TalkHint Engine — отдельный расход OpenAI аккаунта TalkHint, не включён в цену аудиоплатформы.");
  } else add("TalkHint text Engine", null, null, "В этом режиме отдельный text Engine не используется.", "item", "not_applicable");
  const knownSubtotalUsd = lines.reduce((sum, line) => sum + (line.amountUsd ?? 0), 0);
  const complete = lines.every(l => l.status !== "unknown");
  return { currency: "USD", status: "estimate", complete, estimatedTotalUsd: complete ? knownSubtotalUsd : null,
    knownSubtotalUsd, confirmedChargeUsd: null, durationSeconds: duration,
    durationBasis: providerDuration !== undefined && finite(providerDuration) ? "provider_reported_duration" : "local_audio_connected_to_stop",
    model, voice: r.voice, ttsModel: r.ttsModel ?? null,
    profileId: r.profileId ?? null, tokenUsage: usage ? structuredClone(usage) : null,
    realtimeUsage: r.realtimeUsage ? structuredClone(r.realtimeUsage) : null, tariff: structuredClone(tariff), lines, notes };
}
export function pricedLabReport<T extends CostFacts>(mode: ComparisonMode, report: T): T & { cost?: LabRunCost } {
  return { ...structuredClone(report), cost: calculateLabCost(mode, report) };
}
