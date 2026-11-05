import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RetellClient } from "retell-client-js-sdk";
import type { CallPlan } from "@shared/callPlan";
import { useAuth } from "@/lib/auth";
import { labRequest } from "@/lib/secretary-lab";
import { savedRetellAdmission, retellError } from "@/lib/secretary-lab-retell";
import { watchWaitingMicrophone } from "@/lib/secretary-lab-waiting-audio";
import type { RehearsalResult, RehearsalScene, RehearsalSnapshot } from "@shared/rehearsal";
import { REHEARSAL_API } from "@shared/rehearsal";
import { canStartRehearsalVersion, isRehearsalCallEnded, parsePastedRehearsalPlan, rehearsalVersionReason, sameRehearsalSceneSnapshot, selectRehearsalVersion, serializeRehearsalResult, shouldAnalyseRehearsal, shouldContinueRehearsalPolling } from "@/lib/rehearsal-helpers";
import { RehearsalComposer } from "@/lib/rehearsal-composer";
import { AlertCircle, ArrowDownToLine, Check, Download, FileAudio2, LoaderCircle, RefreshCw, ShieldCheck, Volume2, Settings2, X } from "lucide-react";
import "@/lib/rehearsal.css";

type Admission = { id: string; call: { call_id: string; access_token: string; [key: string]: unknown }; report: RehearsalResult };
type SessionResponse = { report: RehearsalResult };
type PlanForm = {
  goal: string; checklist: string; facts: string; questions: string; unknowns: string;
  allowed: string; forbidden: string; language: CallPlan["language"];
  voicemail: NonNullable<CallPlan["voicemail"]>;
};
type RehearsalPageSnapshot = RehearsalSnapshot & { settings: { recordingConsent: boolean } };

