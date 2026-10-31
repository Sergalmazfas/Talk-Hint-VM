import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, Check, Clipboard, ExternalLink, KeyRound, RefreshCw,
  ShieldCheck, ShieldAlert, Terminal, Trash2,
} from "lucide-react";
import { useLocation } from "wouter";

const OWNER_KEY_URL = "/api/admin/product-crew/owner-key";
const REVOKE_URL = `${OWNER_KEY_URL}/revoke`;
const MCP_ENDPOINT = "https://talkhint.app/api/product-crew/mcp";
const AMBIGUOUS_MESSAGE = "Операция не подтверждена — обновите статус, не повторяйте автоматически";

async function keyRequest(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const data: unknown = await response.json();
    return { status: response.status, ok: response.ok, data };
  } finally {
    window.clearTimeout(timer);
  }
}

type KeyStatus = {
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type SecretStatus = {
  configured: boolean;
  disabled: boolean;
  lastUsedAt: string | null;
};

type OwnerKeyView = {
  status: KeyStatus | null;
  secretStatus?: SecretStatus;
  csrfToken: string;
  header: "X-API-Key";
  environment: "production";
  model: "new-country";
  lifetimeDays: 90;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Ещё не использовался";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function validateView(value: unknown): OwnerKeyView {
  const data = value as Partial<OwnerKeyView> | null;
  if (
    !data ||
    typeof data.csrfToken !== "string" ||
    data.header !== "X-API-Key" ||
    data.environment !== "production" ||
    data.model !== "new-country" ||
    data.lifetimeDays !== 90 ||
    (data.secretStatus !== undefined && (
      !data.secretStatus ||
      typeof data.secretStatus.configured !== "boolean" ||
      typeof data.secretStatus.disabled !== "boolean" ||
      !(typeof data.secretStatus.lastUsedAt === "string" || data.secretStatus.lastUsedAt === null)
    )) ||
    !(data.status === null || (
      typeof data.status === "object" &&
      typeof data.status.createdAt === "string" &&
      typeof data.status.expiresAt === "string" &&
      (typeof data.status.lastUsedAt === "string" || data.status.lastUsedAt === null)
    ))
  ) {
    throw new Error("Сервер вернул неполный статус ключа.");
  }
  return data as OwnerKeyView;
}

export default function ProductCrewKeyPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [rawKey, setRawKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [requiresRead, setRequiresRead] = useState(false);
  const csrfRef = useRef("");
  const inFlight = useRef(false);
  const secretRef = useRef("");
  const secretEpoch = useRef(0);

  const clearSecret = useCallback(() => {
    secretEpoch.current++;
    secretRef.current = "";
    setRawKey("");
    setCopied(false);
  }, []);

  useEffect(() => {
    const onPageHide = () => clearSecret();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) clearSecret();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      clearSecret();
    };
  }, [clearSecret]);

  const readStatus = useCallback(async (explicit = false) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    if (explicit) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    setNotice("");
    try {
      const response = await keyRequest(OWNER_KEY_URL, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Не удалось прочитать статус (${response.status}).`);
      const view = validateView(response.data);
      csrfRef.current = view.csrfToken;
      setStatus(view.status);
      setSecretStatus(view.secretStatus);
      setRequiresRead(false);
      setOperationError("");
      return true;
    } catch (error) {
      csrfRef.current = "";
      setLoadError(error instanceof Error ? error.message : "Не удалось прочитать статус ключа.");
      return false;
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  async function refreshStatus() {
    await readStatus(true);
  }

  async function createOrRotate() {
    if (inFlight.current || !csrfRef.current || requiresRead || rawKey) return;
    const confirmed = window.confirm(
      "Создать новый ручной ключ TalkHint MCP?\n\nБудет отозван только прежний ручной ключ; Secrets-доступ это не меняет. Ключ действует 90 дней и даёт доступ только к production-модели new-country.\n\nСекрет будет показан один раз — сохраните его в Replit Advanced settings."
    );
    if (!confirmed || inFlight.current) return;
    inFlight.current = true;
    setMutating(true);
    setOperationError("");
    setNotice("");
    setCopied(false);
    const csrfToken = csrfRef.current;
    const epoch = secretEpoch.current;
    csrfRef.current = "";
    try {
      const response = await keyRequest(OWNER_KEY_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-product-key-csrf": csrfToken,
        },
        body: JSON.stringify({ confirm: true }),
      });
      if (response.status !== 201) {
        throw new Error(AMBIGUOUS_MESSAGE);
      }
      const result = response.data as { key?: unknown; status?: unknown };
      if (typeof result.key !== "string" || !result.key || !result.status || typeof result.status !== "object") {
        throw new Error(AMBIGUOUS_MESSAGE);
      }
      const nextStatus = result.status as KeyStatus;
      if (
        typeof nextStatus.createdAt !== "string" ||
        typeof nextStatus.expiresAt !== "string" ||
        !(typeof nextStatus.lastUsedAt === "string" || nextStatus.lastUsedAt === null)
      ) {
        throw new Error(AMBIGUOUS_MESSAGE);
      }
      // A response arriving after navigation/pagehide must not reveal a key
      // again when the browser restores the page from its back/forward cache.
      if (secretEpoch.current !== epoch) throw new Error(AMBIGUOUS_MESSAGE);
      secretRef.current = result.key;
      setRawKey(result.key);
      setStatus(nextStatus);
      setNotice("Новый ключ создан. Скопируйте и сохраните его сейчас — повторно показать секрет нельзя.");
      const refreshed = await readStatusAfterMutation();
      if (!refreshed) setNotice("Ключ создан и показан один раз. Не создавайте новый — обновите статус перед следующими действиями.");
    } catch {
      setRequiresRead(true);
      setOperationError(AMBIGUOUS_MESSAGE);
      setNotice("");
    } finally {
      inFlight.current = false;
      setMutating(false);
    }
  }

  async function readStatusAfterMutation() {
    try {
      const response = await keyRequest(OWNER_KEY_URL, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Status unavailable");
      const view = validateView(response.data);
      csrfRef.current = view.csrfToken;
      setStatus(view.status);
      setSecretStatus(view.secretStatus);
      setRequiresRead(false);
      setOperationError("");
      return true;
    } catch {
      csrfRef.current = "";
      setRequiresRead(true);
      setLoadError("Не удалось обновить статус после операции. Нажмите «Обновить статус» перед следующим действием.");
      return false;
    }
  }

  async function revokeKey() {
    if (inFlight.current || !csrfRef.current || requiresRead || rawKey) return;
    const confirmed = window.confirm(
      "Отозвать активный ключ TalkHint MCP?\n\nПодключение перестанет работать сразу. Это действие нельзя отменить."
    );
    if (!confirmed || inFlight.current) return;
    inFlight.current = true;
    setMutating(true);
    setOperationError("");
    setNotice("");
    const csrfToken = csrfRef.current;
    csrfRef.current = "";
    try {
      const response = await keyRequest(REVOKE_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-product-key-csrf": csrfToken,
        },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw new Error(AMBIGUOUS_MESSAGE);
      const result = response.data as { revoked?: unknown };
      if (result.revoked !== true) throw new Error(AMBIGUOUS_MESSAGE);
      setStatus(null);
      setNotice("Ключ отозван.");
      const refreshed = await readStatusAfterMutation();
      if (!refreshed) setNotice("Отзыв подтверждён. Обновите статус перед следующими действиями.");
    } catch {
      setRequiresRead(true);
      setOperationError(AMBIGUOUS_MESSAGE);
      setNotice("");
    } finally {
      inFlight.current = false;
      setMutating(false);
    }
  }

  async function disableSecret() {
    if (inFlight.current || !csrfRef.current || requiresRead || rawKey) return;
    const confirmed = window.confirm(
      "Отключить Secrets-доступ TalkHint MCP?\n\nТекущее значение секрета будет отозвано без возможности повторного включения. Для замены добавьте новое значение и выполните Publish."
    );
    if (!confirmed || inFlight.current) return;
    inFlight.current = true;
    setMutating(true);
    setOperationError("");
    setNotice("");
    const csrfToken = csrfRef.current;
    csrfRef.current = "";
    try {
      const response = await keyRequest(`${OWNER_KEY_URL}/disable-secret`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-product-key-csrf": csrfToken,
        },
        body: JSON.stringify({ confirm: true }),
      });
      const result = response.data as { disabled?: unknown } | null;
      if (!response.ok || result?.disabled !== true) throw new Error(AMBIGUOUS_MESSAGE);
      setNotice("Secrets-доступ отключён. Для нового значения добавьте секрет и выполните Publish.");
      const refreshed = await readStatusAfterMutation();
      if (!refreshed) setNotice("Отключение подтверждено. Обновите статус перед следующими действиями.");
    } catch {
      setRequiresRead(true);
      setOperationError(AMBIGUOUS_MESSAGE);
      setNotice("");
    } finally {
      inFlight.current = false;
      setMutating(false);
    }
  }

  async function copySecret() {
    if (!secretRef.current || !navigator.clipboard?.writeText) {
      setCopied(false);
      setNotice("Буфер обмена недоступен. Выделите ключ и скопируйте его вручную.");
      return;
    }
    try {
      await navigator.clipboard.writeText(secretRef.current);
      setCopied(true);
      setNotice("Ключ скопирован. Сохраните его в Replit Advanced settings; секрет не отправлялся куда-либо ещё.");
    } catch {
      setCopied(false);
      setNotice("Не удалось скопировать ключ. Выделите его и скопируйте вручную.");
    }
  }

  const actionDisabled = loading || refreshing || mutating || inFlight.current || requiresRead || !csrfRef.current || Boolean(rawKey);

  return (
    <main className="min-h-[100dvh] bg-[#111b1b] px-4 pb-12 text-[#e8efeb] sm:px-6">
      <header className="mx-auto flex max-w-4xl items-center justify-between border-b border-[#2d3c39] py-4">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-[#b5c4bd] hover:bg-[#20302c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8fc6ad]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          В админку
        </button>
        <span className="text-sm font-semibold tracking-[0.18em] text-[#9fb3a8]">TALKHINT · OWNER</span>
      </header>

      <div className="mx-auto max-w-4xl py-7 sm:py-10">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#86b19b]">Production access · MCP</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#f0f3ef] sm:text-4xl">Ключ команды продукта</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#a9b8b0] sm:text-base">
            Основной способ доступа TalkHint MCP — Secrets: задайте <span className="font-mono text-[#d9e7df]">PRODUCT_CREW_KEY</span> в окружении и выполните Publish. Ручной ключ и OAuth остаются запасными способами подключения. Доступ ограничен production-моделью <span className="font-mono text-[#d9e7df]">new-country</span>.
          </p>
        </div>

        {(loadError || operationError) && (
          <section role="alert" className="mb-5 flex gap-3 rounded-lg border border-[#8a5148] bg-[#382522] p-4 text-sm leading-6 text-[#ffded7]">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">{operationError || loadError}</p>
              {requiresRead && <p className="mt-1 text-[#e8bdb4]">Сначала прочитайте актуальный статус. Повторная отправка не выполняется автоматически.</p>}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-[#344742] bg-[#192624]">
          <div className="flex flex-col gap-4 border-b border-[#344742] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-[#466455] bg-[#243a31] p-2 text-[#a8d1b7]">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#edf3ee]">Состояние ключа</h2>
                <p className="mt-1 text-sm text-[#a7b8af]">Статус читается с сервера; секрет не загружается повторно.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshStatus}
              disabled={refreshing || mutating || inFlight.current}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#53665e] px-4 text-sm font-medium text-[#d9e5de] hover:bg-[#263833] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              {refreshing ? "Читаем статус…" : "Обновить статус"}
            </button>
          </div>

          {loading ? (
            <div className="space-y-4 px-5 py-7 sm:px-6" aria-label="Загрузка статуса ключа">
              <div className="h-5 w-40 animate-pulse rounded bg-[#2a3a35]" />
              <div className="h-4 w-full max-w-sm animate-pulse rounded bg-[#263631]" />
              <div className="h-4 w-2/3 max-w-xs animate-pulse rounded bg-[#263631]" />
            </div>
          ) : loadError && !status ? (
            <div className="px-5 py-7 text-sm text-[#b8c5be] sm:px-6">
              Пока не удалось получить подтверждённый статус. В режиме разработки сервер может сообщить, что управление недоступно.
            </div>
          ) : (
            <div className="grid gap-5 px-5 py-6 sm:grid-cols-[1fr_1.1fr] sm:px-6">
              <div className="flex items-start gap-3">
                {status ? (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#8bc59f]" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#d3ae70]" aria-hidden="true" />
                )}
                <div>
                  <p className="font-semibold text-[#e8efeb]">{status ? "Активный ключ зарегистрирован" : "Активный ключ не найден"}</p>
                  <p className="mt-1 text-sm leading-6 text-[#a9b8b0]">
                    {status ? "Секрет показывается только сразу после успешного создания." : "Создание ключа выполняется вручную и только после подтверждения владельца."}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-y-3 border-t border-[#344742] pt-4 text-sm sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <dt className="text-[#8fa299]">Создан</dt><dd className="text-[#d6e0da]">{status ? formatDate(status.createdAt) : "—"}</dd>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <dt className="text-[#8fa299]">Истекает</dt><dd className="text-[#d6e0da]">{status ? formatDate(status.expiresAt) : "—"}</dd>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <dt className="text-[#8fa299]">Последнее использование</dt><dd className="text-[#d6e0da]">{status ? formatDate(status.lastUsedAt) : "—"}</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="border-t border-[#344742] bg-[#172320] px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                {secretStatus?.configured && !secretStatus.disabled ? (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#8bc59f]" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#d3ae70]" aria-hidden="true" />
                )}
                <div>
                  <h3 className="font-semibold text-[#e8efeb]">Secrets-доступ MCP</h3>
                  <p className="mt-1 text-sm leading-6 text-[#a9b8b0]">
                    {secretStatus === undefined
                      ? "Статус Secrets не предоставлен сервером; готовность не подтверждена."
                      : secretStatus.disabled
                        ? "Секрет отключён и отозван. Для замены задайте новое значение и выполните Publish."
                        : secretStatus.configured
                          ? "Секрет настроен и включён."
                          : "Секрет не настроен — Secrets-доступ не готов."}
                  </p>
                </div>
              </div>
              {secretStatus?.configured && !secretStatus.disabled && (
                <button
                  type="button"
                  onClick={disableSecret}
                  disabled={actionDisabled}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-[#76524c] px-4 text-sm font-semibold text-[#efc4bb] hover:bg-[#382724] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Отключить
                </button>
              )}
            </div>
            <dl className="mt-4 grid gap-2 border-t border-[#344742] pt-4 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <dt className="text-[#8fa299]">Имя секрета</dt>
                <dd className="font-mono text-[#d6e0da]">PRODUCT_CREW_KEY</dd>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <dt className="text-[#8fa299]">Последнее использование</dt>
                <dd className="text-[#d6e0da]">{secretStatus ? formatDate(secretStatus.lastUsedAt) : "Статус недоступен"}</dd>
              </div>
            </dl>
          </div>

          {rawKey && (
            <div className="border-t border-[#5b6748] bg-[#262d23] px-5 py-5 sm:px-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#e5c77d]" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-[#f1e5bd]">Сохраните секрет сейчас</h3>
                  <p className="mt-1 text-sm leading-6 text-[#d2c9a7]">Он существует только в памяти этой страницы и будет скрыт при выходе со страницы. Не отправляйте ключ в чат.</p>
                </div>
              </div>
              <label htmlFor="owner-key-once" className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-[#c4c9ae]">X-API-Key · показать один раз</label>
              <textarea
                id="owner-key-once"
                readOnly
                value={rawKey}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                className="mt-2 min-h-20 w-full resize-y rounded-md border border-[#5b6748] bg-[#151b17] px-3 py-3 font-mono text-sm leading-6 text-[#f1e9cf] outline-none focus-visible:ring-2 focus-visible:ring-[#c9b873]"
              />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={copySecret} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#d2c17f] px-4 text-sm font-semibold text-[#222719] hover:bg-[#e0d197]">
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Clipboard className="h-4 w-4" aria-hidden="true" />}
                  {copied ? "Скопировано" : "Скопировать ключ"}
                </button>
                <button type="button" onClick={clearSecret} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#6a7157] px-4 text-sm font-medium text-[#e5e3cf] hover:bg-[#343b2b]">
                  Я сохранил, скрыть
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-[#344742] bg-[#16211f] px-5 py-5 sm:flex-row sm:px-6">
            <button
              type="button"
              onClick={createOrRotate}
              disabled={actionDisabled}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-[#9fc6ad] px-4 text-sm font-semibold text-[#16271f] transition-colors hover:bg-[#b5d5c0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8ebdf] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {mutating ? "Операция выполняется…" : status ? "Создать новый / заменить" : "Создать ключ"}
            </button>
            {status && (
              <button
                type="button"
                onClick={revokeKey}
                disabled={actionDisabled}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#76524c] px-4 text-sm font-semibold text-[#efc4bb] hover:bg-[#382724] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Отозвать ключ
              </button>
            )}
          </div>
          {requiresRead && (
            <p className="border-t border-[#344742] px-5 py-3 text-sm text-[#e0bd7a] sm:px-6">
              Дальнейшие действия заблокированы до явного чтения статуса.
            </p>
          )}
          {notice && <p role="status" className="border-t border-[#344742] px-5 py-3 text-sm leading-6 text-[#b9d6c2] sm:px-6">{notice}</p>}
        </section>

        <section className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-[#344742] bg-[#192624] p-5">
            <div className="flex items-center gap-2 text-[#dce8e0]">
              <Terminal className="h-4 w-4 text-[#9fc6ad]" aria-hidden="true" />
              <h2 className="font-semibold">Точка подключения</h2>
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-[#8fa299]">MCP endpoint · не секрет</p>
            <code className="mt-2 block break-all rounded-md border border-[#344742] bg-[#121c1a] p-3 font-mono text-sm leading-6 text-[#d1ded6]">{MCP_ENDPOINT}</code>
            <p className="mt-3 text-sm leading-6 text-[#a9b8b0]">В Replit Advanced settings добавьте custom header <span className="font-mono text-[#d5e4da]">X-API-Key</span> со значением сохранённого секрета.</p>
          </div>
          <div className="rounded-xl border border-[#344742] bg-[#192624] p-5">
            <div className="flex items-center gap-2 text-[#dce8e0]">
              <ShieldCheck className="h-4 w-4 text-[#9fc6ad]" aria-hidden="true" />
              <h2 className="font-semibold">Перед подключением</h2>
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[#a9b8b0]">
              <li>• Срок ключа — 90 дней; создание нового отзывает все предыдущие ключи.</li>
              <li>• Доступ ограничен production-моделью <span className="font-mono text-[#d5e4da]">new-country</span>.</li>
              <li>• Только чтение и разрешённые записи модели. Нет звонков, денег, Publish, удаления, серверных секретов или приёмки за владельца. Закрытая запись остаётся закрытой.</li>
              <li>• После Claude review и публикации владельцем через Publish эта страница работает в production. Dev-среда может честно сообщить о недоступности.</li>
              <li>• OAuth-подключение не меняется.</li>
            </ul>
          </div>
        </section>

        <nav aria-label="Документация" className="mt-5 flex flex-col gap-3 rounded-xl border border-[#344742] bg-[#192624] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#a9b8b0]">Инструкции по настройке custom MCP server в Replit.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href="https://replit.com/integrations" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#53665e] px-4 text-sm font-medium text-[#d9e5de] hover:bg-[#263833]">
              Replit Integrations <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <a href="https://docs.replit.com/build/connect-via-mcp#add-a-custom-mcp-server" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#53665e] px-4 text-sm font-medium text-[#d9e5de] hover:bg-[#263833]">
              Официальная инструкция <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </nav>
      </div>
    </main>
  );
}
