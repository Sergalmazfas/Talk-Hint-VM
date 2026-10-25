import type { CompetitorSnapshot } from "../../../shared/projectCompetitors";
import { claim, checkedDate, suppliedFact } from "../competitorDataHelpers";
import { lingvanexWebsite } from "../competitorLingvanex";
export function enrichLingvanex(current: CompetitorSnapshot): CompetitorSnapshot {
  const s = structuredClone(current), d = s.dossier!, r = s.research!;
  const play = "https://play.google.com/store/apps/details?hl=en_US&id=com.nordicwise.translator_call";
  const brain = "https://www.appbrain.com/app/call-translator-voice-changer/com.nordicwise.translator_call";
  const repo = "https://github.com/lingvanex-mt/models";
  const catalog = "https://lingvanex.com/translation-tool";
  const funding = "https://tracxn.com/d/companies/lingvanex/__4sIFGAxGs19dgsRgoX2-1ztW7zf7SJ5b2EgTbjJUih8";
  r.features.history = claim(play, "Официально: calls are saved in your history с текстом и кратким AI summary. Уточнение прежнего неподтверждённого поля, не наш живой тест.");
  r.features.live_hints!.note += " Обновление Android 2.0.6 упоминает quick phrases and tips, но не доказывает генерацию контекстных ответов.";
  d.offerFacts.push(
    suppliedFact("research-full-offer", "Полное предложение и границы",
      "Двусторонний телефонный перевод; AI Companion выполняет исходящее поручение с возможностью вмешаться; live captions, оригинал/перевод; история и AI-итог; мужской/женский голос и Original voices; Type to Speak; дешёвый звонок без перевода; подтверждение caller ID; бот для пробного звонка. Premium: второй номер US/Canada, входящий перевод, SMS в обе стороны с оригиналом и переводом.",
      play, "Обновлено 22.10.2026. Live captions/Type to Speak/quick phrases не считаем доказательством генеративных подсказок; голоса не являются аватарами. Почта, календарь, отдельный чат и автономный входящий секретарь не подтверждены."),
    suppliedFact("research-updates", "Направление развития",
      "Android 2.0.6: цена и минуты перед звонком, quick phrases/tips, заметки/итог, сохранение второго номера 24 часа после подписки, ответ из уведомления, исправление краша Android 8–11.",
      play, "Дата страницы Google Play 22.10.2026; AppBrain ещё показывает обновление 07.10.2026. Это разные даты источников, не доказательство динамики пользователей.")
  );
  d.pricingNotes.push(
    suppliedFact("research-catalog-conflict", "Общая страница сайта: другое предложение",
      "translation-tool всё ещё указывает 36 языков и от €0.2/мин. Продуктовая страница/магазины — 70+, а тарифы продукта выражены credits. Валюта EUR и credits не приравниваются; применимость старой общей страницы проверить.",
      catalog, "Дата публикации не показана. Расхождение сохранено, а не усреднено."),
    suppliedFact("research-trial-number", "Пробный расход и номер",
      "Google Play обещает 2 free minutes, бот-пробник и возможный trial подписки с условиями перед оплатой. Второй номер включён в Premium с первого платного периода; SMS только для US/Canada. По обновлению номер хранится 24 часа после окончания подписки.",
      play, "Не подтверждает одинаковую промо-доступность всем пользователям. Включённые минуты/SMS и расходы AI Companion всё ещё неизвестны.")
  );
  d.technical = d.technical.map(row => row.layer === "translation" && row.scope === "live_call"
    ? { ...row, provider: "Lingvanex API — по официальному README", evidence: claim(repo, "README прямо связывает Phone Call Translator с Lingvanex API и правильными iOS/Android ID. Точная модель/конфигурация production API не раскрыта.") }
    : row);
  d.technical.push({ id: "research-open-models", layer: "technology", scope: "platform", tool: "Опубликованные open-source translation models",
    provider: "CTranslate2; SentencePiece", evidence: claim(repo, "README обновлён 07.08.2025; открытые модели — отдельная публикация. Не доказывает, что каждый live-call этап использует именно эти модели; STT/LLM Companion/TTS/телефония неизвестны.") });
  d.scale.downloads = { value: "Android, именно com.nordicwise.translator_call: 1M+ Downloads по Google Play — накопительный порог.",
    evidence: claim(play, "Прочитано 25.10.2026, обновление страницы 22.10.2026. Не переносить 1M+ другого приложения com.nordicwise.translator на эту карточку и не складывать их.") };
  r.companySize = { metric: "Android установки — независимая оценка AppBrain", value: "≈2.2 млн всего; ≈5.8 тыс. за последние 30 дней на дату данных 19.10.2026.",
    evidence: { status: "independent_estimate", checkedAt: checkedDate, sourceUrls: [brain],
      note: "AppBrain по точному package. Собственная оценка агрегатора, не точные установки/пользователи. Два разных периода: lifetime и rolling 30 days; не MAU и не платящие. Метод детальной оценки публично не раскрыт на карточке." } };
  s.limitations += "\n\nСТРАТЕГИЧЕСКИЙ ВЫВОД — наша интерпретация. Близкий телефонный конкурент: перевод + автономное исходящее поручение + номер + translated SMS + история. Сильная сторона — узкий понятный сценарий звонка и оплачиваемый номер; опубликованное наличие AI Companion означает, что автономный исходящий секретарь не уникальное целевое преимущество TalkHint. Наше поле проверки — весь цикл поручения, управляемые разрешения и связи с личными/бизнес-делами; наличие этих преимуществ у TalkHint нельзя заявлять без теста. Признак распространения: Google Play 1M+ для точного телефонного приложения; AppBrain оценивает 2.2 млн lifetime и 5.8 тыс./30 дней (данные 19.10), не подтверждённый доход. В отзывах есть жалобы на соединение, задержки, caller-ID и списания — качественные исторические сигналы, не текущий SLA или отток. Функции и монетизация развиваются вокруг Companion, Premium-номера и credits; исторического ряда платящих/удержания/географического роста нет. Tracxn (обновление 15.09.2026) пишет unfunded, но связывает UK-юрлицо, тогда как магазин — Cyprus: отсутствие раундов не подтверждаем как факт или $0. Официальных проверенных раундов, дохода, MAU и платящих не получено; AppRank не выдал готовую карточку точного iOS ID. Будущий тест: исходящее поручение, возможность вмешаться, SMS, incoming translation, RU/ES, реальное значение credits/COINS, сохранение результата и удержание номера. Не делать вывод о клиентах по странам назначения.";
  s.sources.push(...[play, brain, repo, catalog, funding].filter(url => !s.sources.some(item => item.url === url))
    .map(url => ({ url, checkedAt: checkedDate, note: "Углублённая сверка; даты/статусы и ограничения указаны в фактах. Tracxn — спорная идентификация юрлица, не подтверждённое финансирование." })));
  return s;
}
