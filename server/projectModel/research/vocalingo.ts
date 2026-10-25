import type { CompetitorSnapshot } from "../../../shared/projectCompetitors";
import { claim, checkedDate, suppliedFact } from "../competitorDataHelpers";
import { vocalingoData, vocalingoWebsite } from "../competitorVocalingo";

export function enrichVocalingo(current: CompetitorSnapshot): CompetitorSnapshot {
  const snapshot = structuredClone(current), dossier = snapshot.dossier!, research = snapshot.research!;
  const manifest = "https://www.vocalingo.app/llms.txt";
  const changelog = "https://feedback.vocalingo.app/en/changelog";
  const play = "https://play.google.com/store/apps/details?hl=en_US&id=app.umakhan.vocalingo";
  const analytic = "https://apprank.io/vocalingo-ai-voice-translator-5817";
  const methodology = "https://apprank.io/methodology";
  const portfolio = "https://www.umakhan.pro/en/projects/personal/vocalingo/";
  const pricing = "https://help.vocalingo.app/en/articles/4600216-token-pricing-for-each-tool";
  const estimate = (note: string) => ({
    status: "independent_estimate" as const, checkedAt: checkedDate, sourceUrls: [analytic, methodology], note,
  });
  dossier.offerFacts.push(
    suppliedFact("research-full-tools", "Полное публичное предложение",
      "Аудиоперевод с сохранением голоса; видео-перевод/дубляж; видео-липсинк; субтитры; аудио/видео→текст с итогами; TTS и сохранённые голоса; туристический голосовой и текстовый/фото-перевод; звонки с переводом или подсказками; скачивание видео; Voice Changer; мультимодельный чат.",
      manifest, "Каталог разработчика; не подтверждает одинаковую поддержку функций на всех платформах или успешные тесты."),
    suppliedFact("research-language-scope", "Языки: функции и расхождения",
      "Аудиоперевод: 107 по llms.txt, 100+ в магазинах. Видео: 100+ по манифесту, ElevenLabs Dubbing v2 — 90+ по обновлению 23.08. Туристический: 64+ в манифесте/справке против 80 в магазинах. Эти числа не являются числом языков телефонных звонков. RU/ES представлены в медиа; live-call поддержка отдельно не проверена.",
      manifest, `Дополнительные источники: ${changelog}; магазины. Публикация манифеста не датирована, проверка ${checkedDate}. Не суммировать языки и не переносить охват между функциями/моделями.`),
    suppliedFact("research-chat", "AI-чат и организационные функции",
      "Голосовой режим до 60 минут, вложения, веб-поиск/deep research, генерация изображений, code interpreter, проекты, база знаний и память заявлены. Google Play также заявляет reminders, поиск мест/маршрутов и сравнение цен. Напоминания не доказывают интеграцию с внешним календарём, почтой или SMS.",
      play, "Официальное описание магазина и llms.txt; не тестировались. Иконка и голосовой режим не доказывают живой аватар."),
    suppliedFact("research-roadmap-observed", "Развитие по журналу обновлений",
      "14.04.2026 v1.31 — телефонные звонки; 24.07 v1.56 — MCP и голосовые перебивания в чате; 30.09 v1.69 — shared caller ID, Siri/Shortcuts, новые модели; 11.10 v1.71 — индикация соединения/обрыва AI Calls; 24.10 v1.73 — Voice Changer и сохранение результатов при уходе из приложения.",
      changelog, "Датированные заявления разработчика. Направление развития продукта, не доказательство роста аудитории или удержания.")
  );
  dossier.pricingNotes.push(
    suppliedFact("research-free-conflict", "Бесплатный старт: расхождение источников",
      "Сайт/llms.txt: 30 welcome tokens; портфолио автора: 300; обновление 04.04 также сообщало о повышении 100→300. Не выбирать одно значение как гарантированное действующее предложение — проверить экран регистрации позже.",
      manifest, `Противоречащий источник: ${portfolio}; история: ${changelog}. Регистрацию не выполняли.`),
    suppliedFact("research-media-fees", "Доплаты медиа-инструментов — не тариф звонков",
      "Примеры из справки: MiniMax first clone 150 tokens; Qwen минимум 5 tokens/запрос; Voice Changer около 12 tokens/мин; Mirage captions 15 tokens за начатую минуту. Видеодубляж около 3.67–7.34 tokens/сек по опциям. Расход AI Calls показывает приложение отдельно.",
      pricing, "Публичные приблизительные ставки инструмента, не универсальная денежная минута телефонии; без перевода tokens в minutes.")
  );
  dossier.coverageFacts.push(
    { id: "research-store-reach", title: "Охват iOS-витрин по AppRank",
      value: "111 стран в Available In; Top Countries: RU/KZ/GE. Это сторонние метаданные магазина, не подтверждённая география работающей телефонии или клиентской базы.",
      evidence: estimate("Дата сбора этого списка и метод Top Countries на карточке не раскрыты; не превращать список в клиентов по городам.") },
    suppliedFact("research-city-evidence", "Отзывы и география",
      "На сайте есть выбранные разработчиком отзывы с географическими подписями. Подлинность и размер клиентской базы этими отзывами независимо не подтверждены; в подтверждённые города их не переносим.",
      vocalingoWebsite, "Самопубликуемые testimonials — качественный рекламный сигнал, не статистика клиентов/спроса/удержания.")
  );
  dossier.technical.push(
    { id: "research-backend", layer: "technology", scope: "platform", tool: "Общий backend по манифесту", provider: "Node.js; Supabase PostgreSQL",
      evidence: claim(manifest, "Заявлено разработчиком; не доказывает конкретного оператора телефонного транспорта или архитектуру live calls.") },
    { id: "research-media-pipeline", layer: "translation", scope: "file_tool", tool: "Первичный Translate Audio", provider: "Gemini 3.8 Flash",
      evidence: claim(pricing, "Справка указывает default first pipeline translation; выбор модели применяется к повторным переводам. Не модель телефонных подсказок.") },
    { id: "research-chat-models", layer: "llm", scope: "chat", tool: "Названия моделей в обновлении 30.09.2026",
      provider: "GPT 6 Astra/Sol/Luna; Claude Fable 5.1/Opus 5.5/Sonnet 5.5; Gemini 3.8 Flash; DeepSeek V4.1; Grok 4.7",
      evidence: claim(changelog, "Передаём названия из журнала разработчика, не верифицируем наличие/модели через API. Манифест перечисляет более ранние модели; не подменять этим live-call LLM.") }
  );
  dossier.scale.downloads = { value: "Android / Google Play: 10K+ Downloads — накопительный публичный порог; не iOS, не активные или платящие.",
    evidence: claim(play, "Счётчик прочитан 25.10.2026; обновление приложения 24.10.2026. Поисковый кэш показывал 100+, поэтому кэш не используем как временной ряд или доказательство роста.") };
  research.companySize = { metric: "Загрузки iOS в месяц — внешняя оценка", value: "≈1.0K по AppRank; не накопленные установки",
    evidence: estimate("Методика: доступная месячная оценка стороннего поставщика, iOS worldwide. Дата сбора/конкретный месяц не показаны; малые округлённые числа могут быть порогом отчётности. Нельзя складывать с накопительным Google Play.") };
  dossier.scale.revenue = { value: "≈$1.0K/мес iOS по AppRank; не официальная выручка компании. $12K — annualized ×12, не измеренная годовая выручка.",
    evidence: estimate("Период сбора на карточке отсутствует. AppRank указывает сторонние legacy-оценки, включая Sensor Tower; веб/Android и полный доход не покрываются. Статистика отзывов на странице также внутренне противоречива, требуется осторожность.") };
  dossier.revenueKind = "scenario";
  dossier.revenueAssumptions = "Внешняя модель AppRank, не наш расчёт конверсии. Неизвестны точный период, погрешность, плательщики и тарифный микс; нельзя восстановить платящих или считать это бухгалтерской выручкой. Annualized=месячная оценка×12 лишь run rate.";
  snapshot.limitations += "\n\nСТРАТЕГИЧЕСКИЙ ВЫВОД — наша интерпретация, не заявление разработчика. Близость к целевому TalkHint: сочетание перевода, подсказок, номера, истории и единого AI-чата. Сильная сторона — share-sheet и связность медиа/чата на трёх платформах. Отличие: подтверждено описание помощи говорящему человеку, не автономный секретарь с входящими/исходящими поручениями и контролируемыми действиями. Возможность TalkHint — проверить ценность завершённого поручения и результата, а не объявлять это уже готовым преимуществом. Признаки движения: датированные новые функции и Google Play 10K+; временного ряда аудитории/выручки нет, рост и причины успеха не доказаны. Монетизация — подписка + расходные tokens + доплаты инструментов; географическое расширение не доказано. Финансирование, регистрации, MAU/DAU, платящие, спрос по отдельным функциям и удержание не подтверждены. Одноимённый vocabulary-сервис vocalingo.com из Tracxn — другая компания, его финансирование исключено. Будущий тест: качество RU/EN/ES, задержка и перебивания именно звонка, подсказки против субтитров, incoming на iPhone, полный расход tokens/аренды номера, сохранение результата и работа напоминаний; покупки и тесты сейчас не выполнялись.";
  const sources = [manifest, changelog, play, analytic, methodology, portfolio, pricing, vocalingoData];
  snapshot.sources.push(...sources.filter(url => !snapshot.sources.some(source => source.url === url)).map(url => ({
    url, checkedAt: checkedDate, note: "Углублённое публичное исследование. Дата данных/публикации и ограничения указаны в соответствующем факте; проверка источника не является тестом приложения.",
  })));
  snapshot.checkedAt = checkedDate;
  return snapshot;
}
