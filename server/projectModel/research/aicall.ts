import { baseCompetitor, claim, checkedDate, pricePlan, suppliedFact, unknown, unknownLiveTechnology } from "../competitorDataHelpers";
export function aiCallSnapshot() {
  const site = "https://1aicall.com/", app = "https://apps.apple.com/us/app/id6744344005";
  const agent = "https://1aicall.com/ai-phone-agent", about = "https://1aicall.com/about";
  const privacy = "https://1aicall.com/privacy";
  const play = "https://play.google.com/store/apps/details?hl=en_US&id=com.shaling.ai.phone.ai_phone";
  const brain = "https://www.appbrain.com/app/ai-call/com.shaling.ai.phone.ai_phone";
  const rank = "https://apprank.io/ios/6744344005", methodology = "https://apprank.io/methodology";
  const s = baseCompetitor("AI Call — TaraAI", "TaraAI LLC", site, app), r = s.research!, d = s.dossier!;
  s.audience = "Заявленные сценарии: иммигранты, путешественники, международные семьи и бизнес; поддержка, бронирования и бытовые поручения.";
  s.offer = {
    features: "Перевод телефонных/voice/video-звонков и очных бесед; AI Phone Agent с исходящими поручениями; Call Links; клон голоса; переведённый чат; транскрипты/итоги.",
    languages: "100+ заявлены для phone/video/text и исходящего агента; RU/ES перечислены. Не наш тест качества каждой пары.",
    regions: "Международные номера mobile/landline/VoIP; точный каталог направлений и арендуемых номеров не опубликован в проверенных страницах.",
    numbers: "Исходящий агент использует номер AI Call, callback возвращается пользователю; есть Call Forwarding и number services. Страны и цены персонального второго номера требуют проверки.",
    channels: "iPhone/Android; web Call Link для гостя; сайт заявляет macOS и web. Не overlay поверх существующего WhatsApp/FaceTime-звонка.",
  };
  for (const feature of ["incoming", "dedicated_number", "live_hints", "sms", "email", "calendar"] as const)
    r.features[feature] = unknown("Не подтверждено для точного AI Call. Ссылки через SMS/email не означают доступ к почте/SMS; перевод входящих не означает автономный приём.", site);
  for (const [feature, note] of Object.entries({
    secretary_outgoing: "AI Phone Agent сам набирает, общается по поручению и возвращает итог/двуязычный транскрипт; не предназначен для длительных переговоров и юридически связывающих звонков.",
    translation: "Двусторонний live телефонный и отдельный интернет voice/video-перевод, captions; без приложения у получателя обычного звонка.",
    contacts: "AI Call contacts и friend calling; права Contacts перечислены в магазине. Полнота импорта адресной книги отдельно не проверена.",
    history: "Каждая попытка исходящего агента логируется с исходом; транскрипт/summary. Privacy: сохранённые транскрипты до удаления пользователем.",
    chat: "Переводимый in-app текстовый чат между людьми, оба устанавливают приложение; не доказан AI-чат для универсальных поручений.",
  })) r.features[feature as keyof typeof r.features] = claim(feature === "secretary_outgoing" || feature === "history" ? agent : site, note);
  r.languages = ["translation", "secretary_outgoing", "text"].map(feature => ({
    feature: feature as "translation" | "secretary_outgoing" | "text", count: 100, countQualifier: "at_least", russian: "yes", spanish: "yes",
    evidence: claim(feature === "secretary_outgoing" ? agent : site, "100+ и RU/ES названы для этой функции; реальная доступность пары/качество не проверены."),
  }));
  r.autonomy = { mode: "confirmed_tasks", evidence: claim(agent, "Официально заявлены короткие самостоятельные поручения. Не означает наш подтверждённый тест или автономный входящий приём.") };
  d.offerFacts.push(
    suppliedFact("agent-controls", "Управление агентом: обещания и открытый вопрос",
      "Журнал 2025-11-04/08/18: Hands-off и Human-in-the-loop, AI спрашивает недостающие данные. Январь 2026 — отдельные customer-support/non-support режимы, подготовленные сведения и one-tap отправка их в разговор. 15.08.2026 — улучшение агента.",
      app, "Отзыв 26.05.2026 жалуется на невозможность вмешаться; ответ разработчика 28.05 признаёт потребность в HITL. Это качественный сигнал/расхождение с обещанием, не доказательство текущего дефекта."),
    suppliedFact("channels-boundaries", "Что действительно значит интеграция с мессенджерами",
      "Call Link можно отправить WhatsApp/WeChat/iMessage/Telegram/LINE/SMS/email; гость входит в браузере. Это новый разговор внутри AI Call, не перевод уже идущего стороннего звонка. In-app чат — отдельный канал.",
      site, "SMS/email-sharing не означает автоматическую отправку уведомлений, чтение почты или автономный SMS-канал."),
    suppliedFact("product-history", "Развитие продукта по датированному журналу",
      "Ноябрь 2025 — AI Calls for You и итог; апрель 2026 — voice/video и клон; май — Call Links; 04.07 — translated chat/Call Forwarding; август — Instant Audio Translation и agent upgrades; сентябрь — входящие/номера/голоса; октябрь — UI/stability.",
      app, "Это история функциональных заявлений, не измеренная динамика выручки, клиентов или удержания.")
  );
  s.plans = [
    pricePlan("weekly", "AI Call Weekly", 6.99, "week", app, "US App Store"),
    pricePlan("family-weekly", "Family Credit Plan Weekly", 14.99, "week", app, "US App Store"),
    pricePlan("ambiguous-5999", "AI Phone Call: Call Translator — период не раскрыт", 59.99, "unknown", app, "US App Store"),
    pricePlan("ambiguous-599", "AI Phone Call: Call Translator — тип/период не раскрыты", 5.99, "unknown", app, "US App Store"),
    ...[[100, 6.99], [250, 9.99], [450, 16.99], [1000, 37.99]].map(([amount, price]) =>
      pricePlan(`credits-${amount}`, `${amount} Credits`, price, "one_time", app, "US App Store", { unit: "credits", amount })),
  ];
  d.pricingNotes.push(suppliedFact("pricing-limits", "Что цены не раскрывают",
    "На публичной US-витрине три одинаково названные покупки по $5.99 — состав SKU не ясен; сохранена одна строка с этим ограничением. $59.99 не назван Annual, поэтому годовой эквивалент не вычисляется. Сайт: первый translated call до 2 мин free, дальнейшие цены — в приложении. Подписка не доказывает включение всех минут/агента/номера.",
    app, "US USD, проверено 25.10.2026; Google Play/сайт могут иметь другие предложения, точных ставок там не получили."));
  d.coverageFacts.push(suppliedFact("coverage-limits", "Покрытие и доказательства клиентов",
    "Сайт говорит о mobile/landline/VoIP международных звонках, guest web links и RU/ES. Списка доступных к покупке номеров по странам и подтверждённых клиентов по штатам/городам не получено. Примеры Японии/Испании — сценарии, не география клиентской базы.",
    site, "Отзывы об использовании в Японии/Италии не доказывают масштаб или устойчивую доступность в регионе."));
  d.technical = unknownLiveTechnology(privacy);
  d.technical.push({ id: "published-flow", layer: "technology", scope: "live_call", tool: "Опубликованная функциональная схема",
    provider: "Speech recognition → translation → voice output; торговые названия не раскрыты",
    evidence: claim(site, "Privacy от 27.04.2026 говорит о сторонних cloud/translation/analytics providers без названий; Twilio/Retell/OpenAI не подтверждены.") });
  d.scale.downloads = { value: "Google Play Android: 100K+ Downloads — накопительный порог точного package.",
    evidence: claim(play, "Прочитано 25.10.2026, страница обновлена 12.10.2026. About сайта без даты ещё заявляет 50K+ iOS+Android; не трактовать несинхронные страницы как точный темп роста.") };
  r.companySize = { metric: "Android — оценка AppBrain", value: "≈110 тыс. установок всего; ≈15 тыс. за последние 30 дней. Данные 21.10.2026.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [brain],
      note: "Точный package; независимая оценка, не MAU/платящие. Автоматический текст агрегатора про strong engagement/extra functions не используем как доказательство." } };
  d.scale.revenue = { value: "iOS AppRank: ≈$1.0K/месяц; точный месяц сбора не показан. Не официальная выручка.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [rank, methodology],
      note: "Там же ≈1K downloads/month, $12K annualized=×12 run rate. Legacy third-party estimate, возможно округлённый порог; версии/рейтинги отстают от Apple, распределение оценок противоречит средней. Высокая неопределённость, Android/web не включены." } };
  d.revenueKind = "scenario"; d.revenueAssumptions = "Внешняя модель агрегатора; дата сбора, точность и тарифный микс не раскрыты. Не пересчитывать в платящих, не считать annualized фактическим годом или общей выручкой TaraAI.";
  s.limitations = "СТРАТЕГИЧЕСКИЙ ВЫВОД — наша интерпретация. Очень близок к целевой связке TalkHint: говорить самому с переводом либо поручить AI исходящий звонок и получить итог. Сильная сторона — понятные сценарии поддержки/бронирования, отдельные voice/video/Call Links. Это официальные заявления, нашими звонками не проверены. Рост продукта виден по журналу функций; масштаб Android 100K+ и внешние 15K/30д — признаки распространения, не дохода или удержания. Монетизация: подписка плюс credits; расход агента/номера не прозрачен публично. Географическое расширение количественно не доказано. Задержка <0.5s на About — маркетинговая цифра без методики, главная FAQ честно допускает переменную задержку. Отзывы дают противоположные сигналы о качестве и вмешательстве; не статистика спроса/оттока. Возможности TalkHint для проверки: управляемые полномочия, предсказуемое вмешательство, прозрачный итог и стоимость; не заявляем готовое преимущество. Фандинг, зарегистрированные/активные/платящие и официальная выручка не найдены в проверенных публичных источниках/поиске. Не переносить финансирование одноимённых Tara/Tara AI. Автономный incoming, email/SMS/calendar, генерация подсказок и chat avatar не подтверждены. Будущий одинаковый тест: RU/EN/ES, поручение/итог, HITL, callback/forwarding, подлинный Caller ID, расход credits и отдельные цены; ничего не покупали и не звонили.";
  s.sources = [site, app, agent, about, privacy, play, brain, rank, methodology].map(url => ({ url, checkedAt: checkedDate,
    note: "Публичное исследование; дата данных/публикации при наличии указана в факте. Заявления разработчика, внешние оценки и наша интерпретация разделены." }));
  return s;
}
