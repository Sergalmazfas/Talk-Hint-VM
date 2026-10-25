import type { CompetitorSnapshot } from "../../../shared/projectCompetitors";
import { baseCompetitor, claim, checkedDate, suppliedFact, unknown, unknownLiveTechnology } from "../competitorDataHelpers";
export function enrichAiPhone(current: CompetitorSnapshot): CompetitorSnapshot {
  const s = structuredClone(current), app = "https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251";
  const site = "https://www.aiphone.ai/", phone = "https://www.aiphone.ai/en/feature/phone-call-translator/index";
  const play = "https://play.google.com/store/apps/details?hl=en_US&id=com.aiphone.secondphonenumber";
  const privacy = "https://www.aiphone.ai/pp", trend = "https://trendapps.dev/app/ios/6465173251/";
  const brain = "https://www.appbrain.com/app/ai-phone/com.aiphone.secondphonenumber";
  const defaults = baseCompetitor(s.name, s.developer, s.website, s.appStore);
  s.research ??= defaults.research; s.dossier ??= defaults.dossier;
  const r = s.research!, d = s.dossier!;
  s.audience = "Иммигранты, путешественники, международные пары/семьи, студенты и специалисты; личные и бизнес-разговоры на разных языках — позиционирование разработчика.";
  s.offer = {
    features: "Двусторонний перевод звонков, voice/video по ссылке, captions, Type to Speak, key points, summary/transcripts; очный/Listening Mode; фото/OCR/экран/text/media translation. Android: second number, AI texting/auto reply, templates, business hours/forwarding/voicemail.",
    languages: "150+ languages AND accents — смешанный счётчик, не 150 подтверждённых отдельных языков. RU/ES перечислены. UI 16 языков не приравниваются к языкам звонков.",
    regions: "200+ стран как направления mobile/landline-звонков. Это не 200 стран аренды номеров, оплаты или проживания клиентов.",
    numbers: "Есть second number и подключение своего номера как outgoing caller ID; incoming translation через second number. Публичный точный каталог аренды/ставки не получен.",
    channels: "iPhone/Android; voice/video Call Link. Заявлено взаимодействие с 20+ social apps через ссылку, а не независимая доказанная интеграция API каждой платформы.",
  };
  for (const feature of ["secretary_outgoing", "incoming", "live_hints", "email", "calendar", "chat"] as const)
    r.features[feature] = unknown("Не подтверждено для точного AI Phone. Автоответы SMS не автономный голосовой секретарь; quick templates/Type to Speak не генерация контекстных ответов.", app);
  r.features.dedicated_number = claim(phone, "Второй номер официально предусмотрен; входящие переводятся через него. Страны/включённые объёмы не подтверждены.");
  r.features.translation = claim(phone, "Двусторонний live перевод обычных звонков; говорят люди. 150+ включает акценты.");
  r.features.sms = claim(play, "Android Enhanced Features: AI-Assisted Texting, AI Auto Reply to Texts. Тарифы/покрытие и наличие на каждом iOS-плане отдельно не проверены.");
  r.features.contacts = claim(play, "Block contacts и коммуникационные настройки; полнота синхронизации телефонной книги не подтверждена.");
  r.features.history = claim(app, "Сохранение/обмен полными call transcripts и Translation History; не наш тест.");
  r.languages = [{ feature: "translation", count: null, russian: "yes", spanish: "yes",
    evidence: claim(app, "150+ languages and accents — число уникальных языков не выделено. Русский/испанский названы. Для видео, OCR, SMS и других режимов отдельные списки/качество не проверены.") }];
  r.autonomy = { mode: "assist_only", evidence: claim(phone, "Опубликованный сценарий: пользователь сам говорит/выбирает сохранённый шаблон, AI переводит; это не доказательство отсутствия иных функций.") };
  d.offerFacts.push(
    suppliedFact("research-full-offer", "Полное предложение и платформенные различия",
      "Телефонный live перевод; captions; Type to Speak; выделение ключевых сведений; итог/полные записи; voice/video link; очный Talk Mode; Listening Mode для лекций; свой/AI-голос; фото/OCR/текст/экран; аудио- и стриминг-перевод. Android дополнительно перечисляет second number, AI texting/auto reply, шаблоны, blocking/business hours/forwarding/voicemail и TransAI earbuds.",
      play, "App Store также описывает screen/audio-streaming translation, но часть Enhanced Features явно перечислена именно Android. Не переносить их на все каналы покупки без теста."),
    suppliedFact("research-avatar-boundary", "Что не является аватаром",
      "На сайте — фотографии/видеосвязь реальных людей, демонстрации и отзывы. Живой персонаж в AI-чате, 3D/анимация/выбор/связь с голосом/речевой lipsync не подтверждены.",
      site, "Отсутствие доказательств — не утверждение, что такой функции точно нет."),
    suppliedFact("research-incoming-boundary", "Входящие и шаблоны — не секретарь",
      "FAQ подтверждает incoming call translation через second number; Quick Replies — заранее сохранённые номера/адреса/email. Это не доказательство автономного приёма, самостоятельных исходящих поручений или генеративных подсказок.",
      phone, "Отдельное приложение того же разработчика с AI receptionist не переносим на iOS ID 6465173251."),
    suppliedFact("research-release", "Направление развития",
      "US App Store v3.43.3 от 28.09.2026: улучшение перевода акцентов, видеоголоса в шуме, контекстного voice/conversation engine, OCR/документов. Сайт расширяет сценарии от телефонного перевода к voice/video/фото/streaming.",
      app, "Наблюдение по опубликованному журналу, не доказательство экономического роста или результата теста.")
  );
  d.pricingNotes.push(suppliedFact("research-price-rechecked", "Цены повторно проверены",
    "US App Store: weekly $8.99, monthly $14.99, annual $59.99 (~$5.00/месяц при оплате года); Mini/Medium/Large/Huge $5.99/$12.99/$29.99/$69.99. Дубли одинаковых названий покупок не отдельные новые тарифы. Число credit/минут/SMS, доплаты номера и перевода не подтверждены.",
    app, "25.10.2026; отзывы о расходе не используются как официальная долларовая минута или гарантия unlimited. Сохраняем прежние отдельные тарифные строки."));
  d.coverageFacts.push(
    suppliedFact("research-destinations", "Куда можно звонить",
      "200+ стран mobile/landline по официальной странице. Можно привязать свой outgoing caller ID; входящий перевод через second number. Список стран покупки/регистрации и номеров из этих 200+ не следует.",
      phone, "Дата публикации страницы не показана, проверка 25.10.2026."),
    suppliedFact("research-testimonials", "Свидетельства использования",
      "Сайт приводит выбранные отзывы: пользователь в USA звонит в Italy; работа с испаноязычными клиентами; отношения с человеком в Brazil. Это заявления пользователей, отобранные разработчиком; реальная аудитория по штатам/городам независимо не установлена.",
      site, "Не выдаём отзывы или адрес разработчика San Jose за количество клиентов в городе.")
  );
  d.technical = unknownLiveTechnology(privacy);
  d.technical.push({ id: "research-published-stack-limits", layer: "technology", scope: "platform", tool: "Раскрытие поставщиков в privacy",
    provider: "Категории telecom providers, AI GPT providers, transcription/cloud — без названий",
    evidence: claim(privacy, "Страница датирована 23.06.2022. Точные phone/STT/LLM/MT/TTS и модели не названы; наличие слова GPT не доказывает OpenAI в конкретном live вызове.") });
  d.scale.downloads = { value: "Android Google Play: 1M+ Downloads — накопительный порог, точный package com.aiphone.secondphonenumber.",
    evidence: claim(play, "Проверено 25.10.2026, обновление 28.09.2026; 95K отзывов не равны загрузкам.") };
  r.companySize = { metric: "Аудитория и установки — разные показатели",
    value: "Разработчик в App Store: 4M+ users worldwide (определение users не раскрыто). AppBrain Android: ≈1.5 млн установок всего; ≈55 тыс./30 дней, данные 24.10.2026.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [brain, app],
      note: "4M+ — официальное маркетинговое заявление, не подтверждённые registered/MAU/paying; 1.5M/55K — независимая оценка конкретного Android-приложения. Не складываем и не объявляем ростом между платформами." } };
  d.scale.revenue = { value: "Trend Apps iOS: ≈$100K за Last 30 days, рядом ≈50K downloads. Неподтверждённая независимая оценка, не выручка всей компании.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [trend],
      note: "Точный интервал/дата среза, региональная полнота и модель расчёта не раскрыты на странице. Поисковый кэш давал $200K/40K — фиксируем расхождение, не считаем изменением бизнеса. Метаданные версии 3.43.1 отстают от магазина; автоматические выводы strong satisfaction/low competition не принимаем." } };
  d.revenueKind = "scenario";
  d.revenueAssumptions = "Внешняя оценка сервиса Trend Apps по iOS, метод/точная дата среза неизвестны; Android/web и прочие продукты компании не включены. Не используем $2/download как доход платящего, конверсию или прогноз. Платящих/тарифного микса нет — собственной модели выручки не строим.";
  s.limitations += "\n\nСТРАТЕГИЧЕСКИЙ ВЫВОД — наша интерпретация. Близок языковой помощи TalkHint для иммигрантов и небольшого бизнеса, силён широтой переводимых каналов и понятной демонстрацией звонка. Android 1M+, AppBrain 55K/30д и публичная iOS-оценка говорят о заметном распространении, но не дают доказанных платящих/удержания. 4M+ users — заявление разработчика без определения, не вносим в MAU или registrations. Автономные поручения/входящий секретарь и generated reply hints именно этого приложения не подтверждены; чужое AI Line не смешиваем. Возможность TalkHint — проверить ценность самостоятельного завершения поручения и контекста, а не объявлять это готовым преимуществом. Монетизация — подписки + пакеты; отзывы о платности/лимитах — качественный сигнал важности прозрачности, не ставка и не churn. Функции расширяются на видео/медиа/earbuds; подтверждённой динамики географии и спроса по функциям нет. Проверенные раунды/инвесторы/официальная выручка/активные/платящие не получены. Поиск Crunchbase/Tracxn не даёт публичного подтверждённого раунда; агрегатор GetLatka смешивает описания других компаний, его цифры исключены. Не путать с японской intercom-компанией Aiphone. Будущий тест: перевод RU/ES, задержки/акценты, incoming second number, реальный расход credit и аренда, AI texting, полномочия/история; покупок и тестов не было.";
  s.checkedAt = checkedDate; s.verification = "manual";
  s.sources.push(...[site, app, phone, play, privacy, trend, brain].filter(url => !s.sources.some(item => item.url === url)).map(url => ({
    url, checkedAt: checkedDate, note: "Публичная сверка 25.10.2026; даты/платформы и источник каждой существенной цифры раскрыты в факте. Неподтверждённые оценки не отчётность.",
  })));
  return s;
}
