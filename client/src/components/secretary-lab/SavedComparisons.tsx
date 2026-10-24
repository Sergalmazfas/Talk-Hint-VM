import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Download, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { labRequest, formatLabTime } from "@/lib/secretary-lab";
import "./saved-comparisons.css";

type Mode = "gpt" | "retell" | "retell-engine" | "eleven-engine";
type Evaluation = { score: number | null; note: string };
type RunIdentity = { mode: Mode; id: string; runtime: string; model: string; voice: string };
type Candidate = RunIdentity & { instruction: string; createdAt: string; status: "ended" | "failed" };
type Summary = {
  id: string;
  title: string;
  instruction: string;
  createdAt: string;
  expiresAt: string;
  evaluation: Evaluation;
  runs: RunIdentity[];
};
type SavedRun = RunIdentity & {
  verification?: string;
  instruction: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  turns: Array<{ id?: string; role?: string; text?: string; atMs?: number; [key: string]: unknown }>;
  events: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  engine?: Record<string, unknown>;
};
type SavedComparison = Omit<Summary, "runs"> & { runs: SavedRun[] };

const API = "/api/admin/secretary-lab/comparisons";
const modeLabel: Record<Mode, string> = { gpt: "GPT", retell: "Retell", "retell-engine": "Retell + Engine", "eleven-engine": "ElevenLabs + Engine" };
const candidateKey = (candidate: Pick<Candidate, "mode" | "id">) => `${candidate.mode}:${candidate.id}`;
const humanDate = (date: string) => formatLabTime(date);
const pretty = (value: unknown) => value === undefined ? "Не сообщено" : JSON.stringify(value, null, 2);

