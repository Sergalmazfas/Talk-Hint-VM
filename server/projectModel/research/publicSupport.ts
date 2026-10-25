import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { SupportFact, SupportResearch } from "../../../shared/competitorAssessments";
import { supportResearchSchema } from "../assessmentSchema";
import { persistModelUpdate } from "../materialImport";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";

// Manually checked public pages, not a support conversation or a scheduled scraper.
const checkedAt = "2026-10-25";
const fact = (value: string, url: string, note: string, status: SupportFact["status"] = "official_claim"): SupportFact =>
  ({ value, sourceUrls: [url], note, status, checkedAt });
const unknown = (url: string, note: string): SupportFact => ({ value: null, sourceUrls: [url], note, status: "unknown", checkedAt });
function base(url: string): SupportResearch {
  return {
    channels: unknown(url, "Проверены публичные страницы; доступность каналов требует уточнения."),
    hours: unknown(url, "График и часовой пояс поддержки не установлены; это не утверждение об отсутствии поддержки."),
    languages: unknown(url, "Языки интерфейса и перевода не подтверждают языки операторов поддержки."),
    responseTimes: unknown(url, "Публичный гарантированный срок ответа для этого приложения не найден."),
    knowledgeBase: unknown(url, "Наличие отдельной базы помощи не установлено."),
    humanAgent: unknown(url, "Порядок доступа к сотруднику и эскалации от бота публично не подтверждён."),
    helpdesk: unknown(url, "Система обработки обращений не установлена. Наличие email не раскрывает helpdesk."),
    knowledgePlatform: unknown(url, "Поставщик базы знаний не установлен."),
    crm: unknown(url, "Внутренняя CRM не раскрыта; сайт, email, телефония и helpdesk не доказывают CRM."),
  };
}
const voca = "https://help.vocalingo.app/en";
const ling = "https://lingvanex.com/support/";
const call = "https://1aicall.com/contact";
const phone = "https://www.aiphone.ai/contactus";
const guardian = "https://www.guardianly.ai/privacy";
export const publicSupportResearch: Record<string, SupportResearch> = {
  "6758815817": {
    ...base(voca),
    channels: fact("support@vocalingo.app для проблем оплаты; info@vocalingo.app для общих вопросов; публичная доска обратной связи.", "https://help.vocalingo.app/en/articles/0977527-payment-didnt-go-through",
      "Статья направляет в support с чеком. Главная страница https://www.vocalingo.app/en указывает info@vocalingo.app. Доска идей — не доказательство живого чата."),
    knowledgeBase: fact("Публичный Help Center: инструкции, платежи, звонки, устранение неполадок.", voca, "Просмотрены каталог и статья о проблемах оплаты; контакт с поддержкой не выполнялся."),
    knowledgePlatform: fact("Featurebase — явная подпись «Powered by Featurebase» в футере Help Center.", voca,
      "Проверен HTML: футер с публичной ссылкой featurebase.app и маркировкой Featurebase. Это устанавливает платформу этой базы, не внутреннюю CRM и не живой чат."),
    responseTimes: unknown("https://www.vocalingo.app/en", "На сайте есть Priority support для Premium, но точный SLA/срок ответа не указан. Приоритет — не измеренное время и не обещание 24/7."),
  },
  "1367461351": {
    ...base(ling),
    channels: fact("Форма Contact Support; на странице заявлен «Chat with Lingvanex».", ling, "Публичная форма и подпись чата просмотрены. Сообщения не отправлялись; бот/сотрудник, скорость и доступность не проверялись."),
    helpdesk: fact("FreshChat упомянут в cookie-настройках сайта.", ling,
      "Публичная страница включает пункт FreshChat со ссылкой Freshworks GDPR. Только технический признак сайта, не доказательство маршрутизации обращений Phone Call Translator, рабочего чата или внутренней CRM.", "observed_signal"),
  },
  "6744344005": {
    ...base(call),
    channels: fact("Форма Talk to the team; support@1aicall.com для поддержки и запросов по данным.", call,
      "Форма просмотрена без отправки. Email подтверждён Privacy Policy https://1aicall.com/privacy (Last updated April 27, 2026)."),
    responseTimes: fact("«We reply within one business day» — один рабочий день.", call,
      "Публичное обещание страницы Contact, не результат нашего обращения. Часы/часовой пояс, фактический ответ и решение не проверены."),
  },
  "6465173251": {
    ...base(phone),
    channels: fact("Вопросы по приложению: Settings → Feedback. info@aiphone.ai — сотрудничество, правовые и прочие общие обращения.", phone,
      "Сайт разделяет обратную связь внутри приложения и email общего назначения; email не выдаётся за выделенную линию технической поддержки."),
    knowledgeBase: fact("Публичные FAQs и User Guides в блоге.", "https://www.aiphone.ai/blog/faqs/",
      "Сайт Contact Us ссылается на FAQs и Guides; страница FAQ прочитана. Это не подтверждает живого оператора или отдельную платформу helpdesk."),
  },
  "6747626007": {
    ...base(guardian),
    channels: fact("support@guardianly.ai — техническая поддержка и вопросы данных; отдельная веб-форма Contact.", guardian,
      "Privacy Policy явно называет email для technical support. Просмотрена форма https://www.guardianly.ai/contact; отправки не было."),
    helpdesk: unknown(guardian, "Policy раскрывает SendGrid для email communications and support messaging. SendGrid — email-транспорт, не подтверждение полноценного helpdesk, базы знаний или CRM."),
  },
};
// Additional source for each compound channel fact is stored explicitly, not only in prose.
publicSupportResearch["6758815817"].channels!.sourceUrls.push("https://www.vocalingo.app/en", "https://vocalingo.featurebase.app");
publicSupportResearch["6744344005"].channels!.sourceUrls.push("https://1aicall.com/privacy");
publicSupportResearch["6747626007"].channels!.sourceUrls.push("https://www.guardianly.ai/contact");

