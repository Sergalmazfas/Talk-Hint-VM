import type { ProjectModelState } from "./projectModel";
import { analystCompetitors, type AnalystPreparationInput, type AnalystSource } from "./competitiveAnalyst";
import { analystSourceChecks, analystExtraSourceProposals } from "./competitiveAnalystSourceChecks";

function sourceKind(url: string): AnalystSource["kind"] {
  if (/apps\.apple\.com|play\.google\.com/.test(url)) return "app_store";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/instagram\.com/.test(url)) return "instagram";
  if (/changelog|release.note/.test(url)) return "changelog";
  if (/pricing|\/plans|\/tariff/.test(url)) return "pricing";
  if (/help\.|\/help|\/docs|documentation/.test(url)) return "documentation";
  return "other";
}
/** Projection from canonical cards; never creates competitors or writes on read. */
export function defaultAnalystPreparation(state: ProjectModelState): AnalystPreparationInput {
  const products = analystCompetitors(state), sources: AnalystSource[] = [];
  for (const { record, domain, appId } of products) {
    if (!record) continue;
    const s = record.revisions.at(-1)!.snapshot;
    const urls = Array.from(new Set([s.website, s.appStore, ...s.sources.map(x => x.url)].filter(Boolean)));
    for (const url of urls) {
      let own = false;
      try { const h = new URL(url).hostname; own = h === domain || h.endsWith(`.${domain}`) || url === s.appStore; } catch { /* validation reports unsafe card URLs */ }
      const kind = url === s.website ? "website" : sourceKind(url);
      const check = analystSourceChecks[url.replace(/\/$/, "")];
      sources.push({ id: `${record.id}:${sources.length}`, competitorId: record.id, url, kind,
        ownership: own ? "documented" : "unverified",
        ownershipEvidence: own ? "Домен продукта или точная страница магазина из существующей карточки; связь перенесена, новая проверка содержимого не выполнена." : "Источник из существующей карточки; принадлежность конкуренту отдельно не подтверждена.",
        approval: "pending", recommendation: own ? "include" : "hold",
        checkedAt: check?.checkedAt ?? null, availability: check ? "public" : "unchecked",
        note: check?.note ?? "Импорт ссылки, не новое исследование. Требует согласования; прежняя проверка остаётся в карточке." });
    }
    for (const proposal of analystExtraSourceProposals.filter(p => p.appId === appId))
      if (!sources.some(x => x.competitorId === record.id && x.url === proposal.url))
        sources.push({ id: `${record.id}:proposal:${sources.length}`, competitorId: record.id, url: proposal.url,
          kind: proposal.kind, ownership: proposal.ownership, ownershipEvidence: proposal.evidence,
          approval: "pending", recommendation: proposal.ownership === "documented" ? "include" : "hold",
          checkedAt: null, availability: "unchecked", note: "Предложен при подготовке реестра; канал не просмотрен и не согласован для наблюдения." });
    for (const kind of ["youtube", "instagram"] as const)
      if (!sources.some(x => x.competitorId === record.id && x.kind === kind))
        sources.push({ id: `${record.id}:${kind}:unknown`, competitorId: record.id, kind, url: null,
          ownership: "unverified", ownershipEvidence: "Официальный аккаунт не установлен.", approval: "pending",
          recommendation: "hold", checkedAt: null, availability: "unchecked", note: "Не добавлять найденный одноимённый аккаунт без проверки принадлежности." });
  }
  const pilotId = products.find(p => p.appId === "6758815817")?.record?.id ?? null;
  return {
    passport: {
      purpose: "Поддерживать доказательные и сопоставимые карточки пяти согласованных конкурентов; отслеживать изменения предложения и публичных планов развития. Клиент и получатель — Сергей, владелец TalkHint.",
      duties: "Исследовать согласованные открытые источники; заполнять шесть существующих разделов; проверять доказательства и противоречия; фиксировать изменения функций, цен и покрытия; сохранять историю; обновлять производные сравнения и выдавать отчёт Сергею.",
      inputs: "ID владельца и new-country; ID конкурента и версия карточки; согласованный реестр URL и вопросы; методика шести разделов, сравнения и карты; границы доступа, лимиты и предыдущий checkpoint. Личные оценки — только для чтения при наличии разрешения, никогда для заполнения.",
      outputs: "Проверенные материалы и ограничения; факты с доказательствами; сравнение «было/стало»; одна запись находки с несколькими связями; сохранённая версия в общей модели и повторное чтение; отчёт Сергею с вопросами, usage и оценкой затрат.",
      frequency: "Предлагается один ручной пилот после согласования. Расписание выключено. Квартальный процесс — отдельное решение после оценки пилота.",
      quality: "У каждого существенного факта источник, дата, применимость и степень подтверждения; неизвестное не равно отсутствию. Различать рекламу, анонс, демо, заявление о релизе, личный тест и предположение. Все цены с каналом/периодом/валютой, без недоказанных конверсий кредитов. Не терять историю; повтор не создаёт дубль.",
      handoff: "Передать Сергею: противоречащие источники, неизвестную принадлежность канала, закрытый материал, новые доступы/расходы, превышение лимита, конфликт версий, сомнение в факте, предложение изменения стратегии. Других сотрудников пока нет.",
    },
    limits: { maxMinutes: 10, maxEstimatedUsd: 1, maxSources: 6, maxSearches: 3, maxAttempts: 2, maxOutputTokens: 4000, maxVideoSeconds: 180 },
    sources,
    pilot: { competitorId: pilotId,
      sourceIds: sources.filter(s => s.competitorId === pilotId && ["website", "documentation", "pricing", "changelog", "app_store"].includes(s.kind) && s.recommendation === "include").slice(0, 6).map(s => s.id),
      rationale: "Предлагается VocaLingo: в существующей карточке есть сайт, справка, тарифы, журнал изменений и магазин. Достаточность фактического доступа проверяется перед пилотом; это не выбор лидера и не новый конкурент.",
      questions: "Что изменилось в функциях и опубликованных ценах относительно текущей версии? Есть ли изменение языков/направлений? Какие объявления подтверждены выпуском, а какие остаются демо или планом? Какие противоречия требуют решения Сергея?" },
    approvalNotes: "Нужно согласовать паспорт, источники пилота, доступы и расходы. Рабочий запуск и запись фактов агентом ещё не подключены. Прежний CrewAI-проект здесь недоступен; его переиспользование не проверено.",
    toolResearchVersion: "2026-10-25",
  };
}
