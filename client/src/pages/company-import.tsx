import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Circle, Clock3, Database, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Readiness =
  | "awaiting_owner_approval"
  | "ready"
  | "running"
  | "imported_shadow"
  | "uncertain"
  | "blocked";

interface ImportStatus {
  bindingConfirmed: boolean;
  scope: "new-country";
  importApproved: boolean;
  activated: false;
  readiness: Readiness;
  package?: {
    revision: number;
    semanticHash: string;
    manifestHash: string;
    recordCount: number;
    documentCount: number;
    archiveCount: number;
    ndjsonBytes: number;
  };
  csrfToken: string;
  operation?: { state: string };
  error?: string;
}

const STATUS_URL = "/api/admin/company-import/status";
const START_URL = "/api/admin/company-import/start";

const readinessCopy: Record<Readiness, { label: string; detail: string; tone: string }> = {
  awaiting_owner_approval: {
    label: "Ожидает подтверждения владельца",
    detail: "Пакет ещё не готов к переносу. Импорт будет доступен после разрешения на стороне сервера.",
    tone: "amber",
  },
  ready: {
    label: "Готов к импорту",
    detail: "Сервер подтвердил готовность пакета. Проверьте сводку и подтвердите единственный перенос.",
    tone: "teal",
  },
  running: {
    label: "Импорт выполняется",
    detail: "Сервер обрабатывает закреплённый пакет. Статус обновляется автоматически.",
    tone: "teal",
  },
  imported_shadow: {
    label: "Импортировано в теневой режим",
    detail: "Данные перенесены в теневое состояние. Книга и лаборатория остаются выключенными.",
    tone: "teal",
  },
  uncertain: {
    label: "Результат требует проверки",
    detail: "Ответ операции не подтверждён. Обновите статус; повторный запуск здесь не выполняется.",
    tone: "amber",
  },
  blocked: {
    label: "Импорт заблокирован",
    detail: "Сервер не разрешил перенос. Эта страница не может снять блокировку.",
    tone: "rose",
  },
};

function formatCount(value: number | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat("ru-RU").format(value) : "—";
}

async function responseError(response: Response) {
  let message = "";
  try {
    const body = await response.json();
    if (typeof body?.error === "string") message = body.error;
    else if (typeof body?.message === "string") message = body.message;
  } catch {
    // A non-JSON server response is presented with its HTTP status below.
  }
  return message || `Сервер ответил с ошибкой (${response.status}).`;
}