/** Explicit Dev import into the existing owner-keyed store. Never called at boot. */
export async function persistPublicSupport(pool: Pool, owner: string) {
  if (process.env.NODE_ENV !== "development") throw new Error("Public support import is Dev-only");
  let changed = 0;
  const state = await persistModelUpdate(pool, owner, root => {
    const before = readHypothesis(root, "new-country");
    let next = root;
    const records = before.competitorDirectory?.records ?? [];
    for (const [appId, data] of Object.entries(publicSupportResearch)) {
      const matches = records.filter(r => r.revisions.at(-1)?.snapshot.appStore.match(/\/id(\d+)/)?.[1] === appId);
      if (matches.length !== 1) throw new Error("Exactly one existing competitor required");
      const record = matches[0], current = record.revisions.at(-1)!;
      supportResearchSchema.parse(data);
      // Re-running this one-off import must not duplicate revisions.
      if (isDeepStrictEqual(current.snapshot.supportResearch, data)) continue;
      if (current.snapshot.supportResearch && Object.keys(current.snapshot.supportResearch).length)
        throw new Error("Existing support facts differ; manual merge required, no replacement performed");
      next = applyHypothesisCommand(next, "new-country", {
        type: "saveCompetitorSupport", id: record.id, baseVersion: current.version, support: data,
      }, owner);
      changed++;
    }
    const after = readHypothesis(next, "new-country");
    const strip = (snapshot: typeof records[number]["revisions"][number]["snapshot"]) => {
      const { supportResearch: _, ...rest } = snapshot; return rest;
    };
    if (!isDeepStrictEqual(root.elements, next.elements) || !isDeepStrictEqual(root.documents, next.documents) ||
      !isDeepStrictEqual(root.relations, next.relations) || root.primaryHypothesisId !== next.primaryHypothesisId ||
      !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== "new-country"), next.alternatives?.filter(a => a.id !== "new-country")) ||
      !isDeepStrictEqual(before.elements.filter(e => e.id !== "TH-PILOT-COMPETITORS"), after.elements.filter(e => e.id !== "TH-PILOT-COMPETITORS")) ||
      !isDeepStrictEqual(before.documents, after.documents) || !isDeepStrictEqual(before.relations, after.relations) ||
      !isDeepStrictEqual(before.competitorDirectory?.talkhint, after.competitorDirectory?.talkhint) ||
      !isDeepStrictEqual(before.competitorDirectory?.quarters, after.competitorDirectory?.quarters) ||
      records.some(record => {
        const saved = after.competitorDirectory?.records.find(r => r.id === record.id);
        if (!saved) return true;
        return !isDeepStrictEqual(saved.revisions.slice(0, record.revisions.length), record.revisions) ||
          !isDeepStrictEqual(strip(record.revisions.at(-1)!.snapshot), strip(saved.revisions.at(-1)!.snapshot));
      })) throw new Error("Public support import preservation guard failed");
    return next;
  }, true);
  return { changed, revision: state.revision, completeReadback: true, otherMaterialsPreserved: true };
}
