import { useCallback, useEffect, useRef, useState } from "react";
import { RetellClient } from "retell-client-js-sdk";
import { AlertCircle, AudioLines, Check, CircleStop, Download, LoaderCircle, Mic, Radio, RefreshCw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatLabTime, labRequest } from "@/lib/secretary-lab";
import { savedRetellAdmission, retellEnded, retellError as friendlyError } from "@/lib/secretary-lab-retell";
import { retellStandApi } from "@/lib/secretary-lab-modes";
import "./retell-engine.css";

type BenchMode = "retell" | "retell-engine";

type RetellTurn = { id: string; role: "guest" | "secretary"; text: string; atMs: number };
type RetellEvent = { type: string; atMs: number; detail?: string };
type RetellObservation = { atMs: number; outcome: "stopped" | "continued" | "unknown"; note?: string };
export type RetellReport = {
  id: string;
  callId: string;
  status: "connecting" | "live" | "ended" | "stop_failed" | "failed";
  instruction: string;
  model: string;
  voice: string;
  promptHash: string;
  createdAt: string;
  endedAt?: string;
  reason?: string;
  monitorStatus: "waiting" | "connected" | "disconnected" | "ended";
  turns: RetellTurn[];
  events: RetellEvent[];
  observations: RetellObservation[];
  metrics: { guestTurns: number; secretaryTurns: number };
  engine?: {
    provider?: string;
    model?: string;
    testOnly?: boolean;
    context?: Record<string, unknown>;
    actions?: Array<{ id: string; name: string; args?: unknown; result?: unknown; status?: string }>;
    events?: Array<{ type: string; [key: string]: unknown }>;
    connected?: boolean;
  };
};

type RetellConfig = {
  ready: boolean;
  reason?: string;
  model: string;
  voice: string;
  agentId?: string;
  history: RetellReport[];
  limits: { durationSeconds: 300; historyMinutes: 60 };
  keyStatus: string;
  mode?: string;
  engine?: {
    provider?: string;
    model?: string;
    tools?: string[];
    context?: Record<string, unknown>;
    testOnly?: boolean;
  };
};