function downloadComparison(record: SavedComparison) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `secretary-comparison-${record.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportView({ record }: { record: SavedComparison }) {
  return <div className="saved-report-list">
    {record.runs.map((run) => <article className="saved-report" key={`${run.mode}:${run.id}`}>
      <header className="saved-report-head">
        <div><span className="saved-kicker">{modeLabel[run.mode] || run.mode} · {run.status}</span><h3>{run.runtime || "Runtime не сообщён"}</h3></div>
        <div className="saved-run-facts"><span><small>ФАКТИЧЕСКАЯ МОДЕЛЬ</small><b>{run.model || "Не сообщена"}</b></span><span><small>ФАКТИЧЕСКИЙ ГОЛОС</small><b>{run.voice || "Не сообщён"}</b></span></div>
      </header>
      <div className="saved-report-meta"><span>Создан {humanDate(run.createdAt)}</span><span>{run.endedAt ? `Завершён ${humanDate(run.endedAt)}` : "Время завершения не сообщено"}</span><span>ID · {run.id}</span></div>
      <p className="saved-muted">Источник проверки: {run.verification || "Не указан"}. Проверенная конфигурация не доказывает слышимость голоса или качество телефонного звонка.</p>
      <details className="saved-data-block" open>
        <summary>Инструкция</summary><p className="saved-instruction">{run.instruction || "Инструкция отсутствует в отчёте."}</p>
      </details>
      <details className="saved-data-block" open>
        <summary>Транскрипт · {run.turns?.length ?? 0} реплик</summary>
        {run.turns?.length ? <div className="saved-turns">{run.turns.map((turn, index) => <div className={`saved-turn ${turn.role === "secretary" ? "secretary" : "guest"}`} key={turn.id || index}>
          <small>{turn.role === "secretary" ? "СЕКРЕТАРЬ" : turn.role === "guest" ? "СОБЕСЕДНИК" : turn.role || "РЕПЛИКА"}{typeof turn.atMs === "number" ? ` · ${(turn.atMs / 1000).toFixed(1)} сек.` : ""}</small>
          <p>{turn.text || "Текст не сообщён"}</p>
          {Object.entries(turn).filter(([key]) => !["id", "role", "text", "atMs"].includes(key)).length > 0 && <pre>{pretty(Object.fromEntries(Object.entries(turn).filter(([key]) => !["id", "role", "text", "atMs"].includes(key))))}</pre>}
        </div>)}</div> : <p className="saved-muted">В сохранённом отчёте нет реплик.</p>}
      </details>
      <details className="saved-data-block"><summary>Метрики</summary><pre>{pretty(run.metrics)}</pre></details>
      <details className="saved-data-block"><summary>События · {run.events?.length ?? 0}</summary><pre>{pretty(run.events)}</pre></details>
      <details className="saved-data-block"><summary>Ручные наблюдения · {run.observations?.length ?? 0}</summary><pre>{pretty(run.observations)}</pre></details>
      {run.engine && <details className="saved-data-block"><summary>Test-only Engine ledger</summary><pre>{pretty(run.engine)}</pre></details>}
      <details className="saved-data-block"><summary>Полный сохранённый отчёт · sanitized JSON</summary><pre>{pretty(run)}</pre></details>
    </article>)}
  </div>;
}

export default function SavedComparisons({ token }: { token: string }) {
  const [items, setItems] = useState<Summary[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [listLoading, setListLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [candidateError, setCandidateError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [evaluationNote, setEvaluationNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [detail, setDetail] = useState<SavedComparison | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRequestId, setDetailRequestId] = useState("");
  const [editingEvaluation, setEditingEvaluation] = useState(false);
  const [editScore, setEditScore] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const requestEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const loadComparisons = useCallback(async (activeToken: string) => {
    const epoch = requestEpoch.current;
    setListLoading(true); setListError("");
    try {
      const result = await labRequest<{ retentionDays: number; items: Summary[] }>(API, activeToken);
      if (epoch !== requestEpoch.current || tokenRef.current !== activeToken) return;
      setItems(result.items || []); setRetentionDays(result.retentionDays ?? 30);
    } catch (cause) {
      if (epoch === requestEpoch.current && tokenRef.current === activeToken) setListError((cause as Error).message || "Не удалось загрузить сохранённые сравнения.");
    } finally {
      if (epoch === requestEpoch.current && tokenRef.current === activeToken) setListLoading(false);
    }
  }, []);
  const loadCandidates = useCallback(async (activeToken: string) => {
    const epoch = requestEpoch.current;
    setCandidateLoading(true); setCandidateError("");
    try {
      const result = await labRequest<{ runs: Candidate[] }>(`${API}/candidates`, activeToken);
      if (epoch !== requestEpoch.current || tokenRef.current !== activeToken) return;
      const runs = result.runs || [];
      setCandidates(runs);
      setSelectedIds(old => old.filter(id => runs.some(run => candidateKey(run) === id)));
    } catch (cause) {
      if (epoch === requestEpoch.current && tokenRef.current === activeToken) setCandidateError((cause as Error).message || "Не удалось загрузить доступные прогоны.");
    } finally {
      if (epoch === requestEpoch.current && tokenRef.current === activeToken) setCandidateLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    requestEpoch.current++;
    const currentToken = token;
    if (!currentToken) return;
    setDetail(null); setDetailLoading(false); setDetailError(""); detailEpoch.current++;
    void loadComparisons(currentToken);
    void loadCandidates(currentToken);
  }, [loadCandidates, loadComparisons, token]);
  useEffect(() => {
    requestEpoch.current++;
    detailEpoch.current++;
    setItems([]); setCandidates([]); setSelectedIds([]); setDetail(null); setDetailLoading(false); setDetailError(""); setDetailRequestId("");
    setListError(""); setCandidateError(""); setActionError(""); setActionNotice("");
    setListLoading(true); setCandidateLoading(true);
    if (token) {
      void loadComparisons(token);
      void loadCandidates(token);
    } else {
      setListLoading(false); setCandidateLoading(false);
    }
    return () => { requestEpoch.current++; detailEpoch.current++; };
  }, [token, loadCandidates, loadComparisons]);

  const chosen = useMemo(() => candidates.filter((candidate) => selectedIds.includes(candidateKey(candidate))), [candidates, selectedIds]);
  const instructionSet = chosen[0]?.instruction;
  const hasMatchingInstruction = chosen.every((candidate) => candidate.instruction === instructionSet);
  const canSave = chosen.length >= 1 && chosen.length <= 6 && chosen.length === selectedIds.length &&
    hasMatchingInstruction && !!title.trim() && consent && !saving && !candidateLoading;

  const toggleCandidate = (candidate: Candidate) => {
    const key = candidateKey(candidate);
    setActionError(""); setActionNotice("");
    setSelectedIds((old) => old.includes(key) ? old.filter((id) => id !== key) :
      old.length >= 6 || (old.length > 0 && chosen[0]?.instruction !== candidate.instruction) ? old : [...old, key]);
  };
  const openDetail = async (id: string) => {
    const epoch = ++detailEpoch.current;
    setDetailRequestId(id);
    setEditingEvaluation(false);
    setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const saved = await labRequest<SavedComparison>(`${API}/${encodeURIComponent(id)}`, token);
      if (epoch === detailEpoch.current && tokenRef.current === token) {
        setDetail(saved); setEditScore(saved.evaluation.score === null ? "" : String(saved.evaluation.score)); setEditNote(saved.evaluation.note || "");
      }
    } catch (cause) {
      if (epoch === detailEpoch.current && tokenRef.current === token) setDetailError((cause as Error).message || "Не удалось открыть сохранённый отчёт.");
    } finally {
      if (epoch === detailEpoch.current && tokenRef.current === token) setDetailLoading(false);
    }
  };
  const createComparison = async () => {
    if (!canSave) return;
    setSaving(true); setActionError(""); setActionNotice("");
    try {
      const saved = await labRequest<SavedComparison>(API, token, { method: "POST", body: JSON.stringify({
        title: title.trim(), consent: true,
        sources: chosen.map(({ mode, id }) => ({ mode, id })),
        evaluation: { score: score ? Number(score) : null, note: evaluationNote.trim() },
      }) });
      if (tokenRef.current !== token) return;
      setTitle(""); setScore(""); setEvaluationNote(""); setConsent(false); setSelectedIds([]);
      setActionNotice("Сравнение сохранено в базе разработки. Срок хранения отсчитывается от первоначального сохранения.");
      setDetail(saved); setEditScore(saved.evaluation.score === null ? "" : String(saved.evaluation.score)); setEditNote(saved.evaluation.note || "");
      setDetailLoading(false); setDetailError("");
      detailEpoch.current++;
      void loadComparisons(token);
      void loadCandidates(token);
    } catch (cause) {
      if (tokenRef.current === token) setActionError((cause as Error).message || "Не удалось сохранить сравнение. Проверьте выбор и попробуйте снова.");
    } finally { if (tokenRef.current === token) setSaving(false); }
  };
  const saveEvaluation = async () => {
    if (!detail) return;
    const epoch = detailEpoch.current;
    setEditing(true); setActionError("");
    try {
      const updated = await labRequest<SavedComparison>(`${API}/${encodeURIComponent(detail.id)}`, token, { method: "PATCH", body: JSON.stringify({
        evaluation: { score: editScore ? Number(editScore) : null, note: editNote.trim() },
      }) });
      if (tokenRef.current !== token || detailEpoch.current !== epoch) return;
      setDetail(updated); setItems((old) => old.map((item) => item.id === updated.id ? { ...item, evaluation: updated.evaluation } : item));
      setEditingEvaluation(false); setActionNotice("Оценка обновлена.");
    } catch (cause) { if (tokenRef.current === token) setActionError((cause as Error).message || "Не удалось обновить оценку."); }
    finally { if (tokenRef.current === token) setEditing(false); }
  };
  const deleteComparison = async () => {
    if (!detail || !window.confirm(`Удалить «${detail.title}»? Это удалит сохранённые отчёты без возможности восстановления.`)) return;
    const deletedId = detail.id;
    setDeleting(true); setActionError("");
    const epoch = ++detailEpoch.current;
    try {
      await labRequest<unknown>(`${API}/${encodeURIComponent(deletedId)}`, token, { method: "DELETE" });
      if (tokenRef.current !== token || epoch !== detailEpoch.current) return;
      setItems((old) => old.filter((item) => item.id !== deletedId));
      setDetail(null); setActionNotice("Сравнение удалено.");
    } catch (cause) { if (tokenRef.current === token) setActionError((cause as Error).message || "Не удалось удалить сравнение."); }
    finally { if (tokenRef.current === token) setDeleting(false); }
  };

  return <section id="saved-comparisons" className="saved-comparisons" aria-labelledby="saved-comparisons-title">
    <div className="saved-section-heading">
      <div><p className="saved-eyebrow">06 / ИЗБРАННЫЕ СРАВНЕНИЯ</p><h2 id="saved-comparisons-title">Сохранённые прогоны</h2><p>Отдельная постоянная запись — только по вашему явному выбору.</p></div>
      <Button variant="outline" onClick={refresh} disabled={!token || listLoading || candidateLoading}><RefreshCw size={15} className={listLoading || candidateLoading ? "saved-spin" : ""} /> Обновить</Button>
    </div>
    <div className="saved-retention-note"><ShieldCheck size={18} /><p><b>Не сохраняется автоматически.</b> Выбранные прогоны, инструкция, транскрипты, события, test-only Engine ledger и ручная оценка сохраняются в Dev-базе на {retentionDays} дней с момента первоначального сохранения. Другие администраторы этого закрытого стенда тоже могут читать, оценивать и удалять записи. После истечения срока запись недоступна; физическая очистка — при запуске Dev и ежечасно во время его работы. Можно удалить раньше. <b>Аудио, токены и capability URL не сохраняются; ссылки в тексте удаляются.</b> Скачанные JSON-копии удаление не затрагивает.</p></div>
    {(actionError || actionNotice) && <div className={`saved-feedback ${actionError ? "error" : "success"}`} role={actionError ? "alert" : "status"}>{actionError ? <AlertCircle size={16} /> : <Check size={16} />}{actionError || actionNotice}</div>}

    <div className="saved-comparison-grid">
      <div className="saved-create-panel">
        <div className="saved-panel-heading"><span>01 / СОБРАТЬ ВЫБОРКУ</span><b>Явное сохранение</b></div>
        <div className="saved-candidate-heading"><span>Завершённые источники</span><small>{selectedIds.length}/6 выбрано</small></div>
        {candidateLoading ? <div className="saved-skeleton"><i /><i /><i /></div> : candidateError ? <div className="saved-inline-error"><p>{candidateError}</p><Button size="sm" variant="outline" onClick={() => void loadCandidates(token)}>Повторить</Button></div> :
          candidates.length ? <div className="saved-candidates">{candidates.map((candidate) => {
            const checked = selectedIds.includes(candidateKey(candidate));
            const incompatible = selectedIds.length > 0 && chosen[0]?.instruction !== candidate.instruction;
            return <label key={`${candidate.mode}:${candidate.id}`} className={`saved-candidate ${checked ? "checked" : ""} ${!checked && (selectedIds.length >= 6 || incompatible) ? "disabled" : ""}`}>
              <input type="checkbox" checked={checked} disabled={!checked && (selectedIds.length >= 6 || incompatible)} onChange={() => toggleCandidate(candidate)} />
              <span className="saved-check-mark">{checked && <Check size={13} />}</span>
              <span className="saved-candidate-copy"><b>{modeLabel[candidate.mode] || candidate.mode} <small>{candidate.status}</small></b><span>{candidate.runtime} · {candidate.model} · {candidate.voice}</span><small>{humanDate(candidate.createdAt)} · {candidate.id}</small></span>
            </label>;
          })}</div> : <div className="saved-empty">Нет доступных завершённых прогонов. Список берётся отдельно от readiness и провайдеров.</div>}
        {chosen.length > 0 && <p className={`saved-match-note ${hasMatchingInstruction ? "" : "invalid"}`}>{hasMatchingInstruction ? "Инструкция совпадает у всех выбранных источников." : "Источники должны иметь идентичную инструкцию."}</p>}
        <label className="saved-field-label" htmlFor="saved-comparison-title">Название сравнения</label>
        <input id="saved-comparison-title" className="saved-input" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, перенос после удержания" />
        <div className="saved-evaluation-fields">
          <label><span>Оценка · 1–5</span><select value={score} onChange={(event) => setScore(event.target.value)}><option value="">Без оценки</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
          <label><span>Ручная заметка</span><textarea value={evaluationNote} maxLength={2000} onChange={(event) => setEvaluationNote(event.target.value)} placeholder="Что сработало, что проверить дальше" /></label>
        </div>
        <label className="saved-opt-in"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><b>Сохранить выбранные данные явно.</b> Понимаю состав записи, срок хранения {retentionDays} дней от первоначального сохранения и возможность удалить её раньше.</span></label>
        <Button className="saved-save-button" disabled={!canSave} onClick={() => void createComparison()}>{saving ? <><RefreshCw size={15} className="saved-spin" /> Сохраняем…</> : <><Save size={15} /> Сохранить сравнение</>}</Button>
        <p className="saved-source-warning">В запрос отправляются только ID и режимы источников, не тело отчёта. Сервер повторно проверяет совместимость.</p>
      </div>

      <div className="saved-library-panel">
        <div className="saved-panel-heading"><span>02 / БИБЛИОТЕКА</span><b>Хранимые записи</b></div>
        {listLoading ? <div className="saved-skeleton"><i /><i /><i /></div> : listError ? <div className="saved-inline-error"><p>{listError}</p><Button size="sm" variant="outline" onClick={() => void loadComparisons(token)}>Повторить</Button></div> :
          items.length ? <div className="saved-library-list">{items.map((item) => <button key={item.id} className={`saved-library-item ${detail?.id === item.id ? "current" : ""}`} onClick={() => void openDetail(item.id)}>
            <span className="saved-record-mark" />
            <span className="saved-library-copy"><b>{item.title}</b><span>{item.runs.map((run) => modeLabel[run.mode] || run.mode).join(" + ")}</span><small>Создано {humanDate(item.createdAt)} · истекает {humanDate(item.expiresAt)}</small></span>
            <span className="saved-library-score">{item.evaluation.score ?? "—"}<small>/ 5</small></span>
          </button>)}</div> : <div className="saved-empty">Пока нет сохранённых сравнений.<small>Временная история прогонов не является сохранённой записью.</small></div>}
      </div>
    </div>

    <div className="saved-detail-panel">
      {detailLoading ? <div className="saved-detail-loading"><i /><i /><i /></div> : detailError ? <div className="saved-inline-error"><p>{detailError}</p><Button size="sm" variant="outline" onClick={() => { if (detailRequestId) void openDetail(detailRequestId); }}>Повторить</Button></div> : detail ? <>
        <div className="saved-detail-heading"><div><p className="saved-eyebrow">СОХРАНЁННАЯ ЗАПИСЬ · {detail.runs.length} ПРОГОНОВ</p><h3>{detail.title}</h3><p>Создано {humanDate(detail.createdAt)} · истекает {humanDate(detail.expiresAt)}</p></div>
          <div className="saved-detail-actions"><Button variant="outline" onClick={() => downloadComparison(detail)}><Download size={15} /> JSON</Button><Button variant="outline" disabled={deleting} onClick={() => void deleteComparison()}><Trash2 size={15} /> {deleting ? "Удаляем…" : "Удалить"}</Button></div>
        </div>
        <div className="saved-edit-evaluation">
          <div className="saved-eval-readout"><span>РУЧНАЯ ОЦЕНКА</span><b>{detail.evaluation.score === null ? "Без оценки" : `${detail.evaluation.score} / 5`}</b><p>{detail.evaluation.note || "Заметки нет."}</p></div>
          {!editingEvaluation ? <Button variant="outline" onClick={() => setEditingEvaluation(true)}>Изменить оценку</Button> :
            <div className="saved-edit-form"><label>Оценка<select value={editScore} onChange={(event) => setEditScore(event.target.value)}><option value="">Без оценки</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><label>Заметка<textarea value={editNote} maxLength={2000} onChange={(event) => setEditNote(event.target.value)} /></label><Button disabled={editing} onClick={() => void saveEvaluation()}>{editing ? "Сохраняем…" : "Сохранить оценку"}</Button><Button variant="outline" onClick={() => setEditingEvaluation(false)}>Отмена</Button></div>}
        </div>
        <ReportView record={detail} />
      </> : <div className="saved-detail-empty"><span>ОТЧЁТЫ ПО ЗАПРОСУ</span><p>Выберите сохранённую запись, чтобы прочитать все отчёты, сравнить фактический runtime/model/voice и скачать серверную sanitized-копию.</p></div>}
    </div>
  </section>;
}
