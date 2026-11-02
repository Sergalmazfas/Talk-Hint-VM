/**
 * Explicit manual hypothesis, never imported by the app or workers.
 * Preparation has NO transcript input or call-file access.
 * No retries: a reserved/unknown stage cannot be rerun automatically.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { AnthropicCrewProvider } from "../server/aiCrew/anthropic";

const out = "generated-artifacts/hint-prep";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const goal = "Узнать, есть ли в наличии новая шина размера 295/75 R22.5, и уточнить ее цену. Если шина есть, договориться о покупке или резерве.";
// No owner card supplied for this experiment. Never infer private facts or preferences.
const ownerCard = { status: "не предоставлена", permittedFacts: {},
  missing: ["позиция оси", "количество", "марка", "бюджет", "место и время", "нужен ли монтаж", "данные оплаты"] };
const sources = [
  { url: "https://www.apollotires.us/content/dam/orbit/usa/us-truck-tires/cv-usa/DIGITAL%20TBR%20TECHN.%20DATABOOK%202025%20NEW%20STYLE%20US.pdf",
    observed: "Поисковая выдержка производителя различает назначения All Position / Steer и размер 295/75R22.5 с нагрузкой 14/G и 16/H. Полный PDF не проверен." },
  { url: "https://www.toyotires.com/media/e1fcxsur/2021_commerical_databook_v8.pdf",
    observed: "Поисковая выдержка производителя: application chart, load limits, load and inflation tables. Не источник текущей цены или наличия." },
];
type Expense = { stage: string; status: "reserved" | "spent" | "unknown";
  reservedMicroUsd: number; actualMicroUsd?: number; at: string; inputHash: string;
  usage?: unknown; http?: unknown };

async function main() {
  if (process.argv[2] !== "--prepare-once") throw Error("Explicit --prepare-once required; this script never opens transcripts");
  await mkdir(out, { recursive: true });
  const ledgerPath = `${out}/experiment-costs.json`;
  let ledger: Expense[] = [];
  try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
  if (ledger.length) throw Error("EXPERIMENT_ALREADY_STARTED_NO_RETRY");
  const seed = { version: "P.PREP-hypothesis-v1", goal, ownerCard, sources,
    budgetMicroUsd: 3_000_000, model: "claude-sonnet-5-5", ratesMicroUsdPerToken: { input: 2, output: 10 },
    isolation: "Three stateless requests; only question/simulation/plan data. No transcript or history.",
    limitation: "Coordinator previously saw a call analysis; model generation is isolated. Owner card missing." };
  const seedText = JSON.stringify(seed, null, 2);
  await writeFile(`${out}/blind-input.json`, seedText, { flag: "wx" });
  const provider = new AnthropicCrewProvider();
  async function stage(name: string, input: object) {
    const text = JSON.stringify(input);
    // Very conservative ceiling: <= one input token per UTF-8 byte plus fixed system overhead.
    const reservedMicroUsd = (Buffer.byteLength(text) + 10_000) * 2 + 3000 * 10;
    if (Buffer.byteLength(text) > 30_000 ||
        ledger.reduce((n, e) => n + (e.actualMicroUsd ?? e.reservedMicroUsd), 0) + reservedMicroUsd > seed.budgetMicroUsd)
      throw Error("BUDGET_REFUSED_BEFORE_REQUEST");
    const entry: Expense = { stage: name, status: "reserved", reservedMicroUsd,
      at: new Date().toISOString(), inputHash: sha(text) };
    ledger.push(entry);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
    await writeFile(`${out}/${name}-request.json`, text, { flag: "wx" });
    try {
      const result = await provider.message(seed.model, text, 3000, AbortSignal.timeout(180000));
      entry.status = "spent";
      entry.actualMicroUsd = result.usage.input_tokens * 2 + result.usage.output_tokens * 10;
      entry.usage = result.usage; entry.http = result.http;
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      await writeFile(`${out}/${name}-response.json`, JSON.stringify(result, null, 2), { flag: "wx" });
      if (!result.text.trim()) throw Error("EMPTY_RESPONSE_NO_RETRY");
      return result.text;
    } catch (e) {
      if (entry.status !== "spent") entry.status = "unknown";
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      throw e;
    }
  }
  const questionnaire = await stage("questionnaire", {
    task: "Ты Мастер подготовки звонка, опыт, не продукт. Только по цели и выдержкам составь ровно 3–5 вопросов владельцу перед звонком. Русский текст. Никаких ответов и вымышленных сведений. Не задавай вопрос, ответ на который буквально есть в цели.",
    goal, sources,
  });
  const simulated = await stage("simulated-owner", {
    task: "Ответь на опросник за владельца. Это СМОДЕЛИРОВАНО, не слова реального владельца. Видишь только цель и разрешённую карточку. Не придумывай ось, марку, бюджет, количество, местоположение или сроки. Если сведений нет, буквально ответь «неизвестно — спросить владельца». Не используй интернет, план или транскрипт. Каждый ответ пометь «смоделировано».",
    goal, ownerCard, questionnaire,
  });
  const plan = await stage("plan", {
    task: "Составь компактный план звонка по цели, источникам и смоделированному опроснику. Русский текст, готовые фразы по-английски. Нумерованный перечень ожидаемых ВОПРОСОВ СОБЕСЕДНИКА с устойчивыми ID Q1..Qn; для каждого готовый ответ и категория: подтверждён целью / смоделирован из карточки / неизвестно. Отдельно собственные вопросы владельца магазину и незакрытые вопросы к владельцу. Не смешивай вопросы владельца с прогнозом вопросов собеседника. Не выдумывай наличие, цену, ось, марку, количество, оплату. У неизвестных честно нет конкретного готового ответа: безопасное уточнение не считается совпадением. Не копируй личные данные. Заголовок: «Гипотеза v1 — ответы смоделированы». Только описательная лабораторная гипотеза.",
    goal, ownerCard, sources, questionnaire, simulated,
  });
  const frozen = { promptVersion: seed.version, generatedAt: new Date().toISOString(),
    goal, ownerCard, sources, questionnaire, simulated, plan, status: "proposed",
    transcriptAccess: false, coordinatorPriorExposure: true };
  const planBytes = JSON.stringify(frozen, null, 2) + "\n";
  await writeFile(`${out}/frozen-plan.json`, planBytes, { flag: "wx" });
  await writeFile(`${out}/freeze-manifest.json`, JSON.stringify({
    algorithm: "SHA-256", planFile: "frozen-plan.json", sha256: sha(planBytes),
    frozenAt: new Date().toISOString(), inputSha256: sha(seedText),
    questionnaireSha256: sha(questionnaire), simulatedAnswersSha256: sha(simulated),
    transcriptOpenedForComparisonAt: null,
    note: "Local timestamp is not an external timestamp authority; production journal anchoring is separate.",
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ frozen: true, sha256: sha(planBytes),
    spentMicroUsd: ledger.reduce((n, e) => n + (e.actualMicroUsd ?? e.reservedMicroUsd), 0) }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "EXPERIMENT_FAILED"); process.exitCode = 1; });
