/**
 * Documentation only. No audio sessions, provider probes, calls or configuration.
 * --save is explicit, Dev-only and compare-and-swap protected; no startup hook.
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unpackModel, activeModelSize } from "../server/projectModel/history";
import { modelSizeBudget } from "../server/projectModel/sizeBudget";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { productBookDocumentId, readProductBook, productBookText } from "../shared/productBook";
import { ProductCrewService } from "../server/productCrew/service";
import type { ModelCommand } from "../shared/projectModel";

const id = "DOC-TALKHINT-AUDIO-PASSPORT";
const techId = "DOC-TALKHINT-TECHNICAL-PASSPORT";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const sourceId = "DOC-TALKHINT-SECRETARY-MOBILE-EXTERNAL-SNAPSHOT";
const input = "attached_assets/Pasted---1793045271682_1793045271682.txt";
const actor = "Replit · ручная ревизия звуковых трактов по поручению Сергея";
const now = new Date().toISOString();
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).hostname, /^(helium|lithium)$/);
  const refs: Record<string, { file: string; from: number; to: number; sha256: string; excerpt: string; level: string }> = {};
  const source = async (key: string, file: string, anchor: string, count = 5) => {
    const text = await readFile(file, "utf8"), lines = text.split("\n");
    const index = lines.findIndex(l => l.includes(anchor));
    assert.ok(index >= 0, `${file}: anchor not found`);
    refs[key] = { file, from: index + 1, to: Math.min(lines.length, index + count),
      sha256: sha(text), excerpt: lines.slice(index, index + count).join("\n"),
      level: file.endsWith(".md") ? "сохранённая документация/отчёт; повторно не исполнено" : "код, не проверка устройства" };
  };
  await Promise.all([
    source("sdk", "ios/TalkHint/Calls/CallManager.swift", "TwilioVoiceSDK.connect(options:", 2),
    source("native-ui", "ios/TalkHint/Calls/CallManager.swift", "if session.mode == .translator", 18),
    source("callkit", "ios/TalkHint/Calls/CallManager.swift", "func provider(_ provider: CXProvider, didActivate", 9),
    source("device", "ios/TalkHint/Calls/CallAudioDeviceRouter.swift", "func prepare(copilot:", 12),
    source("bluetooth", "ios/TalkHint/Calls/CopilotAudioDevice.m", "options:AVAudioSessionCategoryOptionAllowBluetooth", 5),
    source("push", "ios/TalkHint/Push/PushManager.swift", "PKPushRegistryDelegate", 5),
    source("copilot-capture", "ios/TalkHint/Calls/CopilotCallCoordinator.swift", 'transport.sendAudio(pcm16Base64:', 12),
    source("copilot-rate", "ios/TalkHint/Calls/CopilotStream.swift", '"sampleRateHz": sampleRateHz', 2),
    source("copilot-server", "server/copilotStream.ts", 'outputMode: "text", microturnMinAudioMs: 0', 7),
    source("copilot-speak", "server/copilotSpeech.ts", 'app.post("/api/copilot/clone-speech"', 5),
    source("translator-ui", "ios/TalkHint/UI/TranslatorViewController.swift", "Audio is carried exclusively", 7),
    source("translator-routing", "server/translation/twilioBridge.ts", "export function translatorAudioDestinations", 8),
    source("translator-rate", "server/translation/twilioBridge.ts", "const RATE = 24_000", 2),
    source("translator-alt", "server/translation/iosTranslator.ts", "audio sent here is ever sent to Deepgram", 7),
    source("translator-pstn", "server/routes.ts", 'if (translatorLeg === "guest")', 12),
    source("hint-stt", "server/websocket.ts", 'model=flux-general-en&encoding=mulaw&sample_rate=8000', 1),
    source("hint-brain", "server/websocket.ts", 'const HINT_MODEL = process.env.HINT_MODEL', 1),
    source("ws-paths", "server/websocket.ts", 'if (!["/incoming-secretary-dev-stream"', 4),
    source("monitor", "ios/TalkHint/Calls/SecretaryAudioPlayer.swift", "Independent playback nodes", 10),
    source("katya-retell", "server/secretary/retellPhone.ts", "export function retellPhoneConfiguration", 12),
    source("katya-gpt", "server/secretary/voice.ts", "export const SECRETARY_AUDIO_MODEL", 4),
    source("katya-native", "server/secretary/nativeAudio.ts", 'const SECRETARY_AUDIO_MODEL=', 6),
    source("mount", "server/routes.ts", "const { registerBenchmarkRoutes }", 13),
    source("signature", "server/routes.ts", "const IS_PRODUCTION =", 7),
    source("workflows", ".replit", "[workflows]", 45),
    source("lab", "docs/secretary-lab.md", "## What is real", 16),
    source("lab-limits", "docs/secretary-lab.md", "One active session per owner", 6),
    source("retell-lab", "server/secretaryLab/RETELL-ENGINE.md", "The adapter is a new", 15),
    source("voice-tts", "server/voiceLab/providers.ts", 'model_id: "eleven_multilingual_v2"', 1),
    source("cartesia-tts", "server/voiceLab/providers.ts", 'model_id: "sonic-3.6"', 3),
    source("report-run3", "docs/translator-spike-run3-forensic-report.md", "Latency: median", 1),
    source("report-comparison", "docs/translator-spike-realtime-translate-comparison-report.md", "| Latency, speech-end", 4),
    source("spike-route", "server/translation/spike.ts", 'app.get("/translator-spike"', 5),
    source("copilot-stand", "server/translation/spike.ts", 'app.get("/translator-spike/copilot"', 4),
  ]);
  const inputText = await readFile(input, "utf8");
  const modes = [
    { id: "hint", name: "Hint — обычный звонок и подсказки", route: "iPhone Twilio Voice SDK → Twilio → PSTN Guest; сервер собирает обычный телефонный/конференционный путь, получает копию media. Это не перехват системного GSM-звука.",
      hears: "Owner и Guest слышат друг друга; пользователь читает подсказки и говорит сам. Автоматическое произнесение всех подсказок не подтверждается.",
      server: "Два Twilio track → /twilio-stream → Deepgram Flux → BRAIN → owner-scoped /ui. Привязка inbound/outbound к Owner/Guest зависит от leg; это не постоянное равенство.",
      phone: "Twilio SDK, CallKit, стандартный audio device, отображение transcript/hints; UI WebSocket не переносит основной телефонный звук.",
      wire: { sdkCodec: null, mediaStream: "base64 μ-law, mono 8000 Hz", ui: "JSON text/events" },
      models: "В коде STT flux-general-en; HINT_MODEL default gpt-5.6-terra, есть выбор/ветви fallback. Фактическая модель конкретного звонка неизвестна.",
      stand: ["Ears/Brain"], evidence: ["sdk","device","hint-stt","hint-brain","ws-paths"], deviceVerified: null },
    { id: "translator", name: "Translator — телефонный RU↔EN", route: "iPhone SDK Owner leg + серверный исходящий PSTN Guest leg; независимые bidirectional /translator-twilio-stream. Не Hint/Deepgram.",
      hears: "Owner слышит оригинал Guest и переводы согласно voice/text preference; английский Owner→Guest мониторится тем же сформированным аудио. Guest не слышит русский оригинал Owner и свой обратный RU-перевод.",
      server: "μ-law 8k↔PCM16 24k, изолированные translation sessions. Owner→EN — выбранный clone ElevenLabs/Cartesia; Guest→RU — OpenAI voice или только текст по снимку настройки. Нет молчаливой замены Owner clone другим голосом.",
      phone: "Стандартный SDK device и CallKit; TranslatorViewController — текстовый /translator-feed и управление активным SDK-звонком. Экран не захватывает второй микрофон.",
      wire: { sdkCodec: null, twilio: "μ-law 8000 Hz", provider: "PCM16 mono 24000 Hz", feed: "WebSocket JSON" },
      models: "TRANSLATOR_SPIKE_MODEL default gpt-realtime; адаптер содержит gpt-4o-mini-transcribe. Clone voice и реальная конфигурация звонка не установлены этой ревизией.",
      stand: ["Translator Spike", "Voice Lab — синтез отдельно"], evidence: ["translator-ui","translator-routing","translator-rate","translator-pstn"], deviceVerified: null },
    { id: "copilot", name: "Copilot — приватная подготовка и речь по нажатию", route: "Публичный Twilio SDK-звонок + custom audio device. Отдельные Owner/Guest/private PCM → /copilot-stream; приватная фраза не должна попасть Guest.",
      hears: "Обычный публичный разговор остаётся телефонией; приватный Hold/PTT закрывает uplink. Только намеренное нажатие на завершённую английскую карточку разрешает clone-speech Guest. Генерация текста/аудио не доказывает, что Guest услышал.",
      server: "PCM source-rate → ресемплинг24k → text-only translation sessions. /api/copilot/clone-speech — отдельная озвучка, Owner voice provider выбирается до звонка.",
      phone: "CopilotAudioDevice.m, HoldGate, CallCoordinator/Stream, частный fence, восстановление public frames, выбор карточки, воспроизведение/инъекция. Это существенная логика Swift/Objective-C, не только экран.",
      wire: { capture: "PCM16 base64 mono; sampleRateHz измеряется на активном device", preferredRate: 48000, actualRate: null, providerRate: 24000 },
      models: "OpenAI Realtime text-only; выбранный clone ElevenLabs/Cartesia. Runtime model/voice IDs null.",
      stand: ["Copilot comparison", "Voice Lab"], evidence: ["device","bluetooth","copilot-capture","copilot-rate","copilot-server","copilot-speak"], deviceVerified: null },
    { id: "secretary", name: "Катя — автономный звонок и мониторинг", route: "Задача/review/явное confirm → server dialer/provider → Guest. Owner не обязан быть голосовым участником. Retell path использует custom LLM text entry, а не второе озвучивание GPT-аудио.",
      hears: "Guest говорит с Катей. iOS может слушать Guest+Катю через /secretary-feed; это локальное прослушивание, не включение микрофона Owner в разговор.",
      server: "Secretary Engine ведёт состояние и речь; Retell, GPT-Live/native и cloned-voice варианты имеют разные аудиотранспорты. Не объединять их в один провайдер/модель.",
      phone: "Secretary task UI + feed; SecretaryAudioPlayer декодирует μ-law в Float32 mono8k, независимые nodes смешивают стороны. Скрытый экран освобождает монитор, не должен остановить серверный звонок или CallKit-сессию.",
      wire: { monitor: "μ-law base64 → Float32 mono8000 playback", retellEngine: "custom LLM WebSocket text protocol", gptNative: "Twilio μ-law8k ↔ realtime audio", runtimeCodec: null },
      models: "Retell config voice retell-Merritt + gpt-6.1-sol text Engine; voice.ts GPT-Live=gpt-live-1 / reasoning gpt-6.1-sol; nativeAudio.ts отдельный gpt-realtime-2.1 / marin. Это code defaults/варианты, не одна измеренная конфигурация.",
      stand: ["Secretary Lab", "Retell+Engine", "ElevenLabs+Engine", "Voice Lab"], evidence: ["monitor","katya-retell","katya-gpt","katya-native","retell-lab"], deviceVerified: null },
    { id: "expo", name: "Secretary Expo — диктовка поручения, не live-микрофон звонка", route: "Явная запись в Prepare → HTTPS /api/mobile-secretary/transcribe → текст → подготовка/review → отдельное подтверждение серверного звонка.",
      hears: "Запись поручения не означает, что микрофон телефона слышит Guest. Realtime barge-in, clone A/B и живое подключение Owner этим источником не подтверждены.",
      server: "Существующий mobile-secretary API/общий backend. Локальные /api/healthz и Expo static server другого проекта не выполняют звонок.",
      phone: "Expo Prepare, browser login, review, LIVE/TEST guards, сохранение ID, polling и восстановление. SDK57 описан во внешнем источнике, SDK54 — здешняя копия.",
      wire: { upload: "audio + mimeType по API", codec: null, sampleRate: null, realtimeTransport: null },
      models: null, stand: ["Компонентный mockup — не звуковой стенд"], evidence: [sourceId], deviceVerified: null },
    { id: "auxiliary", name: "Дополнительные и неопределённые пути", route: "Есть отдельный PCM /translator handler и incoming-secretary audio paths; их наличие не делает их media-маршрутом текущего экрана Translator.",
      hears: null, server: "Входящая Катя и isolated native /translator требуют отдельной привязки к конкретной пользовательской сборке/сценарию; mount зафиксирован, полное device-подтверждение отсутствует.",
      phone: "Термин владельца «автопилот» не назначен отдельному режиму: однозначная связь с Катей или Copilot неизвестна. Не создавать новый режим из названия.",
      wire: { isolatedTranslator: "PCM16 mono24000 по контракту iosTranslator", incomingCodec: null },
      models: null, stand: [], evidence: ["translator-alt","ws-paths"], deviceVerified: null },
  ];
  const benches = [
    { name: "Ears / Brain", path: "/diagnostics", api: "/api/admin/benchmark", what: "STT по аудиофикстурам, BRAIN по тексту/контексту, replay/goal-return; не SDK акустика.", workflow: "Start application", gate: "benchmark admin; API запись/прогон не вызывались", currentLatency: null },
    { name: "Translator Spike", path: "/translator-spike", api: "/translator-spike-stream", what: "Микрофон браузера и provider comparison; отдельный контур от live Hint.", workflow: "Start application", gate: "server spike/admin tickets; не запускался", currentLatency: null },
    { name: "Copilot comparison", path: "/translator-spike/copilot", api: "/copilot-bench-stream", what: "Изолированные одинаковые аудиопримеры/text translation; не проверка privacy gate на iPhone.", workflow: "Start application", gate: "protected comparison; не запускался", currentLatency: null },
    { name: "Voice Lab", path: "/voice-lab", api: "/api/admin/voice-lab", what: "ElevenLabs/Cartesia clone/speech сравнения, STT/translation/TTS timings; не Caller↔Guest end-to-end.", workflow: "Start application", gate: "admin + явные действия с расходами; не запускались", currentLatency: null },
    { name: "Secretary Lab", path: "/secretary-lab", api: "/api/admin/secretary-lab", what: "Twilio-like μ-law8k/20ms peer или WebRTC/native comparison. Browser counterpart вместо реального PSTN.", workflow: "Start application", gate: "admin, consent, лимиты базового стенда 1 session/owner, 6 starts/hour, 5 min/session; ветви имеют собственные admission rules", currentLatency: null },
    { name: "Retell+Engine / ElevenLabs+Engine", path: "/secretary-lab", api: "/api/admin/secretary-lab/retell-engine; /api/admin/secretary-lab/eleven-engine", what: "Provider ASR/TTS + text Engine, TEST tools, изолированные comparisons. Не равен реальному телефонному пилоту.", workflow: "Start application", gate: "admission/capability/admin; Retell browser callback по документу блокируется в production. Не запускались", currentLatency: null },
    { name: "Xcode validation", path: null, api: null, what: "CallAudioDeviceRouterTests, TranslatorModeTests, SecretaryMonitorAudioTests, SecretaryTranscriptRenderingTests и Copilot проверки; на Linux Xcode/iPhone недоступны.", workflow: "Mac/Xcode — не запущен и не зарегистрирован здесь отдельным workflow", gate: "моки/симулятор/устройство — разные уровни", currentLatency: null },
    { name: "Mockup sandbox", path: "/preview/…", api: null, what: "Компоненты, не звуковой/PSTN стенд", workflow: "artifacts/mockup-sandbox: Component Preview Server", gate: "не доказательство реальной аудиоработы", currentLatency: null },
  ];
  const spec = {
    format: "talkhint.audio-passport", version: 1, capturedAt: now, status: "На согласовании",
    changeScope: "Только документация и текущая модель; продукт, Xcode, providers, workflows и настройки не менялись.",
    input: { file: input, sha256: sha(inputText), text: inputText },
    modes, benches, sources: refs,
    nativeLayer: {
      callkit: "CallManager.swift: CXProvider, SDK connect, didActivate/didDeactivate; только CallKit включает выбранный call device.",
      deviceSelection: "CallAudioDeviceRouter выбирает standard для Hint/Translator и custom для Copilot до connect, не во время активного/закрывающегося звонка.",
      routes: "Speaker toggle есть; custom category допускает Bluetooth, preferred48k не равен фактической частоте. Подтверждения CarPlay/машины/BT hands-free на устройстве нет.",
      pushBackground: "PushManager.swift PushKit + CallKit report; SecretaryAlertManager — отдельные ordinary alerts. Info.plist/background declarations не доказывают доставку/звонок в фоне.",
      monitoring: "Secretary мониторинг — локальный player без input tap/recording. Нельзя обещать слышимость по одному событию transcript или запущенному synthesis.",
    },
    clients: [
      { area: "Hint/Translator/Copilot, CallKit/PushKit", swift: "есть код", expo: "не подтверждено/не заявлено в Secretary-only клиенте" },
      { area: "Secretary Prepare/review/confirm/History/Cards/Settings", swift: "есть код; подтверждение и API /api/secretary", expo: "есть по текущему коду/внешнему отчёту, /api/mobile-secretary" },
      { area: "Голосовое поручение", swift: "/api/prepare/stt, подготовка отдельно от звонка", expo: "/api/mobile-secretary/transcribe, явная запись; не live phone mic" },
      { area: "Mail chat, полноценное owner barge-in", swift: "не считать текущим без проверки", expo: "не подтверждено; будущие предложения не реализация" },
    ],
    api: {
      swift: ["/api/token", "/twilio/voice (Twilio server callback, не прямой вызов UI)", "/ui", "/translator-feed",
        "/copilot-stream", "/api/copilot/clone-speech", "/api/prepare/stt", "/api/prepare/image",
        "/api/secretary/tasks", "/secretary-feed"],
      expo: ["/api/mobile-secretary/browser/start", "/api/mobile-secretary/browser/exchange", "/me", "/cards", "/profiles",
        "/history", "/prepare/message", "/transcribe", "/live/prepare", "/live-reviews/{id}", "/live-reviews/{id}/confirm"],
      note: "Короткие Expo пути после первых двух — под /api/mobile-secretary. Полный клиентский контракт во внешнем источнике; схема клиента не доказывает наличие live endpoint. Единой проверенной OpenAPI для всех audio путей не установлено.",
      contracts: ["ios/TalkHint/Networking/APIClient.swift", "server/mobileSecretary/routes.ts", sourceId,
        "server/translation/provider.ts", "server/secretaryLab/RETELL-ENGINE.md"],
    },
    measurements: [
      { source: "docs/translator-spike-realtime-translate-comparison-report.md", date: "2026-08-18", level: "сохранённый отчёт, не повторено",
        mode: "gpt-realtime historical export", medianMs: 361, p95Ms: 402, n: 7, metric: "speech-end → first audio, не акустика iPhone",
        limitations: "8 completed source turns, 6/8 translations; отдельный прогон, 2 потери; gpt-realtime-translate не имел атрибутированного live результата. Synthetic smoke 671–751ms не live." },
      { source: "docs/translator-spike-run3-forensic-report.md", date: "2026-08-18", level: "сохранённый отчёт, не повторено",
        mode: "Run3, RU→EN, Cedar", medianMs: 291, p95Ms: 362, n: null, metric: "latency как обозначено в отчёте",
        limitations: "Отчёт описывает 7 responses/7 committed turns; знаменатель latency отдельно не подтверждён. Был hallucinated filler, не итоговая приёмка качества." },
      { source: "current-runtime", date: null, level: "не измерено", mode: "Hint/Translator/Copilot/Secretary end-to-end today",
        medianMs: null, p95Ms: null, n: null, metric: null, limitations: "Текущие БД отчётов/аудио и устройства не исследовались. Нулём не заменять." },
    ],
    environments: {
      hosting: "Код монтирует большинство лабораторий в основном Express-процессе. Отдельного workflow на каждый стенд нет; это не отдельный сервер/полная физическая изоляция.",
      workflowStatus: "По последнему сообщению среды Start application и mockup-sandbox running, общий test failed. В рамках аудита не перезапускались, причина общего падения не устанавливалась.",
      phoneSafety: "Тестовые peers/tools и gates уменьшают риск, но Dev может использовать реальные аккаунты/ключи. Разделение всех номеров/субаккаунтов/БД по средам не подтверждено.",
      signatures: "routes.ts игнорирует запрос отключить Twilio signature в production; наличие ENV-флага само по себе не означает отключённую защиту. Текущий production HTTP не проверялся.",
      startupGuard: "Start application задаёт DISABLE_AUTO_WEBHOOK_REPOINT=true. Не запускать локальный production boot без этого guard: риск переназначить живые webhooks.",
      databaseAndNumbers: null,
    },
    builds: {
      swiftSource: "ios/project.yml: 1.0.0(1), target iOS15+ — конфигурация, не установленный binary",
      expoLocal: "apps/secretary-mobile: 0.1.0, Expo54 — исходники",
      expoExternal: "Внешний отчёт: Expo57/RN0.86.3, Apple0.1.0(2), Validated/iOS16.4; исходные metadata не переданы",
      installedSwift: null, installedExpo: null, currentTestFlight: null, appStore: null, androidBinary: null,
      requiredInput: "ENG-REQ-IOS-EVIDENCE: версия/build/origin и устройство; внешнее app metadata не приёмка звука.",
    },
    verification: { code: "Файлы/строки/контрольные суммы источников выше; конфигурационные defaults, не текущая оплачиваемая сессия",
      tests: { command: "npx vitest run server/__tests__/twilioTranslatorBridge.test.ts server/__tests__/copilotStream.test.ts server/__tests__/iosTranslator.test.ts server/secretary/nativeAudio.test.ts server/secretary/retellMonitor.test.ts",
        passed: 84, files: 5, date: "2026-10-26", level: "server fake/mock/unit tests, не звук iPhone" },
      device: null, signedInUi: null, currentProviderProbe: null, liveCalls: null },
    gaps: [
      "Уточнить, что владелец называет «автопилотом»: самостоятельный звонок Кати или Copilot; отдельный режим не установлен.",
      "Получить build/origin обоих клиентов и воспроизводимый device-протокол: кто кого слышит, 5–10 Hold/release, два телефона, BT/машина/фон.",
      "При будущей разрешённой проверке замерить отдельные стадии и акустический end-to-end, с n/периодом/устройством/методикой; сейчас никаких проб.",
      "Сверить номера/БД/provider accounts и границы Dev/production без публикации/переназначений; полная физическая изоляция пока не доказана.",
      "Новые стенды или перенос платформ не утверждены: сначала паспорт/доказательства, затем обсуждение и решение владельца.",
    ],
    next: "Подтверждение точной установленной сборки/origin в существующем ENG-REQ-IOS-EVIDENCE; затем согласование протокола device-аудиопроверки без автоматического запуска.",
  };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
    assert.equal(q.rows.length, 1);
    const owner = q.rows[0].owner_key, before = await unpackModel(pool, owner, q.rows[0].state);
    const state = readHypothesis(before, "new-country");
    const doc = (key: string) => { const d = state.documents.find(x => x.id === key); assert.ok(d, key); return d; };
    assert.ok(!state.documents.some(d => d.id === id), "Already saved: read, do not duplicate");
    doc(sourceId);
    const book = structuredClone(readProductBook(doc(productBookDocumentId))!);
    assert.ok(book?.version >= 5);
    const oldBook = structuredClone(book);
    book.version++; book.updatedAt = now;
    book.nextStage = `Звук: ${id} v1. Далее — сборки/устройства и согласование.`;
    for (const key of ["hint", "secretary", "translator", "copilot"]) {
      const f = book.features.find(x => x.id === key);
      if (f) f.resources += `\nЗвуковой тракт: ${id} v1.`;
    }
    const techVersion = Number(/— v(\d+)/.exec(doc(techId).title)?.[1]) + 1;
    const roadmapVersion = Number(/— v(\d+)/.exec(doc(roadmapId).title)?.[1]) + 1;
    book.roadmap = book.roadmap.replace(`сборка паспорта v${oldBook.version}; единый roadmap v${roadmapVersion - 1}`, `сборка паспорта v${book.version}; единый roadmap v${roadmapVersion}`);
    book.contradictions = book.contradictions.replace(`актуальная связанная запись — v${roadmapVersion - 1}`, `актуальная связанная запись — v${roadmapVersion}`);
    const secretary = book.features.find(f => f.id === "secretary");
    if (secretary) secretary.platform = secretary.platform.replace(`Техпаспорт v${techVersion - 1}`, `Техпаспорт v${techVersion}`);
    const text = `# TalkHint — паспорт работы со звуком\nВерсия 1; ${now}. На согласовании.\nЭто приложение к ${techId}, не другая книга продукта.\nКод/тест/устройство разделены. Ни один стенд или звонок не запускался.\n\n## Режим → маршрут → сервер → телефон\n${modes.map(m => `### ${m.name}\nМаршрут: ${m.route}\nКто слышит: ${m.hears ?? "Нет данных"}\nСервер: ${m.server}\nТелефон: ${m.phone}\nСтенды: ${m.stand.join("; ") || "Не установлено"}\nИсточники: ${m.evidence.join(", ")}; устройство: нет новых данных.`).join("\n\n")}\n\n## Стенды и workflows\n${benches.map(b => `- ${b.name}: ${b.path ?? "локальный/Mac"}; ${b.what} Workflow: ${b.workflow}. ${b.gate}.`).join("\n")}\n\n## Неизвестное и следующий шаг\n${spec.gaps.map(g => "- " + g).join("\n")}\nСледующий шаг: ${spec.next}\n\n## Полная структурированная спецификация, источники со строками и JSON\n<!-- TALKHINT-AUDIO-PASSPORT-V1 -->\n${JSON.stringify(spec)}`;
    const bookText = productBookText(book), technical = doc(techId).text + `\nЗвук: ${id} v1.`;
    assert.ok(text.length <= 50000, `Audio document ${text.length}`);
    assert.ok(bookText.length <= 50000, `Book ${bookText.length}`);
    assert.ok(technical.length <= 50000, `Technical ${technical.length}`);
    const cmds: ModelCommand[] = [
      { type: "createDocument", id, title: "TalkHint — паспорт работы со звуком — v1 — на согласовании", text, url: doc(techId).url, elementIds: doc(techId).elementIds },
      { type: "saveDocument", id: productBookDocumentId, title: `TalkHint — живая книга продукта — v${book.version} — звуковые тракты учтены — на согласовании`, text: bookText, url: doc(productBookDocumentId).url, elementIds: doc(productBookDocumentId).elementIds },
      { type: "saveDocument", id: techId, title: `TalkHint — технический паспорт и главный инженер — v${techVersion} — звук связан — на согласовании`, text: technical, url: doc(techId).url, elementIds: doc(techId).elementIds },
      { type: "saveDocument", id: roadmapId, title: `TalkHint — единый roadmap — v${roadmapVersion} — сборка паспорта и доказательств`, text: doc(roadmapId).text + `\n\n## Звуковые тракты — ${now}\n${id} v1: Hint/Translator/Copilot/Катя/Expo диктовка, Xcode слой, стенды, workflows, API и клиенты, исторические замеры/пробелы описаны. Серверные fake/mock тесты: 84 passed/5 files; не device/акустическая приёмка. Код функций и настройки не изменены. Следующий шаг: ${spec.next} Срок не согласован. Платформенные решения не принимались.`, url: doc(roadmapId).url, elementIds: doc(roadmapId).elementIds },
    ];
    let updated = before;
    for (const c of cmds) updated = applyHypothesisCommand(updated, "new-country", c, actor);
    const next = readHypothesis(updated, "new-country");
    for (const key of ["elements", "relations", "operatingModel", "competitorDirectory", "analystPreparation", "proposals"] as const) assert.deepEqual(next[key], state[key]);
    assert.deepEqual(book.features.map(x => x.id), oldBook.features.map(x => x.id));
    assert.equal(book.previousPassport, oldBook.previousPassport);
    assert.deepEqual(next.documents.find(d => d.id === sourceId), doc(sourceId));
    const base = (s: typeof before) => { const { alternatives, revision, ...rest } = s; return rest; };
    assert.deepEqual(base(updated), base(before));
    for (const other of before.alternatives!.filter(h => h.id !== "new-country")) assert.deepEqual(updated.alternatives!.find(h => h.id === other.id), other);
    assert.ok(activeModelSize(updated) <= modelSizeBudget(updated));
    console.log(JSON.stringify({ save: process.argv.includes("--save"), revision: updated.revision, bookVersion: book.version, techVersion, roadmapVersion, sourceCount: Object.keys(refs).length, chars: { audio: text.length, book: bookText.length, technical: technical.length } }));
    if (!process.argv.includes("--save")) return;
    const saved = await persistModelUpdate(pool, owner, actual => { assert.deepEqual(actual, before, "Concurrent update"); return updated; }, true);
    const actual = readHypothesis(saved, "new-country");
    assert.deepEqual(actual, JSON.parse(JSON.stringify(next)));
    const service = new ProductCrewService({ read: async () => actual, update: async () => { throw Error("Read only"); } });
    for (const c of cmds) if (c.type === "createDocument" || c.type === "saveDocument") {
      const response: any = await service.call(owner, "get_document", { documentId: c.id });
      assert.equal(response.text, c.text); assert.equal(response.revision, actual.revision);
    }
    await mkdir("generated-artifacts/product-passport", { recursive: true });
    const stem = `generated-artifacts/product-passport/TalkHint_audio_passport_v1_rev${saved.revision}`;
    await writeFile(stem + ".json", JSON.stringify({ revision: saved.revision, passport: spec, canonicalDocumentId: id,
      bookVersion: book.version, technicalVersion: techVersion, roadmapVersion, readbackVerified: true, getDocumentVerified: 4 }, null, 2));
    await writeFile(stem + ".md", text);
    console.log(JSON.stringify({ saved: true, revision: saved.revision, json: stem + ".json", markdown: stem + ".md" }));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
