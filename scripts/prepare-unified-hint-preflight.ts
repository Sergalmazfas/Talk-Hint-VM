/** Offline preflight only: no inference SDK, no generation, no mail, no product settings. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../shared/prompts";
const dir = "generated-artifacts/hint-unified-preflight";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const august = JSON.parse(await readFile(`${dir}/august-source.json`, "utf8"));
const october = JSON.parse(await readFile("generated-artifacts/hint-owner-feedback-1/corpus.json", "utf8"));
const previous = JSON.parse(await readFile("generated-artifacts/coffee-product-decisions/results.json", "utf8"));
const historical = JSON.parse(await readFile("generated-artifacts/hint-model-history/benchmark-source.json", "utf8"))
  .filter((r: any) => r.run_type === "brain" && r.results?.turnResults?.length);
const prices = JSON.parse(await readFile(`${dir}/prices.json`, "utf8"));
const models = ["gpt-4.1-mini", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.2", "gpt-5.6-sol"];
const judge = "gpt-5.4-2026-03-05";
assert(!models.includes(judge));
const calls = [{
  id: "august-fixture-2", label: "Real Call Fixture #2, август",
  goal: august.goal, goalOrigin: "Сохранённое goal из benchmark_fixtures",
  turns: august.reference_turns.map((t: any) => ({ role: t.role, text: t.text, sourceIdx: t.idx })),
}, ...october.map((c: any, i: number) => ({
  id: `october-${i + 1}`, label: ["Mint 26.10 Denver", "Mint 27.10", "Кофейня 27.10"][i],
  goal: c.metadata.goalText || previous.fixtures.find((f: any) => f.callIndex === i).goal,
  goalOrigin: c.metadata.goalText ? "Сохранённое goalText звонка" : "Реконструкция из жалобы владельца; оригинальное goalText отсутствует",
  turns: c.transcript.split("\n").filter(Boolean).map((l: string, k: number) => ({
    role: l.startsWith("Owner:") ? "owner" : l.startsWith("Guest:") ? "guest" : "unknown",
    text: l.replace(/^(Owner|Guest):\s*/, ""), sourceIdx: k,
  })),
}))];
const snapshots: any[] = [];
for (const call of calls) for (const [i, t] of call.turns.entries()) {
  if (t.role !== "guest") continue;
  const before = call.turns.slice(0, i);
  const history = before.map((x: any) => `${x.role === "owner" ? "Owner" : x.role === "guest" ? "Guest" : "Unknown"}: ${x.text}`).join("\n");
  const messages = [
    { role: "system", content: buildLiveSystemPrompt({ goal: call.goal, language: "ru",
      conversationContext: history, translateEnabled: true }) },
    { role: "user", content: buildLiveUserPrompt(t.text) },
  ];
  snapshots.push({ id: `${call.id}:${t.sourceIdx}`, callId: call.id, sourceTurnIdx: t.sourceIdx,
    goal: call.goal, goalOrigin: call.goalOrigin, history, guest: t.text, messages,
    messagesSha256: sha(JSON.stringify(messages)), factReferenceDraft: {
      status: "источники собраны; семантическая сверка и финальная фиксация до вызовов модели",
      goalIsIntentNotCompletedAction: true,
      ownerEvidence: before.filter((x: any) => x.role === "owner").map((x: any) => ({ sourceTurnIdx: x.sourceIdx, quote: x.text })),
      guestEvidence: before.filter((x: any) => x.role === "guest").map((x: any) => ({ sourceTurnIdx: x.sourceIdx, quote: x.text })),
      rule: "Утверждение Guest не превращать в факт Owner; положительные и отрицательные состояния требуют источника. STT не сверен с аудио.",
    } });
}
assert.equal(snapshots.length, 90);
const oldAnswers = historical.flatMap((r: any) => r.results.turnResults
  .filter((t: any) => t.output && !t.error)
  .map((t: any) => ({ runId: r.id, fixtureId: august.id, turnIdx: t.turnIdx, candidateId: t.candidateId,
    output: t.output, oldJudge: t.judge ?? null })));
