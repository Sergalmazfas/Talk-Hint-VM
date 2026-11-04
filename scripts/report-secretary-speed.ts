/** Read-only provider audit and report builder. Never starts calls/models. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RetellApi } from "../server/secretaryLab/retellApi";
import { SpeedBudget } from "../server/secretaryLab/speedBudget";
const dir = "generated-artifacts/secretary-speed-series";
const series = JSON.parse(await readFile(dir + "/audio-series-isolated.json", "utf8"));
const api = new RetellApi();
let provider: any = { calls: {}, agents: {} };
if (process.argv.includes("--read-provider")) {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Dev read-only audit only");
  for (const a of series.attempts) {
    const id = a.report?.callId;
    if (!id) continue;
    const c = await api.request("/v2/get-call/" + encodeURIComponent(id));
    if (c.call_type !== "web_call") throw Error("Not a Dev web call");
    provider.calls[id] = { id, agentId: c.agent_id, status: c.call_status, reason: c.disconnection_reason,
      durationMs: c.duration_ms, callCostRaw: c.call_cost };
    if (!provider.agents[c.agent_id]) {
      const agent = await api.request("/get-agent/" + encodeURIComponent(c.agent_id));
      const callback = agent.response_engine?.llm_websocket_url;
      if (!String(agent.agent_name).includes("Lab") || !String(callback).includes(".replit.dev/"))
        throw Error("Refuse non-Dev agent audit");
      provider.agents[c.agent_id] = { id: c.agent_id, name: agent.agent_name, voiceId: agent.voice_id,
        language: agent.language, responsiveness: agent.responsiveness,
        interruption: agent.interruption_sensitivity, dynamicResponsiveness: agent.enable_dynamic_responsiveness ?? null,
        sttMode: agent.stt_mode ?? null, storage: agent.data_storage_setting,
        callbackHost: new URL(callback).hostname };
    }
  }
  await writeFile(dir + "/provider-final-readback.json", JSON.stringify(provider, null, 2));
} else provider = JSON.parse(await readFile(dir + "/provider-final-readback.json", "utf8"));
const budget = await new SpeedBudget().state();
await writeFile(dir + "/final-budget.json", JSON.stringify(budget, null, 2));
const quantile = (values: number[], p: number) => {
  const a = [...values].sort((x, y) => x - y); return a.length ? a[Math.max(0, Math.ceil(p * a.length) - 1)] : null;
};
const modelUsd = (attempt: any) => (attempt.report?.engine?.speed?.requestLog ?? []).reduce((sum: number, r: any) => {
  const u = r.usage;
  if (!u) throw Error("Unmeasured model cost");
  const cached = u.input_tokens_details?.cached_tokens ?? 0, writes = u.input_tokens_details?.cache_write_tokens ?? 0;
  const fresh = u.input_tokens - cached - writes;
  if (fresh < 0) throw Error("Unrecognized cache usage accounting");
  return sum + (fresh * 2 + cached * (attempt.variant === "C" ? 0.2 : 0.1) + writes * 2.5 + u.output_tokens * 10) / 1e6;
}, 0);
const rows = ["A", "B", "C"].map(variant => {
  const attempts = series.attempts.filter((a: any) => a.variant === variant);
  const good = attempts.filter((a: any) => a.status === "completed" && a.report?.status === "ended");
  const replies = good.map((a: any) => a.report.engine.speed.requestLog.at(-1));
  const seconds = attempts.reduce((sum: number, a: any) => {
    const ms = provider.calls[a.report?.callId]?.durationMs;
    if (!Number.isFinite(ms)) throw Error("Provider duration unavailable; cannot infer minute price");
    return sum + ms / 1000;
  }, 0);
  const modelCost = attempts.reduce((sum: number, a: any) => sum + modelUsd(a), 0);
  return { variant, samples: good.length, measuredAttempts: attempts.length,
    speechEndToBrowserAudioP50Ms: quantile(good.map((a: any) => a.audio.speechEndToDecodedAudioMs), 0.5),
    speechEndToBrowserAudioP95Ms: quantile(good.map((a: any) => a.audio.speechEndToDecodedAudioMs), 0.95),
    ttftP50Ms: quantile(replies.map((r: any) => r.firstTextMs), 0.5),
    ttftP95Ms: quantile(replies.map((r: any) => r.firstTextMs), 0.95),
    medianReplyChars: quantile(replies.map((r: any) => r.outputChars), 0.5),
    medianReplyOutputTokens: quantile(replies.map((r: any) => r.usage.output_tokens), 0.5),
    maxRequestOutputTokens: Math.max(...attempts.flatMap((a: any) => a.report.engine.speed.requestLog.map((r: any) => r.usage.output_tokens))),
    truncations: attempts.reduce((n: number, a: any) => n + a.report.engine.speed.requestLog.filter((r: any) => r.error === "OUTPUT_INCOMPLETE").length, 0),
    confirmedHallucinations: 0, qualityReview: "manual check of short synthetic EN/RU replies only, not independent model judge",
    transportFailures: attempts.length - good.length,
    providerSeconds: seconds, modelEstimateUsd: modelCost,
    retellEstimateUsd: seconds / 60 * 0.07, totalEstimateUsd: modelCost + seconds / 60 * 0.07,
    estimateUsdPerMinute: 0.07 + modelCost / (seconds / 60) };
});
const shards = [];
for (let i = 1; i <= 4; i++) {
  const raw = await readFile(`${dir}/tests/final-shard-${i}.log`, "utf8");
  const files = raw.match(/Test Files[^\n]+/)?.[0], tests = raw.match(/\sTests\s+[^\n]+/)?.[0];
  if (!files || !tests) throw Error("Final shard incomplete");
  const get = (s: string, type: string) => Number(s.match(new RegExp("(\\d+) " + type))?.[1] ?? 0);
  shards.push({ shard: `${i}/4`, filesPassed: get(files, "passed"), filesSkipped: get(files, "skipped"),
    filesFailed: get(files, "failed"), testsPassed: get(tests, "passed"), testsSkipped: get(tests, "skipped"),
    testsFailed: get(tests, "failed"), sha256: createHash("sha256").update(raw).digest("hex") });
}
const typecheck = await readFile(dir + "/tests/typecheck-final.log", "utf8");
if (typecheck.trim() || shards.some(s => s.filesFailed || s.testsFailed)) throw Error("Checks not green");
const report = { at: new Date().toISOString(), rows, shards, typecheck: "passed",
  budget: { limitUsd: 5, conservativeDebitedUsd: budget.spentMicroUsd / 1e6, reservedUsd: budget.reservedMicroUsd / 1e6,
    remainingUsd: budget.remainingMicroUsd / 1e6, unknownUpperBoundUsd: 2, probeUpperBoundUsd: 0.1 },
  prices: { openai: "https://developers.openai.com/api/docs/pricing",
    gpt6: "https://developers.openai.com/api/docs/models/gpt-6-sol",
    gpt61: { input: 2, cached: 0.1, cacheWrite30m: 2.5, output: 10 },
    gpt6Sol: { input: 2, cached: 0.2, cacheWrite30m: 2.5, output: 10 },
    unit: "USD per 1M tokens; standard tier; not invoice", retellAndMerrittEstimatePerMinute: 0.07 },
  limitations: ["3 successful samples each; nearest-rank p95 is sample maximum, not a stable tail estimate",
    "Synthetic stored PCM16k; decoded browser audio, NOT physical iPhone/PSTN audibility",
    "TTFT is request-to-first text delta of final answer, not a complete STT/model/TTS decomposition",
    "No menu navigation, negotiation, long history or noisy real caller tested",
    "One B gateway failure retained and one allowed replacement; original uncertain A was NOT repeated",
    "Original uncertain A charged at $2 upper bound, not claimed to be provider invoice",
    "Signed-in main UI not visually verified; auth screen checked, SDK exercised in localhost-only fixture",
    "C may still show missing OpenAI tariff in the legacy archive; this comparison uses explicit official C rates"] };
await writeFile(dir + "/summary.json", JSON.stringify(report, null, 2));
const round = (n: number | null, digits = 2) => n === null ? "нет" : n.toFixed(digits);
const lines = rows.map(r => `| ${r.variant} | ${r.samples}/${r.measuredAttempts} | ${round(r.speechEndToBrowserAudioP50Ms! / 1000)} / ${round(r.speechEndToBrowserAudioP95Ms! / 1000)} | ${round(r.ttftP50Ms! / 1000)} / ${round(r.ttftP95Ms! / 1000)} | ${r.medianReplyChars} / ${r.medianReplyOutputTokens} | ${r.transportFailures} / ${r.truncations} / 0 | $${round(r.estimateUsdPerMinute, 3)} |`);
const markdown = `# Катя: Dev-серия A/B/C — быстрая прикидка

Только Dev. Production, телефонный агент, голос, языки и приветствие не менялись.
Оба первых запросa приняли low/300: HTTP 200, completed. Подмен и повторов unknown не было.

| Вариант | Успех/попытки* | Конец речи → браузерный звук p50/p95, с | TTFT p50/p95, с | Ответ, медиана знаков/выходных токенов | Сбой транспорта / обрыв / выдумка | Оценка $/мин |
|---|---:|---:|---:|---:|---:|---:|
${lines.join("\n")}

* Здесь A — три успешных разговора. Ещё одна ранняя A-сессия не подключилась к браузеру и отдельно учтена как unknown, без повтора. B — четыре попытки, из них три успешные; C — три. Автоматизация не превышала четыре допуска на вариант.

Рецепты: A — gpt-6.1-sol medium/1600, полный промпт 11111 знаков; B — gpt-6.1-sol low/300; C — gpt-6-sol low/300. B/C — компактный промпт 4850 знаков, stt fast и dynamic responsiveness, interruption 0.85. Responsiveness всех трёх = 1. Голос, языки, стандартные строки приветствия одинаковые.

На коротких синтетических ответах подтверждённых выдумок нет. B имел один ранний сбой браузерного транспорта: ответы модели завершены полностью, обрывом по лимиту 300 это не является. Не приписываем этот сбой самой модели.

## Вывод
1. Медиана улучшилась примерно на 0.33–0.35 с, а не вдвое.
2. Для первой ручной проверки предлагается C: короче ответы и меньше наблюдаемый хвост; B чуть лучше по медиане, но разница мала.
3. Три успешных разговора — предварительная прикидка, не основание переносить в бой без отдельного «да».

## Деньги
Общий предел $5. Консервативно учтено $${round(budget.spentMicroUsd / 1e6, 6)}, резерв $${round(budget.reservedMicroUsd / 1e6, 6)}, остаток $${round(budget.remainingMicroUsd / 1e6, 6)}.
В учтённом: $2 за неподтверждённую раннюю A-сессию и $0.10 верхней оценки двух проб. Это НЕ счёт провайдера. Ставки/фактические токены/длительности и тарифная оценка измеренных разговоров — summary.json. Старый unknown не повторён и не «обнулён».
Ручной тест владельца использует тот же остаток; автоматический потолок четырёх проб не запрещает владельцу выбрать B/C вручную, но денежный лимит не снимается. Для каждой новой сессии нужен безопасный резерв $2.

## Проверки
${shards.map(s => `- ${s.shard}: файлов ${s.filesPassed} passed / ${s.filesSkipped} skipped / ${s.filesFailed} failed; тестов ${s.testsPassed} passed / ${s.testsSkipped} skipped / ${s.testsFailed} failed.`).join("\n")}
TypeScript — пройден. Ничего не отключалось специально.

## Ограничения
${report.limitations.map(s => "- " + s).join("\n")}

## Ручной тест
- [Выбрать B](https://${process.env.REPLIT_DEV_DOMAIN}/admin/secretary-lab?stand=retell-engine&speedVariant=B)
- [Выбрать C](https://${process.env.REPLIT_DEV_DOMAIN}/admin/secretary-lab?stand=retell-engine&speedVariant=C)

Открыть в Safari/Chrome, пройти обычный вход владельца, выбрать Катю v2 и режим номера, дать короткое тестовое поручение, разрешить микрофон и принять предупреждение о платном Dev-тесте.
Короткое поручение: «В тесте кратко объясняй, чем можешь помочь; не выдумывай цены и выполненные действия».
У будущей длинной задачи промпт может превысить 5000: явный отказ, без обрезания правил/характера.
В боевого агента ничего не переносить без отдельного «да» владельца.
`;
await writeFile(dir + "/README.md", markdown);
console.log(JSON.stringify({ rows, budget: report.budget, shards }, null, 2));