export default function CompanyImport() {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const statusRef = useRef<ImportStatus | null>(null);
  statusRef.current = status;

  const refreshStatus = useCallback(async (quiet = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) {
      setRefreshing(true);
      if (!statusRef.current) setLoading(true);
    }
    try {
      const response = await fetch(STATUS_URL, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = (await response.json()) as ImportStatus;
      if (!next || next.scope !== "new-country" || typeof next.readiness !== "string") {
        throw new Error("Сервер вернул неполный статус импорта.");
      }
      if (mounted.current) {
        setStatus(next);
        setLoadError("");
      }
    } catch (error) {
      if (mounted.current) {
        setLoadError(error instanceof Error ? error.message : "Не удалось получить статус импорта.");
      }
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

  useEffect(() => {
    if (status?.readiness !== "running") return;
    const timer = window.setInterval(() => void refreshStatus(true), 3000);
    return () => window.clearInterval(timer);
  }, [status?.readiness, refreshStatus]);

  const canStart =
    status?.readiness === "ready" &&
    status.importApproved === true &&
    Boolean(status.package?.manifestHash) &&
    Boolean(status.csrfToken) &&
    !submitting;

  const confirmTransfer = async () => {
    if (!status || !canStart || !status.package?.manifestHash) return;
    setSubmitting(true);
    setActionError("");
    setDialogOpen(false);
    try {
      const response = await fetch(START_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-company-csrf": status.csrfToken,
        },
        body: JSON.stringify({ confirm: true, manifestHash: status.package.manifestHash }),
      });
      if (response.status === 202) {
        await refreshStatus();
      } else {
        throw new Error(await responseError(response));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось подтвердить результат операции.";
      setActionError(
        "Ответ на запрос не подтверждён. Не запускайте перенос повторно. Обновите статус и проверьте состояние на сервере. " +
        message,
      );
      await refreshStatus();
    } finally {
      setSubmitting(false);
    }
  };

  const readiness = status ? readinessCopy[status.readiness] : null;
  const packageInfo = status?.package;
  const blocked = status?.readiness === "blocked" || status?.readiness === "awaiting_owner_approval";

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
          <span>Владелец</span><span aria-hidden="true">/</span><span>Перенос компании</span><span aria-hidden="true">/</span><span className="text-[#087e83]">Новая страна</span>
        </div>

        <section className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-14">
          <div className="min-w-0">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.19em] text-[#087e83]">Одноразовое подтверждение владельца</p>
            <h1 className="max-w-3xl text-[clamp(2.1rem,6vw,4.4rem)] font-semibold leading-[1.02] tracking-[-0.055em] text-[#233b33]">
              Перенос пакета<br className="hidden sm:block" /> в новую страну
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#60716a] sm:text-lg">
              Сервер перенесёт закреплённый пакет в теневое состояние. От вас требуется только подтвердить перенос, когда он будет разрешён.
            </p>

            <div className="mt-8 flex items-start gap-3 rounded-xl border border-[#c9dcd5] bg-[#e7f1ed] p-4 sm:p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#087e83]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-bold text-[#29483e]">Теневой режим — без активации</h2>
                <p className="mt-1 text-sm leading-6 text-[#5a7068]">
                  Импорт сам по себе не включает книгу или лабораторию. Подтверждение привязки пакета также не является разрешением на импорт.
                </p>
              </div>
            </div>

            <section className="mt-8 overflow-hidden rounded-xl border border-[#d4ded7] bg-[#fafbf8] shadow-[0_8px_28px_rgba(38,72,60,0.045)]" aria-labelledby="package-heading">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8e2] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#87948d]">Пакет на сервере</p>
                  <h2 id="package-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#29483e]">Сводка переноса</h2>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={loading || refreshing}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d6e0da] px-3 text-xs font-semibold text-[#4d665c] transition-colors hover:bg-[#eff5f1] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                  Обновить статус
                </button>
              </div>

              {loading && !status ? (
                <div className="space-y-4 p-5 sm:p-6" aria-label="Загрузка сводки" aria-busy="true">
                  <div className="h-5 w-40 animate-pulse rounded bg-[#e5ece7]" />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[0, 1, 2, 3].map((item) => <div key={item} className="h-[76px] animate-pulse rounded-lg bg-[#edf2ee]" />)}
                  </div>
                  <div className="h-12 animate-pulse rounded-lg bg-[#edf2ee]" />
                </div>
              ) : loadError && !status ? (
                <div className="p-5 sm:p-6" role="alert">
                  <div className="flex gap-3 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] p-4 text-[#8b443d]">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Не удалось загрузить состояние импорта</p>
                      <p className="mt-1 break-words text-sm leading-6">{loadError}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => void refreshStatus()} className="mt-4 min-h-10 rounded-md bg-[#29483e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1d3930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
                    Повторить загрузку
                  </button>
                </div>
              ) : status && readiness ? (
                <div className="p-5 sm:p-6">
                  {loadError && (
                    <div role="alert" className="mb-4 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] px-4 py-3 text-sm leading-6 text-[#8b443d]">
                      Ошибка обновления статуса: {loadError}
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${readiness.tone === "teal" ? "bg-[#dff0e9] text-[#087e83]" : readiness.tone === "rose" ? "bg-[#fae6e2] text-[#a24f45]" : "bg-[#f8edda] text-[#956426]"}`}>
                      {status.readiness === "running" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> :
                        status.readiness === "imported_shadow" ? <Check className="h-4 w-4" aria-hidden="true" /> :
                          status.readiness === "blocked" ? <LockKeyhole className="h-4 w-4" aria-hidden="true" /> :
                            <Circle className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#29483e]" aria-live="polite">{readiness.label}</p>
                      <p className="mt-1 text-sm leading-6 text-[#718078]">{readiness.detail}</p>
                    </div>
                  </div>

                  {status.error && (
                    <div className="mt-4 rounded-lg border border-[#e6c6bf] bg-[#fff3f0] px-4 py-3 text-sm leading-6 text-[#8b443d]" role="alert">
                      <span className="font-semibold">Сообщение сервера: </span>{status.error}
                    </div>
                  )}

                  <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Ревизия" value={packageInfo ? `r${packageInfo.revision}` : "—"} />
                    <Metric label="Документы" value={formatCount(packageInfo?.documentCount)} />
                    <Metric label="Архивы" value={formatCount(packageInfo?.archiveCount)} />
                    <Metric label="Записи" value={formatCount(packageInfo?.recordCount)} />
                  </div>

                  <div className="mt-3 rounded-lg border border-[#e1e8e2] bg-[#f4f7f4] p-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#84928a]">
                      <Database className="h-3.5 w-3.5" aria-hidden="true" />
                      Хеш манифеста пакета
                    </div>
                    <p className="mt-2 break-all font-mono text-xs leading-5 text-[#3f5b50]">
                      {packageInfo?.manifestHash || "Не получен от сервера"}
                    </p>
                    {packageInfo?.semanticHash && (
                      <p className="mt-2 break-all text-[11px] leading-5 text-[#75847c]">
                        Семантический хеш: <span className="font-mono">{packageInfo.semanticHash}</span>
                      </p>
                    )}
                    {packageInfo && (
                      <p className="mt-2 text-[11px] text-[#84928a]">
                        NDJSON: {formatCount(packageInfo.ndjsonBytes)} байт
                      </p>
                    )}
                  </div>

                  <div className="mt-5 flex flex-col gap-3 border-t border-[#e2e8e2] pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-md text-xs leading-5 text-[#819087]">
                      {blocked
                        ? "Перенос недоступен. Дождитесь разрешения со стороны сервера."
                        : status.readiness === "ready" && !status.importApproved
                          ? "Привязка подтверждена не означает, что импорт разрешён."
                          : status.readiness === "ready"
                            ? "Одна операция. После отправки повторный запуск не выполняется."
                            : "Состояние операции определяется сервером; эта страница не меняет его вручную."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setDialogOpen(true)}
                      disabled={!canStart}
                      className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-[#29483e] px-5 text-sm font-semibold text-[#f3f5f1] transition-[background-color,transform,opacity] hover:-translate-y-0.5 hover:bg-[#1d3930] disabled:cursor-not-allowed disabled:transform-none disabled:bg-[#dce3dd] disabled:text-[#7c8981] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]"
                    >
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                      {blocked ? "Импорт пока не разрешён" : submitting ? "Отправка подтверждения…" : "Подтвердить перенос"}
                    </button>
                  </div>
                  {actionError && (
                    <div className="mt-4 flex gap-3 rounded-lg border border-[#e5c6a4] bg-[#fff7e9] p-4 text-sm leading-6 text-[#805522]" role="alert">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                      <p>{actionError}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          </div>

          <aside className="lg:pt-2">
            <div className="rounded-xl border border-[#d4ded7] bg-[#e9efea] p-5 sm:p-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#829189]">Порядок подтверждения</p>
              <ol className="mt-5 space-y-5">
                <Step number="01" title="Пакет закреплён" active={status?.bindingConfirmed === true}>
                  Сервер использует свой приватный объект хранения. Здесь не нужно загружать файлы.
                </Step>
                <Step number="02" title="Импорт разрешён" active={status?.importApproved === true}>
                  Разрешение на импорт отдельно от подтверждения привязки пакета.
                </Step>
                <Step number="03" title="Только теневой режим" active={status?.readiness === "imported_shadow"}>
                  Перенос не активирует продукт и не включает книгу или лабораторию.
                </Step>
              </ol>
              <div className="mt-6 flex items-start gap-2 border-t border-[#d5dfd8] pt-4 text-xs leading-5 text-[#73827a]">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#7c9386]" aria-hidden="true" />
                <p>При неопределённом результате проверьте статус. Повторный запуск не предлагается.</p>
              </div>
            </div>
          </aside>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-[#d4ded7] bg-[#fafbf8] text-[#233b33] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.03em]">Подтвердить перенос пакета?</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#66776f]">
              Сервер начнёт одноразовый импорт пакета ревизии {packageInfo?.revision ?? "—"} в теневое состояние для новой страны.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-[#dce5de] bg-[#f0f5f1] p-4 text-sm leading-6 text-[#536960]">
            Данные не активируются: книга и лаборатория останутся выключенными. Если ответ операции потеряется, повторно запускать импорт нельзя — сначала обновите статус.
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setDialogOpen(false)} className="min-h-11 rounded-md border border-[#d4ded7] px-4 text-sm font-semibold text-[#50665c] transition-colors hover:bg-[#eff4f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
              Отмена
            </button>
            <button type="button" onClick={() => void confirmTransfer()} disabled={!canStart} className="min-h-11 rounded-md bg-[#29483e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1d3930] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087e83]">
              Да, подтвердить перенос
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e1e8e2] bg-[#f7f9f6] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#89968f]">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-[#365449]">{value}</p>
    </div>
  );
}

function Step({ number, title, active, children }: { number: string; title: string; active: boolean; children: string }) {
  return (
    <li className="flex gap-3">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[10px] ${active ? "bg-[#d9eee6] text-[#087e83]" : "bg-[#dde5df] text-[#89968f]"}`}>
        {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}
      </span>
      <div>
        <p className={`text-sm font-semibold ${active ? "text-[#29483e]" : "text-[#61736a]"}`}>{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#7a8981]">{children}</p>
      </div>
    </li>
  );
}