assert.equal(oldAnswers.length, 188);
const rubric = {
  goal: "да / частично / нет / неизвестно; основание — только доступная на момент цель и явные изменения Owner",
  inventedFacts: "Список новых утверждений без источника с точным полем и цитатой. Перевод Guest не является утверждением Owner.",
  speakingForOwner: "Утверждение неизвестного положительного И отрицательного состояния за Owner; явно условные варианты проверять отдельно.",
  goalFactsUptake: "Требуемый факт цели/последнего уточнения использован уместно; не требовался / да / частично / нет / неизвестно",
  length: "Код: EN-слова каждой карточки, медиана/max, суммарно по карточкам; переводы отдельно",
  cards: "Код: число видимых предложенных карточек после общего нормализатора; не перевод Guest и не количество JSON-полей",
  latency: "Код: first-content и full-output p50/p95, nearest-rank; успешные/все отдельно. Не EOT→экран; Sol не ранжировать по скорости.",
  judgeFailures: "неизвестно; не ноль; ошибки и доля пригодных оценок отдельными знаменателями",
  independence: "Скрыть имена моделей; цитаты проверять по роли и полю. Неверная цитата/противоречие эталону → оценка неизвестна. Это AI-оценка, не приёмка владельца.",
};
const newChars = snapshots.reduce((n, f) => n + JSON.stringify(f.messages).length, 0);
// Estimates, not tokenizer counts: explicit 2–4 characters/token envelope.
const judgePromptChars = (f: any, outputChars: number) =>
  JSON.stringify({ goal: f.goal, history: f.history, guest: f.guest, reference: f.factReferenceDraft, rubric }).length + outputChars;
