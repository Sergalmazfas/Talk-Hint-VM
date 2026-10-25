import { baseCompetitor, claim, pricePlan, suppliedFact, unknown, unknownLiveTechnology } from "./competitorDataHelpers";
export const lingvanexWebsite = "https://lingvanex.com/products/phone-call-translator/";
export const lingvanexAppStore = "https://apps.apple.com/us/app/live-ai-phone-call-translator/id1367461351";
export function lingvanexSnapshot() {
  const snapshot = baseCompetitor("Lingvanex — Phone Call Translator", "Nordicwise Limited", lingvanexWebsite, lingvanexAppStore);
  const research = snapshot.research!, dossier = snapshot.dossier!;
  snapshot.offer = {
    features: "Перевод звонков; самостоятельные исходящие поручения AI Companion; второй номер US/Canada в Premium; входящие с переводом; SMS с переводом; транскрипция и итоги.",
    languages: "70+ языков именно перевода звонков; русский и испанский официально заявлены. Региональные варианты учитываются отдельно.",
    regions: "Направления звонков: сайт 150+ стран, App Store 160. Это не география регистрации сервиса и не доказательство присутствия клиентов.",
    numbers: "Второй номер US/Canada для Premium; доступен с первого оплаченного периода. Прочие страны номеров не подтверждены.",
    channels: "iPhone/iPad и Android; автономный входящий секретарь и генерация подсказок не подтверждены.",
  };
  for (const [feature, note] of Object.entries({
    translation: "Двусторонний перевод обычных телефонных звонков в реальном времени.",
    secretary_outgoing: "AI Companion самостоятельно звонит по заданию и ведёт разговор; пользователь может вмешаться.",
    dedicated_number: "Premium: второй телефонный номер US/Canada; это не подтверждение независимых рабочих и личных профилей.",
    sms: "SMS с переводом для номеров US/Canada; ставка и включённые объёмы не подтверждены.",
  })) research.features[feature as keyof typeof research.features] = claim(lingvanexWebsite, note);
  research.features.incoming = unknown("Входящий перевод не равен самостоятельному входящему секретарю", lingvanexWebsite);
  research.features.live_hints = unknown("Субтитры и транскрипция не доказывают генерацию подсказок ответа", lingvanexWebsite);
  research.features.history = unknown("Транскрипция и итог заявлены, но сохранённая история как отдельная функция требует проверки.", lingvanexWebsite);
  research.autonomy = { mode: "confirmed_tasks", evidence: claim(lingvanexWebsite, "По описанию AI Companion выполняет подтверждённое исходящее поручение. Это официальное заявление, не результат нашего звонка.") };
  research.languages = [{
    feature: "translation", count: 70, countQualifier: "at_least", russian: "yes", spanish: "yes",
    evidence: claim(lingvanexWebsite, "70+ языков перевода звонков; русский и варианты испанского перечислены официально. Не переносить на все инструменты."),
  }];
  research.geography.phoneNumbers = ["US", "Canada"].map(region => ({
    region, evidence: claim(lingvanexWebsite, "Второй номер в Premium; не доказательство страны проживания клиентов или глобальной доступности регистрации."),
  }));
  dossier.coverageFacts = [
    suppliedFact("site-destinations", "Направления звонков по сайту", "150+ стран", lingvanexWebsite, "Направления дозвона, не присутствие клиентов и не список стран доступности сервиса."),
    suppliedFact("store-destinations", "Направления звонков по US App Store", "160 стран", lingvanexAppStore, "Расхождение с сайтом (150+) сохраняется; определения и актуальность списка требуют сверки."),
  ];
  dossier.offerFacts = [
    suppliedFact("ai-companion", "AI Companion", "Самостоятельно позвонить по поручению: забронировать стол, отменить заказ, подтвердить встречу; владелец может вмешаться.", lingvanexWebsite),
    suppliedFact("translated-incoming", "Входящий перевод", "Звонки на номер Premium принимаются в приложении с переводом; автономный входящий приём поручений не подтверждён.", lingvanexWebsite),
    suppliedFact("transcript-summary", "Транскрипция и итог", "Официально заявлены; это не генерация ответных подсказок.", lingvanexWebsite),
  ];
  snapshot.plans = [
    pricePlan("ling-week", "Week Subscription", 9.99, "week", lingvanexAppStore, "US App Store"),
    pricePlan("ling-year", "Year", 69.99, "year", lingvanexAppStore, "US App Store"),
    ...[[10, 14.99], [20, 29.99], [50, 74.99]].map(([amount, price]) =>
      pricePlan(`ling-coins-${amount}`, `${amount} COINS`, price, "one_time", lingvanexAppStore, "US App Store", { unit: "coins", amount })),
  ];
  dossier.pricingNotes = [
    suppliedFact("call-without", "Звонок без перевода", "От 0.08 credits/мин для ряда направлений", lingvanexWebsite, "Ставка зависит от направления; это credits, не COINS и не доллары."),
    suppliedFact("call-with", "Звонок с переводом", "От 0.19 credits/мин для ряда направлений", lingvanexWebsite, "US, Canada, UK и большая часть Европы упомянуты как примеры. Не универсальная ставка."),
    { id: "unit-conversion", title: "COINS ≠ credits", value: null, evidence: unknown("Официальное правило связи COINS из IAP и credits в минутных тарифах не подтверждено; долларовую минуту не вычислять.", lingvanexWebsite) },
    { id: "companion-sms-cost", title: "AI Companion / SMS", value: null, evidence: unknown("Ставки самостоятельных поручений, SMS и включённые объёмы не подтверждены.", lingvanexWebsite) },
  ];
  dossier.technical = unknownLiveTechnology(lingvanexWebsite);
  return snapshot;
}