const emptyForm: PlanForm = {
  goal: "", checklist: "", facts: "", questions: "", unknowns: "", allowed: "", forbidden: "",
  language: "ru", voicemail: "skip",
};
const splitLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const jsonDownload = (value: RehearsalResult, filename: string) => {
  const url = URL.createObjectURL(new Blob([serializeRehearsalResult(value)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const ended = isRehearsalCallEnded;
const money = (value: number) => `$${value.toFixed(2)}`;
const time = (value?: string) => value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
const pretty = (value: unknown) => value == null ? "Нет данных в отчёте" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
function planFromForm(form: PlanForm): CallPlan {
  const expectedQuestions = form.questions.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf(" — ");
    return { q: separator < 0 ? line : line.slice(0, separator).trim(), answer: separator < 0 || !line.slice(separator + 3).trim() ? null : line.slice(separator + 3).trim() };
  });
  return {
    goal: form.goal.trim(), sayAsk: splitLines(form.checklist), ownerFacts: splitLines(form.facts),
    expectedQuestions, unknowns: splitLines(form.unknowns),
    disclosurePolicy: { allowed: splitLines(form.allowed), forbidden: splitLines(form.forbidden) },
    language: form.language, executor: "secretary",
    voicemail: form.voicemail,
  };
}

function ResultDetail({ result, onAudio }: { result: RehearsalResult; onAudio: (id: string) => void }) {
  return <article className="rehearsal-result">
    <div className="result-topline"><span className="result-status">{result.status}</span><time>{time(result.createdAt)}</time></div>
    <h3>{result.rehearsal.scene.title}</h3>
    <p className="result-meta">{result.rehearsal.version.label} · {result.rehearsal.version.source}</p>
    <div className="snapshot-hashes"><span>Сцена <code>{result.rehearsal.scene.hash}</code></span><span>Версия <code>{result.rehearsal.version.hash}</code></span></div>
    <p className="result-meta">Запись: {result.rehearsal.audio.status === "ready" ? "готова на сервере" : result.rehearsal.audio.status === "pending" ? "ожидается на сервере" : result.rehearsal.audio.reason || "недоступна"}</p>
    <div className="result-actions">
      <button type="button" className="text-action" onClick={() => jsonDownload(result, `rehearsal-${result.id}.json`)}><Download size={15} /> JSON</button>
      <button type="button" className="text-action" onClick={() => onAudio(result.id)}><FileAudio2 size={15} /> {result.rehearsal.audio.status === "ready" ? "Открыть запись" : result.rehearsal.audio.status === "pending" ? "Проверить архивную запись" : "Обновить сведения о записи"}</button>
    </div>
    <details className="result-section" open>
      <summary>Стенограмма и тайминги <span>{result.turns.length} реплик</span></summary>
      {result.turns.length ? <ol className="turn-list">{result.turns.map((turn) => <li key={turn.id}>
        <span className="turn-role">{turn.role === "guest" ? "Гость" : "Секретарь"}</span>
        <span className="turn-text">{turn.text || "Пустая реплика"}</span><time>{Math.round(turn.atMs)} мс</time>
      </li>)}</ol> : <p className="muted-copy">Сервер не сохранил реплики для этого результата.</p>}
    </details>
    <details className="result-section"><summary>Leva · результат проверки</summary><pre>{pretty(result.rehearsal.review.leva)}</pre></details>
    <details className="result-section"><summary>Toma · результат проверки</summary><pre>{pretty(result.rehearsal.review.toma)}</pre></details>
    {result.rehearsal.review.error && <p className="inline-error">{result.rehearsal.review.error}</p>}
    <details className="result-section"><summary>Фактическая конфигурация и метрики</summary><pre>{pretty({ model: result.model, voice: result.voice, engine: result.engine, usage: result.rehearsal.review.usage, costMicroUsd: result.rehearsal.review.costMicroUsd, instruction: result.instruction, reason: result.reason })}</pre></details>
  </article>;
}

export default function RehearsalPage() {
  const { token } = useAuth();
  const [snapshot, setSnapshot] = useState<RehearsalPageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [versionId, setVersionId] = useState("");
  const versionsInitializedRef = useRef(false);
  const [title, setTitle] = useState("");
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [planJson, setPlanJson] = useState("");
  const [assignment, setAssignment] = useState("");
  const [loadedSceneText, setLoadedSceneText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [savingScene, setSavingScene] = useState(false);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState<RehearsalResult | null>(null);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const clientRef = useRef<RetellClient | null>(null);
  const sessionRef = useRef<any>(null);
  const reportRef = useRef<RehearsalResult | null>(null);
  const mountedRef = useRef(false);
  const startLockRef = useRef(false);
  const stoppingRef = useRef(false);
  const connectedRef = useRef(false);
  const createdIdRef = useRef<string | null>(null);
  const waitingStopRef = useRef<(() => void) | null>(null);
  const agentSpeakingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const audioUrlRef = useRef("");

  const selectedScene = snapshot?.scenes.find((scene) => scene.id === sceneId) ?? null;
  const selectedVersionIndex = snapshot?.versions.findIndex((version) => version.id === versionId) ?? -1;
  const selectedVersion = selectRehearsalVersion(snapshot?.versions ?? [], selectedVersionIndex);
  const selectedResult = snapshot?.history.find((item) => item.id === selectedResultId) ?? active;
  const history = snapshot?.history ?? [];
  const compareResults = compareIds.map((id) => history.find((item) => item.id === id)).filter((item): item is RehearsalResult => !!item);
  const busy = pending || (!!active && !ended(active.status));
  const readyToStart = !!snapshot?.ready && !!assignment.trim() && canStartRehearsalVersion(selectedVersion) && !busy && !uncertain && !loading;

  const refreshSnapshot = useCallback(async () => {
    if (!token) return;
    setLoadError("");
    try {
      const next = await labRequest<RehearsalPageSnapshot>(REHEARSAL_API, token);
      if (!mountedRef.current) return;
      setSnapshot(next);
      if (!reportRef.current) {
        const unfinished = next.history.find(item => !ended(item.status));
        if (unfinished) {
          reportRef.current = unfinished; createdIdRef.current = unfinished.id;
          setActive(unfinished); setUncertain(true);
          setError("Найдена незавершённая репетиция. Звук не возобновляется автоматически; нажмите «Завершить» для сверки с сервером.");
        }
      }
      setSceneId((old) => old && next.scenes.some((scene) => scene.id === old) ? old : next.scenes[0]?.id ?? "");
      setVersionId((old) => {
        if (old && next.versions.some((version) => version.id === old)) return old;
        if (!old && !versionsInitializedRef.current) return next.versions.find((version) => version.id === "dev-C")?.id ?? next.versions[0]?.id ?? "";
        return "";
      });
      versionsInitializedRef.current = true;
    } catch (cause) {
      if (mountedRef.current) setLoadError(retellError(cause));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshSnapshot();
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
      waitingStopRef.current?.(); waitingStopRef.current = null;
      const session = sessionRef.current;
      if (session) void session.end().catch(() => undefined);
      const current = reportRef.current;
      if (current && !ended(current.status) && token && snapshot?.csrf) {
        void labRequest(`${REHEARSAL_API}/sessions/${encodeURIComponent(current.id)}/stop`, token, {
          method: "POST", body: JSON.stringify({}), headers: { "X-Rehearsal-CSRF": snapshot.csrf },
        }).catch(() => undefined);
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      clientRef.current = null;
    };
  }, [refreshSnapshot, snapshot?.csrf, token]);

  useEffect(() => {
    const scene = snapshot?.scenes.find((item) => item.id === sceneId);
    if (scene) setTitle(scene.title);
  }, [sceneId, snapshot?.scenes]);

  const acceptReport = useCallback((next: RehearsalResult) => {
    if (!mountedRef.current) return;
    reportRef.current = next;
    setActive(next);
    setSelectedResultId(next.id);
    setSnapshot((old) => old ? { ...old, history: [next, ...old.history.filter((item) => item.id !== next.id)] } : old);
  }, []);

  const csrfRequest = useCallback(<T,>(path: string, init: RequestInit = {}) => {
    if (!token || !snapshot?.csrf) throw new Error("Нет авторизации или CSRF-токена. Обновите стенд.");
    return labRequest<T>(path, token, {
      ...init,
      headers: { ...init.headers, "X-Rehearsal-CSRF": snapshot.csrf },
    });
  }, [snapshot?.csrf, token]);

  const analysedRef = useRef(new Set<string>());
  const analyseOnce = useCallback(async (id: string) => {
    if (analysedRef.current.has(id)) return;
    analysedRef.current.add(id);
    try {
      const response = await csrfRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(id)}/analyse`, { method: "POST", body: JSON.stringify({}) });
      acceptReport(response.report);
      await refreshSnapshot();
    } catch (cause) {
      setError(`Сессия завершена, но анализ не подтверждён: ${retellError(cause)}. Автоматического повтора не будет.`);
    }
  }, [acceptReport, csrfRequest, refreshSnapshot]);

  // Keep the poll callback wired to the one-shot handler without recreating timers.
  const analyseRef = useRef(analyseOnce);
  analyseRef.current = analyseOnce;

  const stopSession = useCallback(async (reason?: string) => {
    const current = reportRef.current;
    if (!current || stoppingRef.current) return;
    stoppingRef.current = true;
    setPending(true);
    waitingStopRef.current?.(); waitingStopRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    const sdkEnd = session ? session.end().catch((cause: unknown) => { throw new Error(`SDK: ${retellError(cause)}`); }) : Promise.resolve();
    try { await sdkEnd; } catch (cause) { setError(`Остановка SDK не подтверждена: ${retellError(cause)}`); }
    try {
      const response = await csrfRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(current.id)}/stop`, { method: "POST", body: JSON.stringify({}) });
      acceptReport(response.report);
      if (ended(response.report.status)) {
        setNotice(reason || "Сессия завершена сервером.");
        setPending(false);
        if (shouldAnalyseRehearsal(response.report)) void analyseOnce(current.id);
      } else {
        setError("Сервер ещё не подтвердил завершение. Состояние проверяется; новый запуск заблокирован.");
      }
    } catch (cause) {
      setError(`Остановка не подтверждена: ${retellError(cause)}. Не запускайте новый прогон до проверки состояния.`);
    } finally {
      stoppingRef.current = false;
      if (mountedRef.current && !ended(reportRef.current?.status || "")) setPending(false);
    }
  }, [acceptReport, analyseOnce, csrfRequest]);

  const analyzeAndStopRef = useRef(stopSession);
  analyzeAndStopRef.current = stopSession;

  const onWaiting = useCallback(async (activeSignal: boolean) => {
    const sessionId = createdIdRef.current;
    if (!sessionId || !mountedRef.current) return;
    await csrfRequest(`${REHEARSAL_API}/sessions/${encodeURIComponent(sessionId)}/waiting-audio`, {
      method: "POST", body: JSON.stringify({ active: activeSignal, agentSpeaking: agentSpeakingRef.current }),
    });
  }, [csrfRequest]);

  const start = async () => {
    if (!snapshot?.settings?.recordingConsent) {
      setMoreOpen(true);
      setError("Перед первым звонком подтвердите запись в настройках раздела «Ещё».");
      return;
    }
    if (!snapshot?.ready || !assignment.trim() || !canStartRehearsalVersion(selectedVersion) || busy || uncertain || loading || !token || !snapshot || !selectedVersion || startLockRef.current) return;
    startLockRef.current = true; setPending(true); setError(""); setNotice(""); setUncertain(false);
    let stream: MediaStream | null = null;
    let admissionAttempted = false;
    let createdId: string | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Браузер не предоставляет доступ к микрофону.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      // Validate SDK construction locally before the paid admission request. It has no usable network capability.
      new RetellClient({ key: "", fetch: async () => { throw new Error("SDK preflight only"); } });
      if (!mountedRef.current) return;
      let preparedScene = selectedScene && loadedSceneText === assignment &&
        selectedScene.plan.executor === "secretary" && !selectedScene.plan.targetPhone ? selectedScene : null;
      if (!preparedScene) {
        const prepared = await csrfRequest<{ scene: RehearsalScene }>(`${REHEARSAL_API}/scenes`, {
          method: "POST", body: JSON.stringify({ text: assignment }),
        });
        preparedScene = prepared.scene;
        if (!mountedRef.current) return;
        setSceneId(prepared.scene.id);
        setLoadedSceneText(assignment);
        setSnapshot((old) => old ? { ...old, scenes: [prepared.scene, ...old.scenes.filter((scene) => scene.id !== prepared.scene.id)] } : old);
      }
      requestIdRef.current ||= crypto.randomUUID();
      admissionAttempted = true;
      const created = await csrfRequest<Admission>(`${REHEARSAL_API}/sessions`, {
        method: "POST",
        body: JSON.stringify({ sceneId: preparedScene.id, versionId: selectedVersion.id,
          sceneHash: preparedScene.hash, versionHash: selectedVersion.hash,
          clientRequestId: requestIdRef.current, consent: true, recordingConsent: true }),
      });
      createdId = created.id; createdIdRef.current = created.id;
      if (!mountedRef.current) {
        void csrfRequest(`${REHEARSAL_API}/sessions/${encodeURIComponent(created.id)}/stop`, { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
        return;
      }
      acceptReport(created.report);
      void refreshSnapshot();
      const client = new RetellClient({ key: "", fetch: savedRetellAdmission(created.call) });
      clientRef.current = client;
      connectedRef.current = false;
      const session = client.createWebCall({
        agent_id: "server-managed", transcript: false,
        hooks: {
          onAgentStartTalking: () => { agentSpeakingRef.current = true; },
          onAgentStopTalking: () => {
            agentSpeakingRef.current = false;
            const currentId = createdIdRef.current;
            if (currentId && selectedVersion.waiting) void csrfRequest(`${REHEARSAL_API}/sessions/${encodeURIComponent(currentId)}/waiting-audio`, { method: "POST", body: JSON.stringify({ event: "playback_ended" }) }).catch(() => undefined);
          },
          onStatus: (status) => {
            if (status === "live" && !connectedRef.current) {
              connectedRef.current = true;
              void csrfRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(created.id)}/connected`, { method: "POST", body: JSON.stringify({}) })
                .then((response) => acceptReport(response.report))
                .catch((cause) => { if (mountedRef.current) setError(`Подключение не подтверждено сервером: ${retellError(cause)}`); });
            }
            if (status === "ended" && !stoppingRef.current) void analyzeAndStopRef.current("Звонок завершился со стороны провайдера.");
          },
          onError: (cause) => {
            if (mountedRef.current) setError(`Ошибка голосового SDK: ${retellError(cause)}`);
            if (!stoppingRef.current) void analyzeAndStopRef.current("Ошибка голосового SDK.");
          },
        },
      });
      sessionRef.current = session;
      void session.ready.catch((cause: unknown) => {
        if (!mountedRef.current) return;
        setError(`SDK не смог подключиться: ${retellError(cause)}`);
        if (!stoppingRef.current) void stopSession("SDK завершил подключение с ошибкой.");
      });
      if (stream) {
        if (selectedVersion.waiting) waitingStopRef.current = await watchWaitingMicrophone(stream, onWaiting);
        stream = null;
      }
      if (mountedRef.current) {
        pollTimerRef.current = window.setTimeout(() => {
          const poll = async () => {
            if (!mountedRef.current || !createdId) return;
            try {
              const response = await labRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(created.id)}`, token);
              if (!mountedRef.current) return;
              acceptReport(response.report);
              if (shouldAnalyseRehearsal(response.report)) void analyseRef.current(created.id);
              if (!shouldContinueRehearsalPolling(response.report)) {
                waitingStopRef.current?.(); waitingStopRef.current = null;
                const liveSession = sessionRef.current; sessionRef.current = null;
                if (liveSession) await liveSession.end().catch(() => undefined);
                setPending(false); return;
              }
            } catch (cause) { setError(`Состояние не получено: ${retellError(cause)}`); }
            pollTimerRef.current = window.setTimeout(() => void poll(), 1200);
          };
          void poll();
        }, 0);
        setNotice("Сессия создана. Стенограмма поступает только из серверного отчёта.");
      }
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      waitingStopRef.current?.(); waitingStopRef.current = null;
      setError(retellError(cause));
      if (createdId) {
        // A known admission exists: ask the server to stop it, never retry admission.
        void csrfRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(createdId)}/stop`, { method: "POST", body: JSON.stringify({}) })
          .then((response) => {
            acceptReport(response.report);
            if (ended(response.report.status)) {
              setPending(false);
              if (shouldAnalyseRehearsal(response.report)) void analyseOnce(createdId!);
            }
          })
          .catch((stopError) => setError(`Сессия создана, остановка не подтверждена: ${retellError(stopError)}`));
      } else if (admissionAttempted) {
        const status = (cause as { status?: number }).status;
        if ([400, 401, 402, 403, 409, 422, 429].includes(status ?? 0)) requestIdRef.current = null;
        else { setUncertain(true); setError(`${retellError(cause)} Ответ на создание неоднозначен. Повторный платный запуск заблокирован до обновления состояния.`); }
      } else setPending(false);
    } finally {
      startLockRef.current = false;
      if (!createdId && !uncertain) setPending(false);
    }
  };

  const saveScene = async () => {
    if (!token || !snapshot?.ready || savingScene) return;
    setSavingScene(true); setError(""); setNotice("");
    try {
      let plan: CallPlan;
      if (pasteMode) {
        plan = { ...parsePastedRehearsalPlan(planJson), executor: "secretary", targetPhone: undefined };
      } else plan = planFromForm(form);
      const result = await csrfRequest<{ scene: RehearsalScene; snapshot?: RehearsalPageSnapshot }>(`${REHEARSAL_API}/scenes`, {
        method: "POST", body: JSON.stringify({ title: title.trim(), plan }),
      });
      if (result.snapshot) setSnapshot(result.snapshot);
      else await refreshSnapshot();
      setSceneId(result.scene.id);
      setNotice("Сцена сохранена сервером.");
    } catch (cause) { setError(`Не удалось сохранить сцену: ${retellError(cause)}`); }
    finally { setSavingScene(false); }
  };

  const openAudio = async (id: string) => {
    if (!token || audioBusy) return;
    setAudioBusy(true); setError("");
    try {
      const result = await csrfRequest<SessionResponse>(`${REHEARSAL_API}/sessions/${encodeURIComponent(id)}/audio`, { method: "POST", body: JSON.stringify({}) });
      acceptReport(result.report);
      if (result.report.rehearsal.audio.status !== "ready") {
        const audio = result.report.rehearsal.audio;
        setNotice(audio.status === "pending" ? "Архивная запись ещё не готова; серверный статус обновлён." : audio.reason || "Сервер сообщил, что запись недоступна.");
        return;
      }
      const response = await fetch(`${REHEARSAL_API}/sessions/${encodeURIComponent(id)}/audio`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Аудио недоступно (${response.status}).`);
      }
      const blob = await response.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(blob); setAudioUrl(audioUrlRef.current);
    } catch (cause) { setError(`Запись не получена: ${retellError(cause)}`); }
    finally { setAudioBusy(false); }
  };

  const toggleCompare = (result: RehearsalResult) => {
    setCompareIds((old) => old.includes(result.id) ? old.filter((id) => id !== result.id) : old.length < 2 ? [...old, result.id] : [old[1], result.id]);
  };
  const sceneOptions = useMemo(() => snapshot?.scenes ?? [], [snapshot?.scenes]);
  const saveConsent = async (checked: boolean) => {
    if (!snapshot || consentSaving) return;
    setConsentSaving(true); setError(""); setNotice("");
    try {
      const response = await csrfRequest<{ settings: { recordingConsent: boolean } }>(`${REHEARSAL_API}/settings`, {
        method: "POST", body: JSON.stringify({ recordingConsent: checked }),
      });
      setSnapshot((old) => old ? { ...old, settings: response.settings } : old);
      await refreshSnapshot();
      setNotice(checked ? "Согласие сохранено для будущих репетиций." : "Согласие отозвано.");
    } catch (cause) { setError(`Настройку не удалось сохранить: ${retellError(cause)}`); }
    finally { setConsentSaving(false); }
  };

  return <main className="rehearsal-shell">
    <header className="rehearsal-header">
      <div className="rehearsal-brand"><span className="brand-mark">К</span><span>Катя <i>/</i> секретарь</span></div>
      <div className="header-actions">
        <button type="button" className="icon-button" aria-label="Обновить данные" onClick={() => void refreshSnapshot()} disabled={loading}><RefreshCw size={17} /></button>
        <button type="button" className="more-button" onClick={() => setMoreOpen(true)}><Settings2 size={16} /> Ещё</button>
      </div>
    </header>
    <div className="rehearsal-content">
      {loadError && <div className="rehearsal-alert" role="alert"><AlertCircle size={18} /><span>{loadError}</span><button type="button" onClick={() => void refreshSnapshot()}>Повторить</button></div>}
      {error && <div className="rehearsal-alert compact-alert" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setError("")}>×</button></div>}
      {notice && <div className="rehearsal-notice compact-notice" role="status"><Check size={15} />{notice}</div>}
      {loading && <div className="rehearsal-skeleton" aria-label="Загрузка стенда"><i /><i /><i /></div>}
      {!loading && snapshot && <>
        {!snapshot.ready && <div className="stand-unavailable"><ShieldCheck size={19} /><div><strong>Репетиция сейчас недоступна</strong><p>{snapshot.reason || "Сервер не сообщил причину."}</p></div></div>}
        <RehearsalComposer
          scenes={snapshot.scenes}
          assignment={assignment}
          onAssignmentChange={setAssignment}
          versionId={versionId}
          versions={snapshot.versions}
          selectedVersion={selectedVersion}
          onVersionChange={setVersionId}
          consentGranted={snapshot.settings.recordingConsent}
          readyToStart={readyToStart}
          pending={pending}
          busy={busy}
          active={active}
          uncertain={uncertain}
          onStart={() => void start()}
          onStop={() => void stopSession()}
          onOpenMore={() => setMoreOpen(true)}
        />
      </>}
    </div>
    {moreOpen && snapshot && <div className="more-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}>
      <section className="more-drawer" role="dialog" aria-modal="true" aria-labelledby="more-title">
        <div className="drawer-heading"><div><p className="overline">НАСТРОЙКИ И РЕЗУЛЬТАТЫ</p><h2 id="more-title">Ещё</h2></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setMoreOpen(false)}><X size={18} /></button></div>
        <section className="drawer-section consent-settings">
          <h3>Согласие на запись</h3>
          <p>Одноразовая настройка для звонков и серверного разбора. Речь обеих сторон обрабатывается сервером; отдельной записи микрофона в браузере нет.</p>
          <label className="consent-box">
            <input type="checkbox" checked={snapshot.settings.recordingConsent} disabled={consentSaving || busy} onChange={(event) => void saveConsent(event.target.checked)} />
            <span>{consentSaving ? "Сохраняем…" : snapshot.settings.recordingConsent ? "Согласие включено для следующих звонков" : "Разрешаю запись и серверный разбор будущих репетиций"}</span>
          </label>
        </section>
        <section className="drawer-section">
          <h3>Версии и бюджет</h3>
          <label>Сохранённые варианты
            <select aria-label="Сохранённые варианты Кати" value={versionId} disabled={busy}
              onChange={event => setVersionId(event.target.value)}>
              {snapshot.versions.map(version => <option key={version.id} value={version.id} disabled={!version.available}>{version.label}</option>)}
            </select>
          </label>
          {selectedVersion && <div className="drawer-version">
            <strong>{selectedVersion.label}</strong><span>{selectedVersion.source}</span><code>{selectedVersion.hash}</code>
            {rehearsalVersionReason(selectedVersion) && <p>{rehearsalVersionReason(selectedVersion)}</p>}
          </div>}
          <div className="budget-strip" aria-label="Бюджет серии">
            <div><span>Остаток</span><strong>{money(snapshot.budget.remainingUsd)}</strong></div>
            <div><span>Лимит</span><b>{money(snapshot.budget.limitUsd)}</b></div>
            <div><span>Потрачено</span><b>{money(snapshot.budget.spentUsd)}</b></div>
            <div><span>В резерве</span><b>{money(snapshot.budget.reservedUsd)}</b></div>
          </div>
        </section>
        <section className="drawer-section">
          <h3>Сохранённые поручения</h3>
          <label className="field-label" htmlFor="scene-picker">Загрузить сохранённое</label>
          <select id="scene-picker" value={sceneId} onChange={(event) => {
            const chosen = sceneOptions.find((scene) => scene.id === event.target.value);
            setSceneId(event.target.value);
            if (chosen) {
              const planText = JSON.stringify(chosen.plan, null, 2);
              setAssignment(planText); setLoadedSceneText(planText); setTitle(chosen.title);
            }
          }}>
            <option value="">Выберите поручение…</option>
            {sceneOptions.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
          </select>
          {selectedScene && <p className="scene-hash">Снимок: <code>{selectedScene.hash}</code></p>}
          <div className="divider-label"><span>СОХРАНИТЬ НОВОЕ</span><button type="button" onClick={() => setPasteMode((value) => !value)}>{pasteMode ? "Поля" : "JSON"}</button></div>
          <label className="field-label" htmlFor="scene-title">Название поручения</label>
          <input id="scene-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Например, узнать про шины" />
          {pasteMode ? <><label className="field-label" htmlFor="plan-json">План JSON</label><textarea id="plan-json" className="plan-textarea json-input" value={planJson} onChange={(event) => setPlanJson(event.target.value)} placeholder={'{\n  "goal": "...",\n  "ownerFacts": [],\n  "sayAsk": [],\n  "expectedQuestions": [],\n  "unknowns": [],\n  "disclosurePolicy": { "allowed": [], "forbidden": [] },\n  "language": "ru",\n  "executor": "secretary"\n}'} /></> : <div className="plan-fields">
            <label className="field-label" htmlFor="plan-goal">Цель</label><textarea id="plan-goal" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} rows={2} />
            <label className="field-label" htmlFor="plan-checklist">Что уточнить · по пунктам</label><textarea id="plan-checklist" value={form.checklist} onChange={(event) => setForm({ ...form, checklist: event.target.value })} rows={3} />
            <label className="field-label" htmlFor="plan-facts">Факты владельца</label><textarea id="plan-facts" value={form.facts} onChange={(event) => setForm({ ...form, facts: event.target.value })} rows={3} />
            <label className="field-label" htmlFor="plan-questions">Вопросы и ответы</label><textarea id="plan-questions" value={form.questions} onChange={(event) => setForm({ ...form, questions: event.target.value })} rows={2} />
            <label className="field-label" htmlFor="plan-unknowns">Что неизвестно</label><textarea id="plan-unknowns" value={form.unknowns} onChange={(event) => setForm({ ...form, unknowns: event.target.value })} rows={2} />
            <label className="field-label" htmlFor="plan-allowed">Можно сообщать</label><textarea id="plan-allowed" value={form.allowed} onChange={(event) => setForm({ ...form, allowed: event.target.value })} rows={2} />
            <label className="field-label" htmlFor="plan-forbidden">Нельзя сообщать</label><textarea id="plan-forbidden" value={form.forbidden} onChange={(event) => setForm({ ...form, forbidden: event.target.value })} rows={2} />
            <div className="two-fields">
              <label className="field-label">Язык<select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value as PlanForm["language"] })}><option value="ru">Русский</option><option value="en">English</option><option value="es">Español</option><option value="kk">Қазақша</option><option value="uk">Українська</option></select></label>
              <label className="field-label">Голосовая почта<select value={form.voicemail} onChange={(event) => setForm({ ...form, voicemail: event.target.value as PlanForm["voicemail"] })}><option value="skip">Пропустить</option><option value="leave">Оставить сообщение</option></select></label>
            </div>
          </div>}
          <button className="secondary-button save-scene" type="button" disabled={!snapshot.ready || savingScene || !title.trim()} onClick={() => void saveScene()}>{savingScene ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Сохранить поручение</button>
        </section>
        <section className="history-section drawer-section">
          <div className="section-title-row"><div><p className="overline">СОХРАНЁННЫЕ ПРОГОНЫ</p><h2>История</h2></div><span>{history.length} результатов</span></div>
          {history.length ? <div className="history-list">{history.map((result) => <div className={`history-item ${selectedResult?.id === result.id ? "is-selected" : ""}`} key={result.id}>
            <button type="button" className="history-select" onClick={() => setSelectedResultId(result.id)}><span className="history-dot" /><span className="history-main"><strong>{result.rehearsal.scene.title}</strong><small>{time(result.createdAt)} · {result.rehearsal.version.label}</small></span><span className="history-status">{result.status}</span></button>
            <label className="compare-pick"><input type="checkbox" checked={compareIds.includes(result.id)} onChange={() => toggleCompare(result)} /> Сравнить</label>
          </div>)}</div> : <div className="empty-history"><p>Здесь появятся серверные результаты.</p><span>Сохранённые прогоны остаются в аккаунте.</span></div>}
          {selectedResult && <div className="history-detail"><ResultDetail result={selectedResult} onAudio={(id) => void openAudio(id)} /></div>}
          {active && <div className="drawer-active">
            <div className="panel-heading"><span className="step-number">●</span><div><h2>Текущий прогон</h2><p>Состояние подтверждено сервером</p></div></div>
            <div className="active-state"><i className={ended(active.status) ? "is-ended" : "is-live"} /><strong>{active.status}</strong></div>
            {active.reason && <p className="muted-copy">{active.reason}</p>}
            {ended(active.status) && active.rehearsal.review.status === "not_started" && <button type="button" className="secondary-button" disabled><LoaderCircle className="spin" size={15} />Анализ ожидает запуска</button>}
            {ended(active.status) && active.rehearsal.review.status === "running" && <p className="review-running"><LoaderCircle className="spin" size={14} />Анализ выполняется; отчёт обновляется.</p>}
            <button type="button" className="text-action wide-action" onClick={() => jsonDownload(active, `rehearsal-${active.id}.json`)}><ArrowDownToLine size={15} />Скачать отчёт JSON</button>
          </div>}
          {audioUrl && <div className="audio-player"><label htmlFor="rehearsal-audio"><Volume2 size={15} /> Архивная запись</label><audio id="rehearsal-audio" controls src={audioUrl} /></div>}
        </section>
        <section className="compare-section drawer-section">
          <div className="section-title-row"><div><p className="overline">СРАВНЕНИЕ СНИМКОВ</p><h2>Два результата</h2></div><span>{compareResults.length}/2 выбрано</span></div>
          {compareResults.length === 2 ? <div className="compare-grid">{compareResults.map((result) => <div key={result.id} className="compare-card">
            <h3>{result.rehearsal.scene.title}</h3><p>{result.rehearsal.version.label} · {result.status}</p>
            <div className="snapshot-hashes"><span>Поручение <code>{result.rehearsal.scene.hash}</code></span><span>Версия <code>{result.rehearsal.version.hash}</code></span></div>
            {!sameRehearsalSceneSnapshot(compareResults[0], compareResults[1]) && <p className="different-scene"><AlertCircle size={14} /> Разные снимки поручения — сравнение неэквивалентно.</p>}
            <details open><summary>Транскрипт</summary><pre>{pretty(result.turns.map((turn) => ({ role: turn.role, text: turn.text, atMs: turn.atMs })))}</pre></details>
            <details><summary>Leva / Toma / факты</summary><pre>{pretty({ leva: result.rehearsal.review.leva, toma: result.rehearsal.review.toma, model: result.model, voice: result.voice, engine: result.engine })}</pre></details>
            <button type="button" className="text-action" onClick={() => toggleCompare(result)}>Убрать из сравнения</button>
          </div>)}</div> : <div className="empty-history compare-empty"><p>Выберите два результата из истории.</p><span>Хэши снимков показываются явно.</span></div>}
        </section>
        <footer className="rehearsal-footer">Катя · внутренняя репетиция, не реальный исходящий звонок</footer>
      </section>
    </div>}
  </main>;
}