const currentJudgeChars = snapshots.reduce((n, f) => n + judgePromptChars(f, 1000), 0) * models.length;
const oldJudgeChars = oldAnswers.reduce((n: number, a: any) => {
  const f = snapshots.find(s => s.callId === "august-fixture-2" && s.sourceTurnIdx === a.turnIdx);
  assert(f, `Historical turn missing: ${a.turnIdx}`);
  return n + judgePromptChars(f, JSON.stringify(a.output).length);
}, 0);
const rate = (m: string) => prices.rates.find((r: any) => r.model === m);
const scenarios = [4, 3, 2].map(charsPerToken => {
  const generations = models.reduce((n, m) => n + (newChars / charsPerToken * rate(m).inputPerMillionUSD
    + snapshots.length * 250 * rate(m).outputPerMillionUSD) / 1e6, 0);
  const judgeInput = (currentJudgeChars + oldJudgeChars) / charsPerToken;
  const judgeExpected = (judgeInput * rate("gpt-5.4").inputPerMillionUSD
    + (450 + 188) * 800 * rate("gpt-5.4").outputPerMillionUSD) / 1e6;
  const judgeOutputCap = (judgeInput * rate("gpt-5.4").inputPerMillionUSD
    + (450 + 188) * 1500 * rate("gpt-5.4").outputPerMillionUSD) / 1e6;
  return { charsPerToken, generationUSD: +generations.toFixed(2),
    expectedTotalUSD: +(generations + judgeExpected).toFixed(2),
    outputCapScenarioUSD: +(generations + judgeOutputCap).toFixed(2) };
});
const frozen = JSON.stringify(snapshots);
await writeFile(`${dir}/text-snapshots-draft.json`, frozen);
await writeFile(`${dir}/old-answers-preserved.json`, JSON.stringify(oldAnswers));
const plan = {
  format: "talkhint.hint-unified-replay-preflight", version: 1,
  caseId: "HINT-MODEL-HISTORY-001", documentId: "DOC-HINT-UNIFIED-REPLAY",
  preparedAt: new Date().toISOString(), role: "P.LAB", state: "предзапусковой расчёт; ждёт разрешения",
  previousMini: "Завершён: 54/54 генерации, 9/9 ответов судьи; QA-гейт не пройден. Ничего не выпускалось.",
  corpus: calls.map(c => ({ id: c.id, label: c.label, moments: c.turns.filter((t: any) => t.role === "guest").length,
    goalOrigin: c.goalOrigin })),
  models, judge: { model: judge, pricingAlias: "gpt-5.4", notInComparison: true, availabilityVerified: false,
    substitutionAllowed: false, blindModelIdentity: true },
  requests: { moments: 90, generations: 450, currentAnswerJudges: 450, historicalAnswerJudges: 188,
    totalMaximum: 1088, repetitionsPerModelMoment: 1, retries: 0, extraAvailabilityProbes: 0,
    availability: "Первый реальный запрос считается проверкой; недоступная модель → UNAVAILABLE, остальные её моменты заблокированы, без подмены." },
  prompt: { path: "shared/prompts.ts", sourceSha256: sha(await readFile("shared/prompts.ts", "utf8")),
    snapshotsSha256: sha(frozen), functions: ["buildLiveSystemPrompt", "buildLiveUserPrompt"],
    additions: false, profile: "Текущий LIVE профиль: лимит 250 выходных токенов; GPT-5 reasoning_effort=none без temperature; Mini temperature=0.4. Stream только для замера. JSON-усилений нет.",
    contextLimit: "Реконструкция: только предшествующий текст и цель, без будущих ответов; профиль/карточки/strategy memory не выдумываются, для всех одинаково отсутствуют.",
    coffeeGoal: "Реконструированная цель явно маркирована. Это не восстановленный исторический live-запрос.",
    referenceStatus: "90 срезов источников готовы, но помоментный семантический эталон ещё не утверждён/зафиксирован; до первой генерации — offline-сверка и hash финальной версии.",
    audio: false, screenshots: false },
  metrics: rubric,
  historicalComparison: {
    oldRuns: historical.map((r: any) => ({ id: r.id, startedAt: r.started_at })),
    method: "188 старых ответов повторно оцениваются новой меркой и отдельным судьёй, без новой генерации старым промптом. Так отделяется эффект мерки от смены промпта/новых ответов.",
    preserve: "Старые ответы, оценки и ошибки не перезаписывать; новая оценка — отдельный результат.",
    caveat: "Одновременно меняется судья и рубрика; это общий эффект новой оценки, не изолированный эффект одной рубрики. Новые и старые ответы сравниваются отдельно.",
  },
  cost: { currency: "USD", publicRates: prices.rates, assumptions: "Без скидки кеша, без Batch, без повторов. Генерации по верхнему лимиту 250; judge ожидаемо 800, максимум 1500 выходных токенов. Вход оценён 2–4 символа/токен, не точный tokenizer.",
    scenarios, invoice: "Не счёт и не гарантия списания; персональный тариф/налоги неизвестны.",
    proposedAuthorizationCeilingUSD: Math.ceil(Math.max(...scenarios.map(x => x.outputCapScenarioUSD)) * 1.2 / 5) * 5 },
  gatesBeforeInference: ["Разрешение владельца после числа вызовов и цены", "Offline-сверка помоментных фактов и неизвестного, безопасная копия текста и окончательные hashes",
    "Проверка независимости/цитат судьи; строгая фиксация расходов и остановка до превышения разрешённой суммы"],
  deliverable: "Одна таблица по моделям и срезам (общая и по звонкам), расхождения старой/новой оценки, 3–5 пар примеров; Нужно решение — какую модель пробовать только на аккаунте владельца.",
  liveTrial: "Только рекомендация. Сам текстовый прогон не включает модель на аккаунте владельца; для всех пользователей изменений нет.",
  activationAllowed: false, productChanged: false, newInferenceCalls: 0,
};
await writeFile(`${dir}/preflight.json`, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ corpus: plan.corpus, requests: plan.requests, scenarios, ceiling: plan.cost.proposedAuthorizationCeilingUSD,
  referenceReady: false, newInferenceCalls: 0 }, null, 2));
