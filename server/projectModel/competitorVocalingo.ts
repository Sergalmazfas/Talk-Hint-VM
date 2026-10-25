import { baseCompetitor, checkedDate, claim, pricePlan, suppliedFact, unknown, unknownLiveTechnology } from "./competitorDataHelpers";
export const vocalingoWebsite = "https://www.vocalingo.app/en";
export const vocalingoAppStore = "https://apps.apple.com/us/app/vocalingo-ai-voice-translator/id6758815817";
export const vocalingoCalls = "https://help.vocalingo.app/en/help/articles/0276096-how-ai-calls-work";
export const vocalingoAssistant = "https://help.vocalingo.app/en/help/articles/9323243-ai-assistant-mode-during-calls";
export const vocalingoNumbers = "https://help.vocalingo.app/en/help/articles/1657246-my-numbers-verify-and-virtual-numbers";
export const vocalingoData = "https://help.vocalingo.app/en/help/articles/2052635-how-vocalingo-processes-your-data";
export function vocalingoSnapshot() {
  const snapshot = baseCompetitor("VocaLingo", "Umakhan PRO LLC", vocalingoWebsite, vocalingoAppStore);
  const research = snapshot.research!, dossier = snapshot.dossier!;
  snapshot.offer = {
    features: "Перевод звонка ИЛИ текстовый подсказчик по сценарию; говорит пользователь. Свой/виртуальный номер, контакты, история, AI-чат, перевод медиа, клонирование голоса и MCP.",
    languages: "Медиа и текст: 100+. RU/ES представлены в медиа. Точное число языков телефонных звонков не подтверждено; 80 языков travel voice — отдельный инструмент, не звонки.",
    regions: "Входящие на iOS/Android, исходящие web/iOS/Android — это платформы, не подтверждение стран сервиса или присутствия клиентов.",
    numbers: "Проверка собственного номера или аренда виртуального; конкретный список стран и доступность номеров не подтверждены.",
    channels: "Входящие mobile, исходящие web/mobile. Смена Translation ↔ AI Assistant требует завершить звонок.",
  };
  const features = {
    translation: [vocalingoCalls, "Живой перевод телефонного звонка; выбирается отдельно от AI Assistant."],
    live_hints: [vocalingoAssistant, "Слушает и предлагает короткие текстовые ответы по сценарию; говорит пользователь. Для смены режима завершить звонок."],
    dedicated_number: [vocalingoNumbers, "Свой подтверждённый или виртуальный номер для caller ID; рабочий/личный профиль разрешений не подтверждён."],
    contacts: [vocalingoCalls, "Сохранённые контакты для исходящих звонков."],
    history: [vocalingoCalls, "История звонков: длительность, стоимость, режим, AI-события и запись при её наличии."],
    chat: [vocalingoData, "AI-чат с сообщениями и вложениями; самостоятельное выполнение телефонных поручений не следует из наличия чата."],
  };
  for (const [feature, [source, note]] of Object.entries(features))
    research.features[feature as keyof typeof research.features] = claim(source, note);
  research.features.secretary_outgoing = unknown("AI Assistant — подсказчик, а не подтверждённый автономный секретарь.", vocalingoAssistant);
  research.features.incoming = unknown("Входящий мобильный звонок принимает пользователь; самостоятельный Secretary не подтверждён.", vocalingoCalls);
  research.features.sms = unknown("SMS-проверка номера не доказывает полноценный пользовательский канал SMS.", vocalingoNumbers);
  research.autonomy = { mode: "assist_only", evidence: claim(vocalingoAssistant, "Опубликованный режим AI Assistant предлагает текст; говорит человек. Это не утверждение об отсутствии иных функций всей платформы.") };
  research.languages = [
    { feature: "media", count: 100, countQualifier: "at_least", russian: "yes", spanish: "yes", evidence: claim(vocalingoWebsite, "100+ языков медиа; RU/ES представлены в демонстрации перевода. Это не языковой охват телефонных звонков.") },
    { feature: "text", count: 100, countQualifier: "at_least", russian: "unknown", spanish: "unknown", evidence: claim(vocalingoAppStore, "100+ для typed/dictated text. Отдельные языки интерфейса App Store не считаются доказательством конкретного инструмента.") },
    { feature: "translation", count: null, russian: "unknown", spanish: "unknown", evidence: unknown("Точное число языков телефонного перевода и поддержка RU/ES именно в звонках нуждаются в проверке. Не переносить 100+ или travel voice 80.", vocalingoCalls) },
  ];
  dossier.offerFacts = [
    suppliedFact("modes", "Разные режимы звонка", "Translation ИЛИ AI Assistant. Во втором режиме пользователь говорит сам; для смены режима звонок нужно завершить.", vocalingoAssistant),
    suppliedFact("platforms", "Платформы звонков", "Исходящие: web/iOS/Android. Входящие: iOS/Android при подтверждённом или виртуальном номере.", vocalingoCalls),
    suppliedFact("media-mcp", "Медиа, клонирование, MCP", "Перевод медиа, клонирование голоса, AI-чат и MCP официально заявлены; это не доказательство автономного телефонного секретаря.", vocalingoWebsite),
    suppliedFact("travel-voice", "Отдельный travel voice translator", "80 языков для двухстороннего голосового общения в отдельном инструменте. Не приравнивать к языкам телефонных звонков.", vocalingoAppStore),
    suppliedFact("media-lipsync", "Липсинк переведённого видео", "Обработка загруженного видео заявлена. Живой аватар собеседника в AI-чате этим не подтверждается.", vocalingoWebsite),
  ];
  dossier.coverageFacts = [
    { id: "service-countries", title: "Страны сервиса / номеров / клиентов", value: null, evidence: unknown("Выбор страны виртуального номера зависит от текущего инвентаря. Список стран сервиса и городское присутствие клиентов не подтверждены.", vocalingoNumbers) },
  ];
  snapshot.plans = [
    pricePlan("voca-web-month", "Premium — сайт", 14.99, "month", vocalingoWebsite, "Сайт", { unit: "tokens", amount: 1000 }),
    pricePlan("voca-web-year", "Premium — сайт", 99, "year", vocalingoWebsite, "Сайт", { unit: "tokens", amount: 12000 }),
    ...[[100, 2.99], [500, 13.99], [1000, 24.99], [5000, 99.99]].map(([amount, price]) =>
      pricePlan(`voca-web-${amount}`, `${amount} tokens — сайт`, price, "one_time", vocalingoWebsite, "Сайт", { unit: "tokens", amount })),
    pricePlan("voca-store-month", "Premium Monthly", 14.99, "month", vocalingoAppStore, "US App Store"),
    pricePlan("voca-store-year", "Premium Annual", 99.99, "year", vocalingoAppStore, "US App Store"),
    ...[[100, 2.99], [300, 6.99], [500, 10.99], [1000, 19.99], [5000, 89.99], [10000, 300]].map(([amount, price]) =>
      pricePlan(`voca-store-${amount}`, `${amount} tokens`, price, "one_time", vocalingoAppStore, "US App Store", { unit: "tokens", amount })),
  ];
  dossier.pricingNotes = [
    suppliedFact("call-metering", "Телефонные звонки", "Поминутно в токенах: направление, STT, модель и TTS влияют на расчёт; оценка показывается перед звонком. Единой ставки нет.", vocalingoCalls),
    suppliedFact("number-verify", "Подтверждение своего номера", "Цена доставки SMS + 10 токенов после подтверждения; итоговая денежная стоимость неизвестна.", vocalingoNumbers),
    suppliedFact("number-rent", "Аренда номера", "Ежемесячно в токенах; точная публичная цена не опубликована в этой справке.", vocalingoNumbers),
    suppliedFact("channel-difference", "Каналы покупки различаются", "Сайт: $99/год; US App Store: $99.99/год. Пакеты также отличаются. Не смешивать цены и включённые объёмы между каналами.", vocalingoWebsite),
  ];
  dossier.technical = [
    ...unknownLiveTechnology(vocalingoCalls),
    ...([
      ["translate-audio", "translation", "file_tool", "Translate Audio", "OpenAI; ElevenLabs; MiniMax; Heygen"],
      ["translate-video", "translation", "file_tool", "Translate Video", "HeyGen native API v3; ElevenLabs"],
      ["speech-text", "stt", "file_tool", "Speech to Text — аудиофайл", "OpenAI; ElevenLabs"],
      ["video-text", "stt", "file_tool", "Video to Text — извлечённое аудио", "ElevenLabs Scribe v2"],
      ["analysis", "llm", "file_tool", "Text Analysis — аудиофайл или текст", "OpenAI; Anthropic"],
      ["tts-tool", "tts", "file_tool", "Text to Speech — введённый текст", "OpenAI; MiniMax; Alibaba (Qwen)"],
      ["voice-create", "tts", "file_tool", "Custom Voice creation — запись", "MiniMax; Alibaba (Qwen)"],
      ["ai-chat", "llm", "chat", "AI Chat — сообщения и вложения", "OpenAI; Anthropic; Google; DeepSeek; xAI"],
    ] as const).map(([id, layer, scope, tool, provider]) => ({
      id, layer, scope, tool, provider,
      evidence: claim(vocalingoData, "Официальная таблица обработки данных по инструментам. Не распространять эти провайдеры/модели на живую телефонию; Twilio/Retell не подтверждены."),
    })),
  ];
  snapshot.sources.push(...[vocalingoCalls, vocalingoAssistant, vocalingoNumbers, vocalingoData].map(url => ({
    url, checkedAt: checkedDate, note: "Повторно прочитана официальная справка; заявление, не live-проверка.",
  })));
  return snapshot;
}
