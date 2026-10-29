import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, ArrowLeft, Check, Circle, Clock3, Database, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CutoverAction = "activate" | "probe" | "open_writes" | "rollback" | "reactivate" | "reconcile";
type Phase = "shadow" | "verifying" | "active" | "checkpoint" | "unprepared";

interface CutoverStatus {
  csrfToken: string;
  approved: boolean | null;
  environment: string;
  source: {
    workspace: string;
    revision: number;
    rootHash: string;
    manifestHash: string;
  };
  phase: Phase;
  writesOpen: boolean;
  probeReady?: boolean;
  checkpoint?: {
    revision: number;
    semanticHash: string;
  };
  operations?: Array<{ action: string; state: string }>;
  error?: string;
}

const STATUS_URL = "/api/admin/company-cutover/status";
const GRANT_URL = "/api/admin/company-cutover/grant";
const EXECUTE_URL = "/api/admin/company-cutover/execute";

const phaseCopy: Record<Phase, { label: string; detail: string; tone: string }> = {
  shadow: {
    label: "Теневой режим",
    detail: "Источник подготовлен, но не обслуживает телефонные подсказки. Активация требует отдельного подтверждения владельца.",
    tone: "amber",
  },
  verifying: {
    label: "Проверка источника",
    detail: "Проверьте источник операцией probe. Запись можно открыть только после успешной проверки.",
    tone: "teal",
  },
  active: {
    label: "Источник активен",
    detail: "Переключение завершено. Состояние записи отображается отдельно от фазы источника.",
    tone: "teal",
  },
  checkpoint: {
    label: "Контрольная точка",
    detail: "Снимок сохранён. Повторная активация доступна только из этого состояния.",
    tone: "amber",
  },
  unprepared: {
    label: "Источник не подготовлен",
    detail: "Сервер не подтвердил готовность. Эта страница не может подготовить или разрешить источник.",
    tone: "rose",
  },
};

const actions: Array<{ action: CutoverAction; label: string; description: string }> = [
  { action: "reconcile", label: "Сверено — разрешить повтор", description: "Проверить исходный теневой пакет и отсутствие другого процесса. Не включает базу: повторное включение потребует отдельного нажатия и нового разрешения." },
  { action: "activate", label: "Активировать источник", description: "Переключить подсказки на закреплённую книгу из теневого режима." },
  { action: "probe", label: "Проверить источник", description: "Выполнить проверочную операцию без открытия записи." },
  { action: "open_writes", label: "Открыть запись", description: "Разрешить запись только после успешной проверки источника." },
  { action: "rollback", label: "Создать контрольную точку", description: "Сохранить контрольную точку и закрыть запись." },
  { action: "reactivate", label: "Повторно активировать", description: "Вернуться к источнику из контрольной точки." },
];

async function responseError(response: Response) {
  let message = "";
  try {
    const body = await response.json();
    if (typeof body?.error === "string") message = body.error;
    else if (typeof body?.message === "string") message = body.message;
  } catch {
    // Use the HTTP status when the server response is not JSON.
  }
  if (response.status === 401) return `Требуется вход владельца (401). ${message}`.trim();
  if (response.status === 403) return `Сервер отказал в доступе (403). ${message}`.trim();
  return message || `Сервер ответил с ошибкой (${response.status}).`;
}

function formatHash(value: string | undefined) {
  return value || "Не получен от сервера";
}

function operationStateLabel(state: string | undefined) {
  if (!state) return "Нет";
  if (state === "running") return "Выполняется";
  if (state === "succeeded") return "Завершена";
  if (state === "failed") return "Ошибка";
  return "Требует сверки";
}

