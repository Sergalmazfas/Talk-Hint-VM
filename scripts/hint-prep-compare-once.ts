import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AnthropicCrewProvider } from "../server/aiCrew/anthropic";

const dir = "generated-artifacts/hint-prep";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function main() {
  if (process.argv[2] !== "--compare-once") throw Error("EXPLICIT_COMPARE_ONCE_REQUIRED");
  const plan = await readFile(`${dir}/frozen-plan.json`, "utf8");
  const manifest = JSON.parse(await readFile(`${dir}/freeze-manifest.json`, "utf8"));
  const access = JSON.parse(await readFile(`${dir}/comparison-access.json`, "utf8"));
  if (hash(plan) !== manifest.sha256 || access.planSha256 !== manifest.sha256)
    throw Error("FROZEN_PLAN_CHANGED");
  // Semantic observations from saved STT, not verified audio. No names, contacts,
  // serial numbers, locations or third-party personal data cross into the model.
  const observations = [
    { id: "G1", group: "greeting", question: "Чем могу помочь?",
      ownerReply: "Запрос новой шины нужного размера, наличия и цены; STT исказил вопрос как утверждение.",
      uncertainty: "STT, не проверено по звуку" },
    { id: "G2", group: "substantive", question: "Повторите размер шины.",
      ownerReply: "Владелец повторил 295/75 R22.5.", uncertainty: null },
    { id: "G3", group: "substantive", question: "Что именно хотите получить?",
      ownerReply: "Владелец просит одну новую шину из имеющихся.", uncertainty: null },
    { id: "G4", group: "substantive", question: "Шина для прицепа, ведущей или рулевой оси?",
      ownerReply: "Для прицепа.", uncertainty: null },
    { id: "G5", group: "substantive", question: "Одна прицепная шина, верно?",
      ownerReply: null, uncertainty: "Отдельной реплики владельца в расшифровке нет." },
    { id: "G6", group: "substantive", question: "Какую марку хотите: известный бренд или самый дешёвый вариант?",
      ownerReply: "Средний, доступный вариант: не самый дешёвый и не самый дорогой.", uncertainty: null },
  ];
  const excluded = [
    { id: "B1", subject: "номера на планках/серийный номер", reason: "Похоже на посторонний разговор; связь с запросом шины не установлена." },
    { id: "B2", subject: "запись спереди, старые или новые номера, уточнение номера", reason: "Похоже на посторонний разговор; личные номера не перенесены." },
    { id: "B3", subject: "аккумуляторы и их характеристики", reason: "Другой предмет разговора; принадлежность владельцу не подтверждена." },
  ];
  const criteria = {
    primary: "Пять содержательных вопросов G2–G6, включая переспрашивание и подтверждение; каждый вопрос = одна строка, не дробить.",
    coverage: "Вопрос предсказан, если в замороженном плане есть его конкретная тема. Общая фраза «что хотите» не заменяет темы количества/марки/оси.",
    answers: "Строго полное смысловое совпадение готового конкретного ответа из плана с ответом владельца. Уточнение/unknown не совпадение; частичное не полное. G5 без ответа: неизвестно, не успех.",
    denominator: "Основная готовность = полные совпадения / 5 всех содержательных вопросов. Дополнительно = полные совпадения / 4 вопросов с записанным ответом.",
    greeting: "G1 отдельной строкой, но не завышает основные две метрики.",
    uncertainty: "STT не верифицирован; B1–B3 не включать в основной знаменатель, показать причины, не считать, что их точно не было.",
    selection: "Одна заранее выбранная запись; не обобщать на корпус. Нельзя доказать выигрыш задержки без аудиопрогона.",
  };
  const request = {
    task: "Независимая критическая сверка лабораторной гипотезы. Ты не принимаешь работу за владельца. Ответ на русском, до 2000 слов. Не перепечатывай реплики звонка, только смысл. Построй таблицу G1–G6: тема, ID плана, предсказано ли, какой конкретный готовый ответ или отсутствует, смысл ответа владельца, полное/частичное/нет/неизвестно. Посчитай метрики по фиксированным критериям. Найди домыслы самого плана (особенно количественные, обещания и полномочия). Сравни план, а не придуманный улучшенный вариант. В конце: гипотеза подтверждена/частично/нет, промахи, что требуется реальному опроснику. Не предлагай включать продукт по одной записи.",
    frozenPlan: JSON.parse(plan), criteria, observations, excluded,
  };
  const ledgerPath = `${dir}/experiment-costs.json`;
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  if (ledger.some((e: any) => e.stage === "independent-comparison")) throw Error("ALREADY_RESERVED_NO_RETRY");
  const text = JSON.stringify(request);
  const reservedMicroUsd = (Buffer.byteLength(text) + 10000) * 4 + 4000 * 20;
  if (ledger.reduce((n: number, e: any) => n + (e.actualMicroUsd ?? e.reservedMicroUsd), 0) + reservedMicroUsd > 3_000_000)
    throw Error("BUDGET_REFUSED");
  const entry: any = { stage: "independent-comparison", status: "reserved", reservedMicroUsd,
    at: new Date().toISOString(), inputHash: hash(text), model: "claude-opus-5-5" };
  ledger.push(entry);
  await writeFile(`${dir}/comparison-criteria.json`, JSON.stringify({ criteria, observations, excluded,
    at: entry.at, planSha256: manifest.sha256 }, null, 2), { flag: "wx" });
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  try {
    const result = await new AnthropicCrewProvider().message(entry.model, text, 4000, AbortSignal.timeout(180000));
    entry.status = "spent"; entry.usage = result.usage; entry.http = result.http;
    entry.actualMicroUsd = result.usage.input_tokens * 4 + result.usage.output_tokens * 20;
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
    await writeFile(`${dir}/independent-comparison.json`, JSON.stringify(result, null, 2), { flag: "wx" });
    if (!result.text.trim()) throw Error("EMPTY_REVIEW_NO_RETRY");
    console.log(JSON.stringify({ planSha256: manifest.sha256, spentMicroUsd:
      ledger.reduce((n: number, e: any) => n + (e.actualMicroUsd ?? e.reservedMicroUsd), 0) }));
  } catch (e) {
    if (entry.status !== "spent") entry.status = "unknown";
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
    throw e;
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "COMPARISON_FAILED"); process.exitCode = 1; });
