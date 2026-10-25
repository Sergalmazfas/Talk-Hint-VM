import { baseCompetitor, claim, checkedDate, pricePlan, suppliedFact, unknown, unknownLiveTechnology } from "../competitorDataHelpers";
export function guardianlySnapshot() {
  const site = "https://www.guardianly.ai/", app = "https://apps.apple.com/us/app/id6747626007";
  const privacy = "https://www.guardianly.ai/privacy", tos = "https://www.guardianly.ai/tos";
  const rank = "https://apprank.io/ios/6747626007", method = "https://apprank.io/methodology";
  const s = baseCompetitor("Guardianly", "Guardianly Inc.", site, app), r = s.research!, d = s.dossier!;
  s.audience = "По позиционированию: защита пожилых/семей от мошенничества, специалисты, иммигранты и малый бизнес; второй номер и организация общения.";
  s.offer = {
    features: "Real-time scam warnings/blocking; ScamScan загруженных SMS/email/изображений; второй US-номер, обычные calls/SMS, forwarding, voicemail/transcription, summaries/action items/reminders, contact notes/history, live transcription/translation, Siri.",
    languages: "UI 6 локализаций. Scam detection: EN/ES/ZH/JA/KO (Simplified/Traditional ZH перечислены отдельно). Число языков live translation не подтверждено; ES указан, RU не подтверждён.",
    regions: "Сервис только United States; международные направления ограничены US/Canada по Terms 28.09.2025. Города/штаты клиентской базы не установлены.",
    numbers: "Новый US-номер на аккаунт; собственный номер через optional forwarding. Это не покупка номеров Канады или глобальная доступность.",
    channels: "iPhone/iPad; только US App Store по сайту. Android/web-клиент не подтверждены.",
  };
  for (const feature of ["secretary_outgoing", "incoming", "live_hints", "email", "calendar", "chat"] as const)
    r.features[feature] = unknown("Не подтверждено: screening/voicemail не автономный секретарь; scam alerts не generated reply hints; ScamScan загруженного email не почтовая интеграция; reminders не внешний календарь.", site);
  for (const [feature, note] of Object.entries({
    dedicated_number: "Новая US-линия с calls/SMS и разделением work/personal.",
    sms: "Отправка/приём через Guardianly US-номер; история и consent/opt-out tracking.",
    contacts: "Contact management, caller matching, notes к контакту и opt-in sync.",
    history: "Единая timeline звонков/messages/reminders; transcript/summary/action items хранятся локально по privacy; voicemail отдельно Twilio.",
    translation: "Real-time call transcription/translation официально заявлены. Точный набор языков и голосовая двусторонняя озвучка отдельно не проверены.",
  })) r.features[feature as keyof typeof r.features] = claim(feature === "history" || feature === "contacts" ? privacy : site, note);
  r.languages = [{ feature: "translation", count: null, russian: "unknown", spanish: "yes",
    evidence: claim(tos, "Terms: real-time translation/multi-language EN/ES/JA/KO/ZH; это не доказанный полный список телефонных языков. Число UI 6 не переносится на эту функцию.") }];
  r.geography.service = [{ region: "United States", evidence: claim(tos, "Сервис только US, часть возможностей может быть ограничена внутри US; дата Terms 28.09.2025.") }];
  r.geography.phoneNumbers = [{ region: "United States", evidence: claim(tos, "Один новый US-номер при регистрации; не обещание номеров Canada.") }];
  r.autonomy = { mode: "assist_only", evidence: claim(app, "Пользователь общается; AI предупреждает и делает summaries/follow-ups. Выполнение самостоятельных исходящих поручений/входящий приём не подтверждены.") };
  d.offerFacts.push(
    suppliedFact("full-offer", "Полное предложение",
      "Живой anti-scam анализ с визуальными/аудио-предупреждениями, blocking/unknown-only filtering; ScamScan загружаемого текста/изображений; собственный второй US-номер, SMS с opt-out/consent; forwarding главного номера, voicemail; полные transcripts/summary, notes, reminders и action items по контакту, Siri и notifications.",
      app, "Privacy/TOS датированы 28.09.2025. Авто-блокировка мошенника или voicemail не доказывают разговор автономного секретаря."),
    suppliedFact("languages-scope", "Языки по функциям",
      "6 UI-локализаций; scam detection EN/ES/Chinese (Simplified & Traditional)/JA/KO. Terms называют EN/ES/JA/KO/ZH для multi-language/translation. App Store «any language» без списка не подтверждает RU или неограниченное число телефонных языков.",
      app, "Разные функции/locale и язык не складываются в единый охват; качества перевода не тестировали."),
    suppliedFact("avatar-boundary", "Чат и аватар",
      "Privacy описывает ScamScan conversations/messages/analysis, но не универсальную помощницу с поручениями. Аватар-персонаж, визуальный образ, animation/3D/customization/voice-link/lipsync не подтверждены.",
      privacy, "Иконка, градиент и скриншоты предупреждений не доказательство живого аватара."),
    suppliedFact("development", "Датированное развитие",
      "02.09.2025 v1.1.7 — SMS enabled; 2025–2026 регулярные fixes; 03.03.2026 v1.4.0 и 17.06 v1.4.3 — generic improvements. Подробностей новых функций эти записи не дают.",
      app, "Не выводим рост пользователей, спрос или будущую международную экспансию из частоты обновлений.")
  );
  s.plans = [pricePlan("monthly", "Guardianly Premium Monthly", 9.99, "month", app, "US App Store"),
    pricePlan("annual", "Guardianly Premium Annual", 99.99, "year", app, "US App Store")];
  for (const plan of s.plans) {
    plan.includedNumbers = "Новый US-номер на аккаунт по Terms; стоимость дополнительных номеров не подтверждена";
    plan.overages = "Минуты/SMS и ставки превышения не опубликованы; forwarded calls могут оплачиватьcя мобильному оператору";
    plan.evidence!.sourceUrls.push(tos);
    plan.evidence!.note = "App Store перечисляет суммы; описание магазина и Terms от 28.09.2025 связывают $9.99 с месяцем и $99.99 с годом (~$8.33/мес при оплате года). Не обещание unlimited calls/SMS.";
  }
  d.pricingNotes.push(suppliedFact("limits-trial", "Trial, ScamScan и дополнительные платежи",
    "14-day free trial, описание магазина говорит no credit card required; проверить фактический Apple-flow позже. ScamScan: 30 free checks/мес; сайт говорит unlimited для подписчиков, Terms — unlimited OR higher limits по tier и ограничения abuse. Unlimited history/summaries не значит unlimited minutes. Возможна оплата переадресации своему оператору.",
    tos, "Периоды/суммы US USD подтверждены публично; минуты, SMS, дополнительные номера и overages неизвестны, не нулевые. Регистраций не делали."));
  d.coverageFacts.push(suppliedFact("coverage", "Четыре разные географии",
    "Сервис: US only. Выдаваемый номер: US. Направления звонков: US/Canada only, прочие по Terms не поддерживаются. Клиенты: независимой разбивки по стране/штату/городу нет; отзывы и адрес юрлица не доказательство клиентского присутствия.",
    tos, "Официальные ограничения от 28.09.2025, проверены 25.10.2026; маркетинговое multilingual не означает глобальную телефонию."));
  d.technical = unknownLiveTechnology(privacy).map(row => row.layer === "telephony" ? {
    ...row, provider: "Twilio (также возможны другие неназванные провайдеры)", evidence: claim(tos, "Прямо раскрыты VoIP calling/SMS infrastructure и voicemail на Twilio; не наш тест.")
  } : row);
  d.technical.push(
    { id: "call-analysis", layer: "llm", scope: "live_call", tool: "Call analysis, scam detection, summaries/action items", provider: "OpenAI; Google AI — точные модели не названы",
      evidence: claim(privacy, "В privacy 28.09.2025 audio/transcripts направляются этим AI services. Это анализ звонка, не доказательство модели автономного голосового секретаря или STT/TTS поставщиков.") },
    { id: "scamscan-ai", layer: "llm", scope: "file_tool", tool: "ScamScan uploaded image/text", provider: "Google AI; OpenAI",
      evidence: claim(privacy, "Область — загруженные файлы/текст для проверки мошенничества; не почтовая интеграция.") },
    { id: "cloud", layer: "technology", scope: "platform", tool: "Backend/ScamScan storage", provider: "Google Cloud Platform; Google Cloud Storage",
      evidence: claim(privacy, "Call content/SMS content локально, metadata/contacts/settings и ScamScan backend. Local storage не значит отсутствие cloud-AI обработки звонка.") },
    { id: "operational-email", layer: "technology", scope: "platform", tool: "Письма самого сервиса", provider: "SendGrid (Twilio); Apple APNs/PushKit/subscriptions",
      evidence: claim(privacy, "Операционные письма и системные интеграции, не управление почтовым ящиком пользователя. Ошибочный скопированный Apple-параграф в privacy не используем как доказательство Apple AI моделей.") }
  );
  d.scale.downloads = { value: "AppRank iOS: ≈1.0K downloads/month; точный месяц/дата сбора не показаны. Официального накопительного счётчика нет.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [rank, method],
      note: "Внешняя legacy-оценка, малое округлённое число может быть порогом. Apple 10 ratings ≠ 10 пользователей/скачиваний; Android-счётчика для этого продукта не найдено." } };
  d.scale.revenue = { value: "AppRank iOS: ≈$1.0K/мес; $12K annualized только ×12 run rate, не измеренный год.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [rank, method],
      note: "Не официальная отчётность. Нет точного месяца сбора/погрешности; распределение отзывов противоречит среднему рейтингу — осторожность с качеством агрегатора. Платящие и ARPU из этого не выводятся." } };
  d.revenueKind = "scenario"; d.revenueAssumptions = "Модель стороннего агрегатора по iOS; неизвестны период, точность, плательщики и тарифный микс. Никакой downloads×subscription или произвольной конверсии не применено.";
  s.limitations = "СТРАТЕГИЧЕСКИЙ ВЫВОД — наша интерпретация. Близость к целевому TalkHint — разделение work/personal, contact timeline, SMS, итоги/напоминания и языковая поддержка. Сильный отличительный фокус — scam protection семьи/пожилых, не самостоятельное выполнение голосовых поручений. Ценность истории/next actions можно сравнивать сценарно; преимущество TalkHint нельзя объявлять без одинакового теста. Из пяти это наиболее явно ограниченное US-only предложение, звонки лишь US/Canada; географического роста не доказано. Premium месяц/год и freemium ScamScan — понятная схема, но включённый расход звонков/SMS требует экрана покупки. 10 рейтингов и приблизительные AppRank $1K/1K не доказывают маленькую/большую активную базу или успех. Зарегистрированные/активные/платящие, спрос по функциям и удержание неизвестны; краткие отзывы — лишь качественные сигналы пользы summaries/scam notice. Официальных объявлений инвесторов/раундов не найдено; lead-directory пишет unfunded без первичного подтверждения, не сохраняем как $0. Privacy раскрывает Twilio/OpenAI/Google, но не точные STT/TTS/live MT; облачная обработка не равна локальному AI. Будущий тест: US-регистрация, second number/forwarding/SMS, реальная форма перевода/ES и RU, local-history при переустановке, ошибочные scam flags, расход/14-day trial. Сейчас регистрации, покупки и звонки не выполнялись.";
  s.sources = [site, app, privacy, tos, rank, method].map(url => ({ url, checkedAt: checkedDate,
    note: "Публичное исследование; даты/статусы и ограничения приведены у фактов. Финансирование и численность аудитории не признаны нулевыми." }));
  return s;
}