function exportReport(report: RetellReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `retell-lab-${report.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RetellBench({
  mode,
  token,
  instruction,
  onInstructionChange,
  onActiveChange,
}: {
  mode: BenchMode;
  token: string;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const api = retellStandApi(mode);
  const isEngine = mode === "retell-engine";
  const [config, setConfig] = useState<RetellConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<RetellReport | null>(null);
  const [selected, setSelected] = useState<RetellReport | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [observationNote, setObservationNote] = useState("");
  const clientRef = useRef<RetellClient | null>(null);
  const sessionRef = useRef<any>(null);
  const reportRef = useRef<RetellReport | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const stoppingRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const connectedSentRef = useRef(false);
  const startLockRef = useRef(false);
  const pollEpochRef = useRef(0);
  const callbackRef = useRef(onActiveChange);
  callbackRef.current = onActiveChange;

  const markBusy = useCallback((value: boolean) => {
    callbackRef.current(value);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadError("");
    try {
      const next = await labRequest<RetellConfig>(api, token);
      if (mountedRef.current) setConfig(next);
    } catch (cause) {
      if (mountedRef.current) setLoadError(friendlyError(cause));
    }
  }, [api, token]);

  useEffect(() => {
    mountedRef.current = true;
    void loadConfig();
    return () => {
      mountedRef.current = false;
      pollEpochRef.current++;
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
      const session = sessionRef.current;
      const current = reportRef.current;
      if (session) void session.end().catch(() => undefined);
      if (current) void labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(current.id)}`, token, { method: "DELETE" }).catch(() => undefined);
      sessionRef.current = null;
      clientRef.current = null;
    };
  }, [api, loadConfig, token]);

  const acceptReport = useCallback((next: RetellReport) => {
    if (!mountedRef.current) return;
    reportRef.current = next;
    setReport(next);
    setConfig((old) => old ? { ...old, history: [next, ...old.history.filter((item) => item.id !== next.id)] } : old);
  }, []);

  const pollSession = useCallback((sessionId: string) => {
    const epoch = ++pollEpochRef.current;
    if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    let stopped = false;
    const poll = async () => {
      if (stopped || !mountedRef.current || epoch !== pollEpochRef.current) return;
      try {
        const result = await labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(sessionId)}`, token);
        if (!mountedRef.current || stopped || epoch !== pollEpochRef.current) return;
        acceptReport(result.report);
        if (["ended", "failed"].includes(result.report.status)) {
          stoppingRef.current = true;
          await sessionRef.current?.end().catch(() => undefined);
          sessionRef.current = null;
          stoppingRef.current = false;
          requestIdRef.current = null;
          markBusy(false);
          return;
        }
      } catch (cause) {
        if (mountedRef.current && !stopped) setError(friendlyError(cause));
      }
      if (!stopped && mountedRef.current && epoch === pollEpochRef.current) pollTimerRef.current = window.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { stopped = true; if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current); };
  }, [acceptReport, api, markBusy, token]);

  useEffect(() => {
    // Refresh is a locator only: restore controls/transcript, NEVER credentials or audio.
    const previous = config?.history.find(item => !retellEnded(item.status));
    if (!previous || reportRef.current || startLockRef.current) return;
    acceptReport(previous); markBusy(true);
    setNote("Найдена незавершённая сессия. Звук автоматически не подключается; сначала остановите её.");
    pollSession(previous.id);
  }, [config?.history, acceptReport, markBusy, pollSession]);

  const endSession = useCallback(async () => {
    const current = reportRef.current;
    if (!current || stoppingRef.current) return;
    stoppingRef.current = true;
    markBusy(true);
    setError("");
    const sdkSession = sessionRef.current;
    const sdkEnd = sdkSession ? sdkSession.end().catch((cause: unknown) => {
      throw new Error(`SDK не подтвердил остановку: ${friendlyError(cause)}`);
    }) : Promise.resolve();
    const serverEnd = labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(current.id)}`, token, { method: "DELETE" });
    const [sdkResult, serverResult] = await Promise.allSettled([sdkEnd, serverEnd]);
    if (!mountedRef.current) return;
    if (serverResult.status === "fulfilled") {
      acceptReport(serverResult.value.report);
      if (serverResult.value.report.status === "ended") {
        sessionRef.current = null;
        stoppingRef.current = false;
        requestIdRef.current = null;
        markBusy(false);
        return;
      }
    }
    const detail = [
      sdkResult.status === "rejected" ? String(sdkResult.reason) : "",
      serverResult.status === "rejected" ? friendlyError(serverResult.reason) : "",
    ].filter(Boolean).join(" ");
    setError(detail || "Сервер не подтвердил завершение. Используйте «Повторить остановку».");
    stoppingRef.current = false;
    if (serverResult.status === "rejected") {
      setReport((old) => old ? { ...old, status: "stop_failed" } : old);
      if (reportRef.current) reportRef.current = { ...reportRef.current, status: "stop_failed" };
    }
  }, [acceptReport, api, markBusy, token]);

  const start = async (recover = false) => {
    if (!config?.ready || !token || instruction.trim().length < 8 || !consent || startLockRef.current ||
        (reportRef.current && !retellEnded(reportRef.current.status)) || (uncertainCreate && !recover)) return;
    startLockRef.current = true;
    markBusy(true);
    setPending(true);
    setError("");
    setNote("");
    let preflight: MediaStream | null = null;
    let createdId: string | null = null;
    let createAttempted = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Микрофон недоступен. Откройте страницу в браузере с разрешением микрофона.");
      preflight = await navigator.mediaDevices.getUserMedia({ audio: true });
      preflight.getTracks().forEach((track) => track.stop());
      preflight = null;

      if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
      createAttempted = true;
      const created = await labRequest<{ id: string; call: { call_id: string; access_token: string; [key: string]: unknown }; report: RetellReport }>(`${api}/sessions`, token, {
        method: "POST",
        body: JSON.stringify({ instruction: instruction.trim(), consent: true, clientRequestId: requestIdRef.current }),
      });
      createdId = created.id;
      if (!mountedRef.current) {
        void labRequest(`${api}/sessions/${encodeURIComponent(created.id)}`, token, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      setSelected(null);
      setUncertainCreate(false);
      acceptReport(created.report);
      const customFetch = savedRetellAdmission(created.call);
      const client = new RetellClient({ key: "", fetch: customFetch });
      clientRef.current = client;
      const session = client.createWebCall({
        agent_id: config.agentId || "server-managed",
        transcript: false,
        hooks: {
          onStatus: (status) => {
            if (!mountedRef.current) return;
            if (status === "live" && !connectedSentRef.current) {
              connectedSentRef.current = true;
              void labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(created.id)}/connected`, token, { method: "POST", body: JSON.stringify({}) })
                .then((result) => acceptReport(result.report))
                .catch((cause) => { if (mountedRef.current) setError(friendlyError(cause)); });
            }
            if (status === "ended") {
              // An SDK failure can end before "live"; do not leave a registered cloud call behind.
              if (!stoppingRef.current) void endSession();
            }
          },
          onError: (cause) => { if (mountedRef.current) setError(friendlyError(cause)); },
        },
      });
      sessionRef.current = session;
      connectedSentRef.current = false;
      void session.ready.catch((cause: unknown) => { if (mountedRef.current) setError(friendlyError(cause)); });
      pollSession(created.id);
      setNote("Подключение начато. Источник транскрипта — только серверный снимок.");
    } catch (cause) {
      preflight?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) {
        setError(friendlyError(cause));
        if (createdId) {
          try {
            const result = await labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(createdId)}`, token, { method: "DELETE" });
            if (mountedRef.current) acceptReport(result.report);
            if (result.report.status === "ended") {
              requestIdRef.current = null;
              markBusy(false);
            }
          } catch {
            if (mountedRef.current) setError((old) => `${old} Остановка созданной сессии не подтверждена; повторите остановку.`);
          }
        } else if (createAttempted && [400, 401, 402, 403, 422, 429].includes((cause as { status?: number }).status ?? 0)) {
          requestIdRef.current = null;
          markBusy(false);
        } else if (createAttempted) {
          // Ambiguous create responses must not trigger another paid attempt in this mount.
          setUncertainCreate(true);
          setError((old) => `${old} Создание не подтверждено сервером. Автоматического повтора нет; обновите страницу только после проверки состояния.`);
        } else {
          markBusy(false);
        }
      }
    } finally {
      startLockRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  };

  const addObservation = async (outcome: RetellObservation["outcome"]) => {
    const current = reportRef.current ?? selected;
    if (!current) return;
    setError("");
    try {
    const result = await labRequest<{ report: RetellReport }>(`${api}/sessions/${encodeURIComponent(current.id)}/observations`, token, {
        method: "POST",
        body: JSON.stringify({ outcome, ...(observationNote.trim() ? { note: observationNote.trim() } : {}) }),
      });
      acceptReport(result.report);
      setObservationNote("");
    } catch (cause) {
      setError(friendlyError(cause));
    }
  };

  const current = report ?? selected;
  const busy = pending || (!!report && !["ended", "failed"].includes(report.status));

  const engineConnected = current?.engine?.connected;
  const reportConnected = current?.monitorStatus === "connected";
  return <section className={`retell-bench ${isEngine ? "retell-engine-bench" : ""}`} aria-label={isEngine ? "Retell plus TalkHint Engine test stand" : "Retell Secretary test stand"}>
    <div className="retell-heading">
      <div><p className="eyebrow">{isEngine ? "RETELL + TALKHINT ENGINE / LIVE WEB" : "RETELL / LIVE WEB"}</p><h2>{isEngine ? "Retell + Engine" : "Retell voice bench"}</h2><p>{isEngine ? "Retell handles browser voice transport; TalkHint's configured OpenAI model handles reasoning. No phone numbers or publication." : "Изолированный браузерный прогон. Никаких телефонных номеров и публикации."}</p></div>
      <span className={`retell-status ${busy && (engineConnected === true || reportConnected) ? "live" : ""}`}><i />{busy ? engineConnected === false ? "ENGINE DISCONNECTED" : reportConnected || engineConnected ? "CONNECTED" : report?.status === "live" ? "LIVE · MONITOR UNKNOWN" : "CONNECTING" : config?.ready ? "CONFIGURED" : "NOT READY"}</span>
    </div>
    {loadError && <div className="retell-alert"><AlertCircle size={17} /><span>{loadError}</span><Button size="sm" variant="outline" onClick={() => void loadConfig()}><RefreshCw size={14} /> Повторить</Button></div>}
    {error && <div className="retell-alert" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть сообщение">×</button></div>}
    {note && <div className="retell-notice"><Check size={15} /><span>{note}</span></div>}

    <div className="retell-grid">
      <div className="retell-main">
        <article className="retell-panel">
          <div className="retell-panel-title"><span>01 / НАСТРОЙКА</span><strong>{isEngine ? "Retell voice + TalkHint reasoning" : "Тот же секретарь, другой runtime"}</strong></div>
          <label className="field-label" htmlFor="retell-instruction">Общая инструкция секретарю</label>
           <Textarea id="retell-instruction" value={instruction} onChange={(event) => onInstructionChange(event.target.value)} disabled={busy || uncertainCreate} maxLength={1600} className="instruction-input" />
          <div className="field-foot"><span>Совпадает с GPT-стендом · до 1 600 символов</span><span>{instruction.length}/1600</span></div>
           <div className="retell-config">
             <div><span>МОДЕЛЬ В КОНФИГУРАЦИИ</span><b>{isEngine ? config?.engine?.model || "Не сообщена API" : config?.model || "—"}</b></div>
             <div><span>ГОЛОС RETELL · КОНФИГУРАЦИЯ</span><b>{config?.voice || "—"}</b></div>
             <div><span>МОДЕЛЬ ИЗ ОТЧЁТА</span><b>{current?.engine?.model || current?.model || "Нет отчёта"}</b></div>
             <div><span>ГОЛОС ИЗ ОТЧЁТА</span><b>{current?.voice || "Нет отчёта"}</b></div>
             <div><span>READINESS · КОНФИГУРАЦИЯ</span><b>{config ? config.ready ? "Готов к запуску" : config.reason || "Не готов" : "Проверяется сервером"}</b></div>
             <div><span>СОСТОЯНИЕ КЛЮЧА RETELL</span><b>{config?.keyStatus || "Проверяется сервером"}</b></div>
             <div><span>ЛИМИТЫ ПРОГОНА</span><b>{config?.limits.durationSeconds ?? "—"} сек. · история {config?.limits.historyMinutes ?? "—"} мин.</b></div>
             {isEngine && <div><span>ПОДКЛЮЧЕНИЕ В ОТЧЁТЕ</span><b>{engineConnected === undefined ? current?.monitorStatus || "Не измерено" : engineConnected ? "Engine connected" : "Engine disconnected"}</b></div>}
           </div>
           {isEngine && config?.engine && <div className="engine-config" aria-label="TalkHint Engine configuration">
             <div className="engine-config-title"><b>{config.engine.provider || "OpenAI via TalkHint"}</b><span>{config.engine.testOnly ? "TEST ONLY" : "SCOPE NOT REPORTED"}</span></div>
             <p>Рассуждение выполняет модель TalkHint, а не managed LLM Retell. Расходы модели OpenAI через TalkHint учитываются отдельно от расходов Retell.</p>
             <div><span>Доступные тестовые инструменты</span><b>{config.engine.tools?.length ? config.engine.tools.join(" · ") : "Не сообщены API"}</b></div>
             <div><span>Контекст</span><pre>{config.engine.context ? JSON.stringify(config.engine.context, null, 2) : "Не сообщён API"}</pre></div>
           </div>}
           {isEngine && <p className="engine-voice-note">Исходный голос Retell: Merritt. Фактический выбранный голос показывается только из конфигурации и отчёта выше.</p>}
          {!config && !loadError && <div className="retell-config-skeleton" aria-label="Загрузка конфигурации"><i /><i /><i /></div>}
          {config && !config.ready && <p className="retell-reason">{config.reason || "Стенд пока не настроен на сервере."}</p>}
           <label className={`consent-row ${!config?.ready ? "muted" : ""}`}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || !config?.ready} /><span>{isEngine ? "Понимаю, что тест может повлечь отдельные расходы Retell и OpenAI через TalkHint." : "Я согласен на возможные платные расходы Retell для этого теста."}</span></label>
          <div className="retell-action-row">
            {!busy ? <Button className="start-button" disabled={!config?.ready || !consent || instruction.trim().length < 8 || pending || uncertainCreate} onClick={() => void start()}>
              {pending ? <><LoaderCircle className="spin" size={16} /> Проверка микрофона…</> : <><Radio size={16} /> Начать тест</>}
            </Button> : <Button className="stop-button" onClick={() => void endSession()}><CircleStop size={16} /> {report?.status === "stop_failed" ? "Повторить остановку" : "Остановить тест"}</Button>}
            {busy && <Button variant="outline" onClick={() => {
              const result = sessionRef.current?.startAudioPlayback?.();
              if (result?.then) void result.then(() => setNote("Воспроизведение аудио включено.")).catch((cause: unknown) => setError(friendlyError(cause)));
              else setError("SDK не предоставляет управление воспроизведением в этом состоянии.");
            }}><Volume2 size={15} /> Включить звук</Button>}
            <small>Сначала запрашивается микрофон; разрешение отпускается до создания сессии.</small>
          </div>
           {uncertainCreate && <div className="retell-reason"><p>Результат создания неизвестен. Новый запрос заблокирован. Можно повторно получить результат того же ID — сервер не создаст второй вызов.</p><Button variant="outline" disabled={pending} onClick={() => void start(true)}>Проверить тот же запрос</Button></div>}
           <p className="retell-safety"><Mic size={14} /> {isEngine ? "Сценарий и доступные действия ограничены test-only инструментами. Они не создают реальные события календаря. API-ключи остаются на сервере." : "Транскрипт выключен в SDK. API-ключ остаётся на сервере; браузер получает только сохранённый ответ создания звонка."}</p>
        </article>

         <article className="retell-panel">
          <div className="retell-panel-title"><span>02 / ЖИВОЙ СНИМОК</span><strong>Только исходный транскрипт</strong></div>
          <div className="retell-transcript" aria-live="polite">
            {(current?.turns || []).length ? current!.turns.map((turn) => <div className={`transcript-turn ${turn.role}`} key={turn.id}>
              <span className="turn-role">{turn.role === "guest" ? "СОБЕСЕДНИК" : "СЕКРЕТАРЬ"} <small>· {Math.round(turn.atMs / 1000)}с</small></span><p>{turn.text}</p>
            </div>) : <div className="transcript-empty"><AudioLines size={24} /><span>ТРАНСКРИПТ ПОКА ПУСТ</span><p>Отображаются только реплики из серверных снимков. Переводы и границы речи не синтезируются.</p></div>}
          </div>
          <div className="retell-meta"><span>Монитор: {current?.monitorStatus || "waiting"}</span><span>Собеседник {current?.metrics.guestTurns ?? 0} · секретарь {current?.metrics.secretaryTurns ?? 0}</span></div>
        </article>

        {isEngine && current?.engine && <article className="retell-panel engine-report">
          <div className="retell-panel-title"><span>03 / ENGINE TRACE</span><strong>Действия и события отчёта</strong></div>
          <div className="engine-report-meta"><span>Provider</span><b>{current.engine.provider || "Не сообщён"}</b><span>Model</span><b>{current.engine.model || "Не сообщена"}</b><span>Test-only</span><b>{current.engine.testOnly === undefined ? "Не сообщено" : current.engine.testOnly ? "Да" : "Нет"}</b><span>Connected</span><b>{current.engine.connected === undefined ? "Не сообщено" : current.engine.connected ? "Да" : "Нет"}</b></div>
          <div className="engine-trace-group"><b>Контекст</b><pre>{current.engine.context ? JSON.stringify(current.engine.context, null, 2) : "Нет контекста в отчёте"}</pre></div>
          <div className="engine-trace-group"><b>Вызовы действий · {current.engine.actions ? current.engine.actions.length : "не сообщено"}</b>
            {current.engine.actions?.length ? current.engine.actions.map((action, index) => <div className="engine-action" key={`${action.id}-${index}`}><strong>{action.name} <small>{action.status || "status не сообщён"}</small></strong><span>ID · {action.id}</span><pre>args: {action.args === undefined ? "—" : JSON.stringify(action.args, null, 2)}{"\n"}result: {action.result === undefined ? "—" : JSON.stringify(action.result, null, 2)}</pre></div>) : <p className="engine-no-data">{current.engine.actions ? "Действий в отчёте нет." : "Список вызовов не сообщён."}</p>}
          </div>
          <div className="engine-trace-group"><b>События · {current.engine.events ? current.engine.events.length : "не сообщено"}</b>
            {current.engine.events?.length ? current.engine.events.map((event, index) => <pre className="engine-event" key={`${event.type}-${index}`}>{JSON.stringify(event, null, 2)}</pre>) : <p className="engine-no-data">{current.engine.events ? "Событий в отчёте нет." : "Список событий не сообщён."}</p>}
          </div>
        </article>}

        <article className="retell-panel retell-interruption">
          <div className="retell-panel-title"><span>{isEngine ? "04" : "03"} / РУЧНАЯ ПРОВЕРКА</span><strong>Проверка перебивания</strong></div>
          <p>Во время теста попробуйте: перебить на середине фразы; уточнить правильное время; продолжить после удержания; сменить язык; проверить, не продолжилась ли устаревшая реплика.</p>
          <p className="retell-caveat">Автоматическое время остановки не измеряется. SDK-анализатор не доказывает, что звук действительно перестал быть слышен.</p>
          <label className="field-label" htmlFor="retell-observation">Заметка (необязательно)</label>
          <input id="retell-observation" className="retell-note-input" value={observationNote} onChange={(event) => setObservationNote(event.target.value)} disabled={!current} placeholder="Коротко опишите, что увидели" />
          <div className="retell-observation-actions">
            <Button variant="outline" disabled={!current} onClick={() => void addObservation("stopped")}>Остановился</Button>
            <Button variant="outline" disabled={!current} onClick={() => void addObservation("continued")}>Продолжил</Button>
            <Button variant="outline" disabled={!current} onClick={() => void addObservation("unknown")}>Неясно</Button>
          </div>
          <small>Это человеческая отметка наблюдения, не автоматическое доказательство задержки.</small>
           {!!current?.observations.length && <ul className="retell-observations">{current.observations.map((item, index) => <li key={`${item.atMs}-${index}`}>{(item.atMs / 1000).toFixed(1)} сек. · {item.outcome}{item.note ? ` — ${item.note}` : ""}</li>)}</ul>}
        </article>
      </div>
       <aside className="retell-panel retell-history">
         <div className="retell-panel-title"><span>{isEngine ? "05" : "04"} / ОТЧЁТЫ</span><strong>История на сервере</strong><button className="icon-button" onClick={() => void loadConfig()} aria-label="Обновить историю"><RefreshCw size={14} /></button></div>
         <p className="retell-history-caption">Это временная история: до {config?.limits.historyMinutes ?? 60} минут или перезапуска сервера, не архив сравнения. Retell настроен на basic_attributes_only, без сохранения записи и транскрипта у провайдера. <a href="#saved-comparisons">Для длительного хранения выберите прогоны в сохранённых сравнениях</a>.</p>
        {(config?.history || []).length === 0 ? <div className="history-empty">Сохранённых прогонов пока нет.<small>Завершённые и текущие отчёты появятся здесь.</small></div> :
          <div className="history-list">{config!.history.map((item) => <button key={item.id} disabled={busy} className={`history-item ${current?.id === item.id ? "current" : ""}`} onClick={() => { setSelected(item); setReport(null); reportRef.current = null; }}>
            <span className={`history-dot ${item.status === "live" || item.status === "connecting" ? "running" : ""}`} /><span className="history-detail"><b>{item.model} · {item.voice}</b><small>{formatLabTime(item.createdAt)} · {item.status}</small></span><span className="history-arrow">→</span>
          </button>)}</div>}
         {current && <div className="retell-report-actions"><div><b>Отчёт · {current.status}</b><small>{current.reason || `Prompt ${current.promptHash}`}</small>{isEngine && <small>Engine actions: {current.engine?.actions ? current.engine.actions.length : "not reported"} · events: {current.engine?.events ? current.engine.events.length : "not reported"}</small>}</div><Button variant="outline" size="sm" onClick={() => exportReport(current)}><Download size={14} /> JSON</Button></div>}
        <div className="retell-history-foot"><span><Check size={13} /> API credential не включается в отчёт</span><span>{current?.endedAt ? `Завершён ${formatLabTime(current.endedAt)}` : "Без публикации и PSTN"}</span></div>
      </aside>
    </div>
  </section>;
}