export default function CompanyCutover() {
  const [status, setStatus] = useState<CutoverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedAction, setSelectedAction] = useState<CutoverAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const statusRef = useRef<CutoverStatus | null>(null);
  statusRef.current = status;

  const refreshStatus = useCallback(async (quiet = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) {
      setRefreshing(true);
      if (!statusRef.current) setLoading(true);
    }
    try {
      const response = await fetch(STATUS_URL, {
        credentials: "same-origin",
        headers: { "Cache-Control": "no-store" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const next = (await response.json()) as CutoverStatus;
      if (!next || (typeof next.approved !== "boolean" && next.approved !== null) || !next.source || typeof next.phase !== "string") {
        throw new Error("Сервер вернул неполный статус переключения.");
      }
      if (mounted.current) {
        setStatus(next);
        setLoadError("");
      }
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Не удалось получить статус переключения.");
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
    };
  }, [refreshStatus]);

  const latestOperation = status?.operations?.[0];
  const operationRunning = latestOperation?.state === "running" || latestOperation?.state === "queued";

  useEffect(() => {
    if (!operationRunning) return;
    const timer = window.setInterval(() => void refreshStatus(true), 5000);
    return () => window.clearInterval(timer);
  }, [operationRunning, refreshStatus]);

  const latestProbe = status?.operations?.find((operation) => operation.action === "probe");
  const probeSucceeded = status?.probeReady === true && latestProbe?.state === "succeeded";

  const actionAvailable = (action: CutoverAction) => {
    if (!status || !status.approved || (operationRunning && action !== "rollback") || submitting || !status.csrfToken) return false;
    if (latestOperation?.state === "failed" && !["rollback", "reactivate", "reconcile"].includes(action)) return false;
    switch (action) {
      case "reconcile": return status.phase === "shadow" && !status.writesOpen &&
        latestOperation?.state === "failed" && ["activate", "reconcile"].includes(latestOperation.action);
      case "activate": return status.phase === "shadow";
      case "probe": return status.phase === "verifying";
      case "open_writes": return status.phase === "verifying" && probeSucceeded && !status.writesOpen;
      case "rollback": return status.phase === "verifying" || status.phase === "active";
      case "reactivate": return status.phase === "checkpoint";
    }
  };

  const confirmAction = async () => {
    if (!selectedAction || !status || !actionAvailable(selectedAction)) return;
    const action = selectedAction;
    const expected = status.source;
    setSubmitting(true);
    setActionError("");
    setSelectedAction(null);
    let grantIssued = false;
    try {
      const grantResponse = await fetch(GRANT_URL, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "x-company-csrf": status.csrfToken,
        },
        body: JSON.stringify({ action, confirm: true, expected }),
      });
      if (!grantResponse.ok) throw new Error(await responseError(grantResponse));
      const grantBody = await grantResponse.json() as { grant?: unknown };
      if (!grantBody || grantBody.grant === undefined || grantBody.grant === null) {
        throw new Error("Сервер не вернул разрешение на операцию.");
      }
      grantIssued = true;

      const executeResponse = await fetch(EXECUTE_URL, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "x-company-csrf": status.csrfToken,
        },
        body: JSON.stringify({ action, grant: grantBody.grant, confirm: true, expected }),
      });
      if (executeResponse.status !== 202) throw new Error(await responseError(executeResponse));
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось подтвердить операцию.";
      setActionError(
        `${grantIssued
          ? "Ответ на операцию не подтверждён. Не отправляйте её повторно: сначала обновите статус и согласуйте результат с владельцем."
          : "Разрешение не получено. Проверьте статус перед любым следующим действием."} ${message}`,
      );
      await refreshStatus();
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const phase = status ? phaseCopy[status.phase] : null;
  const selected = selectedAction ? actions.find((item) => item.action === selectedAction) : null;
  const blockedByApproval = status !== null && !status.approved;

  return (
    <main className="min-h-[100dvh] bg-[#f1f3f0] px-4 pb-12 text-[#23312d] sm:px-7">
      <header className="mx-auto flex min-h-[68px] max-w-6xl items-center justify-between border-b border-[#d3dbd5]">
        <a href="/admin" className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-[#29483e] transition-colors hover:text-[#167768] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#087e83]">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#29483e] text-xs font-bold tracking-tight text-[#f3f5f1]">TH</span>
          TalkHint <span className="hidden font-normal text-[#75847d] sm:inline">администрирование</span>
        </a>
        <a href="/admin" className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-[#62736b] transition-colors hover:bg-[#e5ebe6] hover:text-[#29483e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>В админ-панель</span>
        </a>
      </header>

      <div className="mx-auto max-w-6xl py-8 sm:py-12">
        <div className="mb-7 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b8982]">
          <span>Владелец</span><span aria-hidden="true">/</span><span>Перенос компании</span><span aria-hidden="true">/</span><span className="text-[#087e83]">Переключение</span>
        </div>

        <section className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-14">
          <div className="min-w-0">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.19em] text-[#087e83]">Управление только владельцем</p>
            <h1 className="max-w-3xl text-[clamp(2.1rem,6vw,4.4rem)] font-semibold leading-[1.02] tracking-[-0.055em] text-[#233b33]">
              Переключение<br className="hidden sm:block" /> книги компании
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#60716a] sm:text-lg">
              Управляйте источником телефонных подсказок по состоянию сервера. Проверка статуса только читает состояние и ничего не активирует.
            </p>

            <div className="mt-8 flex items-start gap-3 rounded-xl border border-[#c9dcd5] bg-[#e7f1ed] p-4 sm:p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#087e83]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-bold text-[#29483e]">Публикация не включает источник</h2>
                <p className="mt-1 text-sm leading-6 text-[#5a7068]">
                  Публикация и подготовка книги сами по себе не переключают телефонные подсказки. Здесь каждая операция требует отдельного подтверждения.
                </p>
              </div>
            </div>

            <section className="mt-8 overflow-hidden rounded-xl border border-[#d4ded7] bg-[#fafbf8] shadow-[0_8px_28px_rgba(38,72,60,0.045)]" aria-labelledby="cutover-heading">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8e2] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#87948d]">Состояние на сервере</p>
                  <h2 id="cutover-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#29483e]">Сводка переключения</h2>
                </div>
                <button type="button" onClick={() => void refreshStatus()} disabled={loading || refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d6e0da] px-3 text-xs font-semibold text-[#4d665c] transition-colors hover:bg-[#eff5f1] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                  Обновить статус
                </button>
              </div>

              {loading && !status ? (
                <div className="space-y-4 p-5 sm:p-6" aria-label="Загрузка сводки" aria-busy="true">
                  <div className="h-5 w-40 animate-pulse rounded bg-[#e5ece7]" />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[76px] animate-pulse rounded-lg bg-[#edf2ee]" />)}</div>
                  <div className="h-12 animate-pulse rounded-lg bg-[#edf2ee]" />
                </div>
              ) : loadError && !status ? (
                <div className="p-5 sm:p-6" role="alert">
                  <div className="flex gap-3 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] p-4 text-[#8b443d]">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Не удалось загрузить состояние переключения</p>
                      <p className="mt-1 break-words text-sm leading-6">{loadError}</p>
                      {loadError.includes("(401)") || loadError.includes("(403)") ? <a href="/admin/login" className="mt-2 inline-block font-semibold underline underline-offset-2">Войти в TalkHint</a> : null}
                    </div>
                  </div>
                  <button type="button" onClick={() => void refreshStatus()} className="mt-4 min-h-10 rounded-md bg-[#29483e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1d3930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">Повторить загрузку</button>
                </div>
              ) : status && phase ? (
                <div className="p-5 sm:p-6">
                  {loadError && <div role="alert" className="mb-4 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] px-4 py-3 text-sm leading-6 text-[#8b443d]">Ошибка обновления статуса: {loadError}</div>}
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${phase.tone === "teal" ? "bg-[#dff0e9] text-[#087e83]" : phase.tone === "rose" ? "bg-[#fae6e2] text-[#a24f45]" : "bg-[#f8edda] text-[#956426]"}`}>
                      {operationRunning ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : status.phase === "active" ? <Check className="h-4 w-4" aria-hidden="true" /> : status.phase === "unprepared" ? <LockKeyhole className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#29483e]" aria-live="polite">{operationRunning ? "Операция выполняется" : phase.label}</p>
                      <p className="mt-1 text-sm leading-6 text-[#718078]">{operationRunning ? "Сервер выполняет операцию. Состояние обновляется автоматически каждые 5 секунд." : phase.detail}</p>
                    </div>
                  </div>

                  {status.error && <div className="mt-4 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] px-4 py-3 text-sm leading-6 text-[#8b443d]" role="alert"><span className="font-semibold">Сообщение сервера: </span>{status.error}</div>}

                  <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Среда" value={status.environment || "—"} />
                    <Metric label="Ревизия" value={Number.isFinite(status.source.revision) ? `r${status.source.revision}` : "—"} />
                    <Metric label="Запись" value={status.writesOpen ? "Открыта" : "Закрыта"} />
                    <Metric label="Последняя операция" value={operationStateLabel(latestOperation?.state)} />
                  </div>

                  <div className="mt-3 rounded-lg border border-[#e1e8e2] bg-[#f4f7f4] p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#84928a]"><Database className="h-3.5 w-3.5" aria-hidden="true" />Источник и закреплённые хеши</div>
                    <p className="mt-2 break-all text-xs leading-5 text-[#3f5b50]">Рабочая область: <span className="font-mono">{status.source.workspace || "—"}</span></p>
                    <p className="mt-1 break-all text-xs leading-5 text-[#3f5b50]">Корневой хеш: <span className="font-mono">{formatHash(status.source.rootHash)}</span></p>
                    <p className="mt-1 break-all text-xs leading-5 text-[#3f5b50]">Хеш манифеста: <span className="font-mono">{formatHash(status.source.manifestHash)}</span></p>
                    {status.checkpoint && <p className="mt-2 break-all text-xs leading-5 text-[#3f5b50]">Контрольная точка: r{status.checkpoint.revision} · <span className="font-mono">{status.checkpoint.semanticHash}</span></p>}
                  </div>

                  <div className="mt-5 border-t border-[#e2e8e2] pt-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="max-w-md text-xs leading-5 text-[#819087]">
                        {blockedByApproval ? "Действия недоступны: сервер не выдал разрешение владельца для этой среды." : operationRunning ? "Дождитесь завершения операции. Не отправляйте её повторно." : "После неопределённого результата обновите статус и согласуйте состояние; повторная отправка не выполняется."}
                      </div>
                      <div className="grid w-full gap-2 sm:w-auto sm:min-w-[230px]">
                        {actions.filter(({ action }) => actionAvailable(action)).map(({ action, label }) => (
                          <button key={action} type="button" onClick={() => setSelectedAction(action)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#29483e] px-4 text-sm font-semibold text-[#f3f5f1] transition-[background-color,transform,opacity] hover:-translate-y-0.5 hover:bg-[#1d3930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />{label}
                          </button>
                        ))}
                        {actions.every(({ action }) => !actionAvailable(action)) && (
                          <div className="rounded-md border border-[#e1e8e2] bg-[#f7f9f6] px-4 py-3 text-center text-xs font-semibold leading-5 text-[#78877f]">
                            {blockedByApproval ? "Ожидается разрешение владельца" : operationRunning ? "Операция выполняется" : "Нет доступных действий для этой фазы"}
                          </div>
                        )}
                      </div>
                    </div>
                    {actionError && <div className="mt-4 flex gap-3 rounded-lg border border-[#e5c6a4] bg-[#fff7e9] p-4 text-sm leading-6 text-[#805522]" role="alert"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><p>{actionError}</p></div>}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="lg:pt-2">
            <div className="rounded-xl border border-[#d4ded7] bg-[#e9efea] p-5 sm:p-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#829189]">Безопасный порядок</p>
              <ol className="mt-5 space-y-5">
                <Step number="01" title="Проверить статус" active={Boolean(status)}><>Запрос статуса только читает состояние. Он не выдаёт разрешение и не активирует источник.</></Step>
                <Step number="02" title="Сверить источник" active={Boolean(status?.source.manifestHash)}><>Операции отправляются с закреплёнными данными текущей ревизии.</></Step>
                <Step number="03" title="Подтвердить действие" active={Boolean(status?.approved)}><>Каждое действие требует подтверждения и серверного разрешения владельца.</></Step>
              </ol>
              <div className="mt-6 flex items-start gap-2 border-t border-[#d5dfd8] pt-4 text-xs leading-5 text-[#73827a]">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#7c9386]" aria-hidden="true" />
                <p>Откат сохраняет последние записи и оставляет запись закрытой. Обычные незавершённые операции требуют сверки — не отправляйте их повторно.</p>
              </div>
            </div>
          </aside>
        </section>
      </div>

      <Dialog open={Boolean(selectedAction)} onOpenChange={(open) => { if (!open && !submitting) setSelectedAction(null); }}>
        <DialogContent className="border-[#d4ded7] bg-[#fafbf8] text-[#233b33] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.03em]">Подтвердить действие?</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#66776f]">
              {selected ? `${selected.description} Текущая ревизия источника: r${status?.source.revision ?? "—"}.` : "Выберите действие для продолжения."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-[#dce5de] bg-[#f0f5f1] p-4 text-sm leading-6 text-[#536960]">
            {selectedAction === "rollback"
              ? "Откат сохраняет последние записи, созданные после переключения, и оставляет запись закрытой. Проверьте результат по статусу; не отправляйте операцию повторно."
              : "Сервер сначала выдаст одноразовое разрешение, затем выполнит действие. Если результат неясен, обновите статус и не отправляйте запрос повторно."}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setSelectedAction(null)} disabled={submitting} className="min-h-11 rounded-md border border-[#d4ded7] px-4 text-sm font-semibold text-[#50665c] transition-colors hover:bg-[#eff4f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">Отмена</button>
            <button type="button" onClick={() => void confirmAction()} disabled={!selectedAction || !actionAvailable(selectedAction)} className="min-h-11 rounded-md bg-[#29483e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1d3930] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">{submitting ? "Отправка…" : "Подтвердить действие"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#e1e8e2] bg-[#f7f9f6] px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#89968f]">{label}</p><p className="mt-1.5 break-words text-lg font-semibold tracking-[-0.03em] text-[#365449]">{value}</p></div>;
}

function Step({ number, title, active, children }: { number: string; title: string; active: boolean; children: ReactNode }) {
  return <li className="flex gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[10px] ${active ? "bg-[#d9eee6] text-[#087e83]" : "bg-[#dde5df] text-[#89968f]"}`}>{active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}</span><div><p className={`text-sm font-semibold ${active ? "text-[#29483e]" : "text-[#61736a]"}`}>{title}</p><p className="mt-1 text-xs leading-5 text-[#7a8981]">{children}</p></div></li>;
}
