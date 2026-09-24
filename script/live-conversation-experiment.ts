// Offline prompt-only comparison. Never imports server bootstrap or database.
// capture MUST be run against the unmodified baseline before editing prompts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as prompts from "../shared/prompts";
import { buildOpenAIChatBody } from "../server/hintProvider";
import { normalizeSuggestion } from "../server/hintShape";

const path = "reports/live-conversation-experiment.json";
const source = readFileSync("server/websocket.ts", "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const decode = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const report = readFileSync("reports/latest-call-diagnostic.html", "utf8");
const transcript = report.slice(report.indexOf('id="transcript"'));
const turns = [...transcript.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].flatMap(m => {
  const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(x => decode(x[1]).trim());
  const role = cells[0]?.match(/^(Owner|Guest) #(\d+)$/);
  return role ? [{ speaker: role[1] === "Owner" ? "Honor" : "Guest", number: +role[2], text: cells[2] }] : [];
});
function historyThrough(guest: number) {
  const i = turns.findIndex(t => t.speaker === "Guest" && t.number === guest);
  if (i < 0) throw new Error(`Historical Guest #${guest} not found`);
  return turns.slice(Math.max(0, i - 9), i + 1).map(t => `${t.speaker}: ${t.text}`).join("\n");
}
const historicalGoal = "Have Edgar confirm that a warehouse worker will meet you when you arrive and remove the two rear pallets to correct the trailer axle overweight. Get a new BOL showing the updated pallet count and weight before you leave.";
const cases = [
  { id: "miles", goal: historicalGoal, conversationContext: historyThrough(9), provenance: "Historical reconstruction through Guest #9; last 10 transcript messages; not the saved original model request.", criterion: "Answer about distance (2.5 miles) or clarify distance; never pallets." },
  { id: "plan-change", goal: historicalGoal, conversationContext: historyThrough(19), provenance: "Historical reconstruction through Guest #19; last 10 transcript messages, includes rearrangement and contingent removal. No later BOL discussion used.", criterion: "Support rearrangement to legal axle weights first; removal only if necessary, not unconditional two pallets; retain corrected-BOL intention without inventing weight." },
  { id: "missing-data", goal: "Arrange the paperwork for a delivery.", conversationContext: "Honor: I am calling about the delivery paperwork.\nGuest: What is your driver's license number?", provenance: "Synthetic control; no license, driving, document possession or promised delivery facts supplied.", criterion: "Natural safe request for time to obtain information, no invented number/state/promise, not mandatory placeholder." },
  { id: "known-fact", goal: "Fix my mobile service.", conversationContext: "Honor: I already installed the app.\nGuest: Have you installed the app?", provenance: "Synthetic control.", criterion: "Short direct known answer, no CHOICE or unnecessary clarification." },
  { id: "goal-conflict", goal: "Replace the damaged order by collecting it at the store; I need it by Friday.", conversationContext: "Honor: I need an undamaged replacement by Friday; collection was just my initial plan.\nGuest: Store pickup is not possible, but we can deliver the replacement Thursday at no extra cost. Would that help?", provenance: "Synthetic control; Thursday satisfies explicit Friday deadline.", criterion: "Adapt to delivery alternative; don't insist on impossible pickup; don't invent completed delivery." },
  { id: "resolution-in-progress", goal: "Get a refund for the duplicate charge.", conversationContext: "Honor: There are two charges for the same purchase.\nGuest: The second charge is still pending. I can cancel that duplicate now, so it won't be collected.", provenance: "Synthetic control.", criterion: "Naturally accept cancellation of duplicate, do not keep demanding refund or claim it is already completed." },
  { id: "inbound-empty-goal", goal: "", conversationContext: "Honor: My ZIP code is 60614.\nGuest: Could you confirm your ZIP code?", provenance: "Synthetic inbound control; no Reason for Call.", criterion: "Answer confirmed ZIP directly without inventing a goal." },
  { id: "flexible-doctor-day", goal: "Book a doctor appointment Tuesday; another day is fine if Tuesday is unavailable.", conversationContext: "Honor: Thursday afternoon also works for me.\nGuest: Tuesday is full, but we have Thursday at 2 PM. Would that work?", provenance: "Synthetic flexible-date control.", criterion: "Accept known compatible alternative without defending Tuesday or unnecessary CHOICE." },
];
function assembly(c: typeof cases[number], translateEnabled: boolean) {
  const currentGuest = c.conversationContext.split("\n").at(-1)!.replace(/^Guest: /, "");
  const pureUser = (prompts as Record<string, any>).buildLiveUserPrompt;
  const inlineUser = source.match(/const userPrompt = `([\s\S]*?)`;/)?.[1];
  if (!pureUser && !inlineUser) throw new Error("Cannot locate actual LIVE user prompt");
  return {
    system: prompts.buildLiveSystemPrompt({ goal: c.goal, language: "ru",
      conversationContext: c.conversationContext, translateEnabled, contextSections: "", strategyMemory: "" }),
    user: pureUser ? pureUser(currentGuest) : inlineUser!.replace("${text}", currentGuest),
  };
}
// Read the CURRENT unchanged parser regexes from the production source, rather
// than silently using identity normalization or importing the server bootstrap.
const stripBody = source.match(/const PREAMBLE_PATTERNS = (\[[\s\S]*?\]);/)?.[1];
if (!stripBody) throw new Error("Cannot locate production preamble patterns");
const patterns = new Function(`return ${stripBody};`)() as RegExp[];
const stripPreamble = (s: string) => patterns.reduce((v, re) => v.replace(re, ""), s.trim()).trim();

async function main() {
  if (process.argv[2] === "capture") {
    if (existsSync(path)) throw new Error("Baseline file already exists; refusing to overwrite preserved evidence");
    const data = { capturedAt: new Date().toISOString(),
      sourceHash: hash(readFileSync("shared/prompts.ts", "utf8")), websocketHash: hash(source),
      limits: "Prompt-only reconstruction; empty unavailable profile/cards/Strategy Memory; no future turns. Not end-to-end delivery testing.",
      cases: cases.map(c => ({ ...c, baseline: assembly(c, true), baselineTranslationOff: assembly(c, false) })),
    };
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    console.log(`Captured ${cases.length} baseline system/user assemblies in both translation modes.`);
    return;
  }
  if (process.argv[2] === "report") {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const assessments: Record<string, { baseline: string; candidate: string; reason: string }> = {
      "miles": { baseline: "FAIL", candidate: "PASS", reason: "Исходный ответ о двух паллетах не относится к расстоянию. Финальный ответ — примерно 2.5 мили, без паллет." },
      "plan-change": { baseline: "FAIL", candidate: "PASS", reason: "Исходный ответ требует два задних паллета и приписывает Owner чужие «десять минут». Финальный отвечает на условие текущего Guest: проверить по прибытии и позвонить, только если потребуется снятие паллеты. Перестановка не отвергнута, снятие условное. В этой короткой реплике не повторены axle weights/rearrange/BOL; это не доказательство выполнения всей дальнейшей цепочки, а проверка адаптации следующей реплики. Исходное намерение legal weights/BOL остаётся во входном контексте." },
      "missing-data": { baseline: "FAIL", candidate: "PASS", reason: "Baseline и первый candidate дают только placeholder. После одной общей коррекции C: просьба дать время проверить, без выдуманного номера, нахождения за рулём, отсутствия документа или обещания отправки. USER_INPUT сохранён; no-value просьба не раскрывает чувствительный факт." },
      "known-fact": { baseline: "PASS", candidate: "PASS", reason: "Известная установка приложения подтверждена коротким DIRECT; нет CHOICE или лишнего уточнения." },
      "goal-conflict": { baseline: "PASS", candidate: "PASS", reason: "Оба принимают доставку вместо невозможного самовывоза; четверг укладывается в обязательный срок до пятницы. Финальный сохраняет условие неповреждённой замены." },
      "resolution-in-progress": { baseline: "PASS", candidate: "PASS", reason: "Оба естественно просят отменить дубликат; не требуют снова refund и не заявляют, что отмена уже произошла." },
      "inbound-empty-goal": { baseline: "PASS", candidate: "PASS", reason: "Оба отвечают известным ZIP напрямую при пустом Goal. Это узкий контроль, не переработка входящих." },
      "flexible-doctor-day": { baseline: "PASS", candidate: "PASS", reason: "Оба принимают четверг 14:00 на основании явно указанной доступности Owner; вторник не защищается как обязательный." },
    };
    for (const c of data.cases) {
      const a = assessments[c.id];
      c.assessment = { ...a, candidate: c.candidateResult?.status === "generated" ? a.candidate : "UNTESTED",
        method: "Manual criterion-based review of actual normalized output; not an LLM judge or a deterministic behavioral assertion." };
    }
    data.validation = { targetedCommand: "npx vitest run server/__tests__/{liveConversationPriority,livePromptObjectionRules,liveGroundingRules,goalCompassNotRails,adaptiveHintTypes,strategyMemory,askRefine,hintProvider}.test.ts",
      testFiles: 8, tests: 120, result: "PASS", typecheck: "npx tsc --noEmit: exit 0",
      totalModelRequests: 24, samplesPerFinalVariantPerCase: 1 };
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    const escape = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const output = (r: any) => `<p><b>Final:</b> ${escape(r.normalized?.en || r.error || "(no usable hint)")}</p><p>Type: ${escape(r.normalized?.type)} · ${escape(r.elapsedMs)} ms (не live latency)</p><details><summary>Raw model response + normalized output</summary><pre>${escape(JSON.stringify(r, null, 2))}</pre></details>`;
    const sections = data.cases.map((c: any, i: number) => `<section id="${escape(c.id)}"><h2>${i + 1}. ${escape(c.id)}</h2><p>${escape(c.provenance)}</p><p><b>Критерий:</b> ${escape(c.criterion)}</p><details><summary>Одинаковые входные данные обоих вариантов</summary><pre>Goal: ${escape(c.goal)}\n${escape(c.conversationContext)}</pre></details><div class="grid"><div><h3>Baseline: ${escape(c.assessment.baseline)}</h3>${output(c.baselineResult)}</div><div><h3>Final candidate: ${escape(c.assessment.candidate)}</h3>${output(c.candidateResult)}</div></div><p>${escape(c.assessment.reason)}</p><details><summary>Сохранённый первый candidate (до общей коррекции C)</summary>${output(c.firstCandidateResult)}</details><details><summary>Фактические system + user, baseline / final (translation ON)</summary><pre>${escape(JSON.stringify({ baseline: c.baseline, candidate: c.candidate }, null, 2))}</pre></details></section>`).join("");
    writeFileSync("reports/live-conversation-experiment.html", `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIVE: намерение, не сценарий — эксперимент</title><style>body{font:16px/1.6 system-ui;color:#202535;background:#f6f7fa;margin:0}main{max-width:1120px;margin:auto;padding:24px}section,header{background:white;padding:22px;border:1px solid #ddd;border-radius:12px;margin:18px 0}h1,h2,h3{line-height:1.25}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f4f5fa;padding:12px}details{margin:12px 0}summary{cursor:pointer;color:#49369a}.note{background:#fff4d8;padding:15px}code{overflow-wrap:anywhere}@media(max-width:700px){.grid{display:block}main{padding:12px}}</style><main><header><h1>Исходящие: намерение, не сценарий</h1><p>Сравнение фактически собранных LIVE system + user prompts. ${escape(data.ranAt)}.</p><p><b>Итог:</b> финальный candidate проходит шесть turn-level критериев и два дополнительных контроля в этом ограниченном прогоне. Baseline: 3/6; первый candidate ещё проваливал missing-data. Все исходные и промежуточные ответы сохранены, не заменены успешным примером.</p><p class="note">Это один ответ на вариант/сценарий, не статистическое доказательство устойчивости и не контроль реального звонка. Plan-change проверяет следующую реплику в контексте уже обсуждённой перестановки, а не исполнение всей цепочки до нового BOL. Продакшен не опубликован, телефонные звонки не выполнялись.</p></header><section><h2>Изменения A–D</h2><ul><li>A: текущий разговор и ближайший контекст выше первоначального шага Goal; удалено must ADVANCE из реального user message.</li><li>B: желаемый результат отделён от пересматриваемых шагов; сохранены явно обязательные ограничения, Guest не подменяет согласие Owner.</li><li>C: содержательная просьба о времени/уточнении разрешена. После первого прогона добавлено общее предпочтение такой просьбы неизвестному disclosure-frame, без специального правила о правах. Чувствительные значения по-прежнему не раскрываются; no-value USER_INPUT может быть без placeholder.</li><li>D: числа, местоимения и ошибки STT разрешаются по ближайшему контексту; если его недостаточно — уточнение вместо догадки.</li></ul><p>Не изменялись CHOICE decision rules, schema, normalizeSuggestion, stripPreamble, provider/settings, STT, UI, lifecycle, trigger, Strategy Memory, GoalEngine, БД, webhook, deployment. Новый чистый buildLiveUserPrompt переиспользуется ordinary-phone путём и проверками; дополнительного вызова на live path нет.</p></section><section><h2>Метод и достоверность</h2><p>Baseline сохранён до правок: ${escape(data.capturedAt)}. SHA-256 исходного shared/prompts.ts: <code>${escape(data.sourceHash)}</code>. Финальный: <code>${escape(data.candidateSourceHash)}</code>.</p><p>Модель: <b>${escape(data.model)}</b>, одинаковый buildOpenAIChatBody: max_completion_tokens=250, reasoning_effort=none, без temperature. Использован существующий OpenAI endpoint/key, без другого провайдера, fallback, response_format, нового judge или изменения модели. Offline источник выбора модели — HINT_MODEL/кодовый default; process-wide UI override и override текущего реального звонка не наблюдались.</p><p>24 реальных запроса: 8 baseline, 8 first candidate, 8 final candidate. Финальная коррекция одна; baseline не повторялся. Translation ON — поведенческий прогон; ON/OFF — сохранённые assemblies и детерминированные проверки. Все запросы завершились с generated; raw и normalized сохранены отдельно. Сначала нормализация использует фактические PREAMBLE_PATTERNS из websocket.ts, затем normalizeSuggestion. Успех модели не равен доставке на экран.</p><p>Исторические 1–2 реконструированы из сохранённого диагностического транскрипта: последние 10 сообщений через Guest #9 и #19 соответственно. Это не сохранённый original model request. Недоступные profile/cards/Strategy Memory оставлены пустыми одинаково для обоих вариантов; будущие реплики не переданы. Сценарии 3–8 синтетические и явно отмечены. General brainHarness не использовался: у него другой envelope/schema/лимит, несопоставимые с ordinary LIVE.</p><p>Оценка — ручная по явному критерию и итоговому нормализованному тексту. Наличие строк в prompt или mock-ответов не считается доказательством поведения.</p></section>${sections}<section><h2>Регрессии, побочные эффекты и риски</h2><p><b>120/120</b> тестов в 8 файлах прошли; <code>npx tsc --noEmit</code> — exit 0. Проверены grounding, goal priority, objection, adaptive types, strategy memory, Ask refine, provider и новые фактически собранные system/user в обеих настройках перевода с пустым/непустым Goal. Это детерминированные проверки, отдельно от ответов выше. Предупреждение baseline-browser-mapping об устаревших данных не является падением теста.</p><p><b>Аудит общих констант:</b> GOAL_PRIORITY_RULES/LIVE_GROUNDING_RULES также используются buildLiveChatSystemPrompt, buildAskRefinePrompt и realtime/ask-assistant в websocket.ts; они наследуют новые общие правила. LIVE_ANTI_LOOP_RULES используется также first-phrase endpoint в server/routes.ts. Эти пути отдельно не переписаны, модельные тесты Ask/first phrase/Tutor не проводились; это остаётся риском общих констант. TRAINING ANTI_LOOP_RULES, training templates и форматы не менялись.</p><p>Candidate увеличил prompt примерно на 500 токенов, что может повлиять на стоимость/скорость; отдельные elapsedMs из этого последовательного прогона не доказывают ускорение. Parser всё ещё способен срезать предложения на “Let me…” — он не менялся по границам задачи; финальная просьба “Could you…” пережила нормализацию. Existing library, wait, stale/dedup/cooldown фильтры способны обойти/подавить результат, поэтому исчезающие подсказки этим экспериментом не объявляются исправленными.</p><p><b>Следующий шаг:</b> после отдельного согласования выпуска предложить один контрольный исходящий звонок пользователя. Не запускать и не публиковать автоматически. Если необходима статистическая уверенность до выпуска, отдельно согласовать повторные прогоны, а не выдавать этот единичный результат за гарантированное поведение.</p><p>Машиночитаемое доказательство: <code>reports/live-conversation-experiment.json</code>; воспроизводимый offline runner: <code>script/live-conversation-experiment.ts</code>. Baseline capture защищён от перезаписи.</p></section></main></html>`);
    console.log("Wrote self-contained report and manual per-criterion assessments.");
    return;
  }
  const revised = process.argv[2] === "revise";
  if (process.argv[2] !== "run" && !revised) throw new Error("Use capture, run or revise");
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!revised && data.cases.some((c: any) => c.baselineResult)) throw new Error("Results exist; refusing to overwrite baseline evidence");
  const model = process.env.HINT_MODEL || "gpt-5.6-terra";
  if (model.startsWith("gemini")) throw new Error("Configured LIVE model is Gemini; this OpenAI-only comparison refuses substitution.");
  data.model = model;
  data.modelSource = "HINT_MODEL environment or code default; process-wide UI override / per-call override not observed in this offline run.";
  data.settings = { ...buildOpenAIChatBody(model, "", "", 250), messages: undefined };
  data.candidateSourceHash = hash(readFileSync("shared/prompts.ts", "utf8"));
  data.ranAt = new Date().toISOString();
  for (const c of data.cases) {
    if (revised) {
      if (c.firstCandidateResult) throw new Error("Only one bounded correction is allowed");
      c.firstCandidate = c.candidate;
      c.firstCandidateTranslationOff = c.candidateTranslationOff;
      c.firstCandidateResult = c.candidateResult;
    }
    c.candidate = assembly(c, true);
    c.candidateTranslationOff = assembly(c, false);
    for (const variant of revised ? ["candidate"] : ["baseline", "candidate"]) {
      const request = buildOpenAIChatBody(model, c[variant].system, c[variant].user, 250);
      let result: Record<string, unknown>;
      const start = Date.now();
      try {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY unavailable; model evaluation not run");
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify(request), signal: AbortSignal.timeout(30_000),
        });
        const body = await response.json() as any;
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message || "provider error"}`);
        const raw = body.choices?.[0]?.message?.content || "";
        const matched = raw.match(/\{[\s\S]*\}/);
        const parsed = matched ? JSON.parse(matched[0]) : null;
        result = { raw, finishReason: body.choices?.[0]?.finish_reason,
          normalized: normalizeSuggestion(parsed?.suggestion, { translateEnabled: true, stripPreamble }),
          usage: body.usage, elapsedMs: Date.now() - start, status: "generated" };
      } catch (error) {
        result = { status: "untested", error: String((error as Error).message), elapsedMs: Date.now() - start };
      }
      c[`${variant}Result`] = result;
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      console.log(c.id, variant, result.status);
    }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });