import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarDays, Check, ExternalLink, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

type CalendarState = "setup_required" | "disconnected" | "selection_required" | "connected" | "reconnect_required";
type WorkCalendar = { id: string; summary: string; timeZone: string };
type CalendarStatus = {
  state: CalendarState;
  mode: "read_only";
  bookingEnabled: false;
  calendar?: { id: string; summary: string; timeZone: string; url?: string };
  account?: string;
};

type Props = { numberId: string; token: string | null; offlinePreview?: boolean };

const basePath = (numberId: string) => `/api/incoming-secretary/calendar/${encodeURIComponent(numberId)}`;

async function readError(response: Response) {
  try {
    const body = await response.json();
    return typeof body.error === "string" && body.error.trim() ? body.error : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function friendlyError(message: string) {
  const known: Record<string, string> = {
    google_oauth_not_configured: "Google Calendar ещё не настроен. Попросите администратора приложения включить Google OAuth.",
    oauth_not_configured: "Google Calendar ещё не настроен. Попросите администратора приложения включить Google OAuth.",
    reconnect_required: "Доступ к Google Calendar истёк или был отозван. Подключите аккаунт заново.",
    no_calendars_available: "В аккаунте нет отдельного рабочего календаря, который можно выбрать.",
  };
  return known[message] || message.replaceAll("_", " ");
}

export function WorkCalendarSettings({ numberId, token, offlinePreview = false }: Props) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<WorkCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [loading, setLoading] = useState(false);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadCalendars = useCallback(async (signal?: AbortSignal) => {
    if (!token || !numberId || offlinePreview) return;
    setCalendarsLoading(true);
    try {
      const response = await fetch(`${basePath(numberId)}/calendars`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { calendars: WorkCalendar[] };
      setCalendars(data.calendars || []);
      setSelectedCalendarId((current) =>
        data.calendars?.some((calendar) => calendar.id === current)
          ? current
          : status?.calendar?.id && data.calendars?.some((calendar) => calendar.id === status.calendar?.id)
            ? status.calendar.id
            : data.calendars?.[0]?.id || "",
      );
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? friendlyError(cause.message) : "Не удалось загрузить список календарей.");
    } finally {
      if (!signal?.aborted) setCalendarsLoading(false);
    }
  }, [numberId, offlinePreview, status?.calendar?.id, token]);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    if (!token || !numberId || offlinePreview) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(basePath(numberId), {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as CalendarStatus;
      setStatus(data);
      setSelectedCalendarId(data.calendar?.id || "");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? friendlyError(cause.message) : "Не удалось загрузить состояние календаря.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [numberId, offlinePreview, token]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setCalendars([]);
    setSelectedCalendarId("");
    setError("");
    setNotice("");
    if (offlinePreview) {
      setStatus({ state: "disconnected", mode: "read_only", bookingEnabled: false });
      setLoading(false);
    } else if (token && numberId) {
      void loadStatus(controller.signal);
    } else {
      setLoading(false);
    }
    return () => controller.abort();
  }, [numberId, token, offlinePreview, loadStatus]);

  useEffect(() => {
    if (!offlinePreview && status && ["connected", "selection_required"].includes(status.state)) {
      const controller = new AbortController();
      void loadCalendars(controller.signal);
      return () => controller.abort();
    }
  }, [loadCalendars, offlinePreview, status?.state]);

  async function performWrite(action: "connect" | "save" | "disconnect") {
    if (!token || !numberId || offlinePreview || busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      if (action === "connect") {
        const response = await fetch(`${basePath(numberId)}/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error(await readError(response));
        const result = await response.json() as { url: string };
        if (!result.url) throw new Error("Не получена ссылка авторизации.");
        window.location.assign(result.url);
        return;
      }
      const response = await fetch(`${basePath(numberId)}/${action === "save" ? "selection" : "disconnect"}`, {
        method: action === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(action === "save" ? { calendarId: selectedCalendarId } : {}),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(action === "save" ? "Рабочий календарь выбран." : "Календарь отключён.");
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? friendlyError(cause.message) : "Не удалось выполнить действие.");
    } finally {
      setBusy(null);
    }
  }

  const state = status?.state;
  const needsSelection = state === "selection_required" || state === "connected";

  return (
    <section aria-labelledby="work-calendar-heading" className="rounded-2xl border border-[#344b4f] bg-[#17282d] text-[#e8efec]">
      <div className="flex flex-col gap-4 border-b border-[#30474b] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-teal-300"><CalendarDays className="h-4 w-4" />04 / Рабочий календарь</p>
          <h2 id="work-calendar-heading" className="text-xl font-semibold">Подключение календаря</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#a9bbb7]">Только чтение: календарь помогает видеть контекст, но Secretary не читает события и ничего не бронирует.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#496761] bg-[#203a39] px-3 py-1.5 text-xs font-medium text-[#c2e7d9]"><ShieldCheck className="h-3.5 w-3.5" />Read-only · бронирование выключено</span>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        {!offlinePreview && new URLSearchParams(window.location.search).get("calendar") === "error" && (
          <p role="alert" className="rounded-xl border border-amber-800/80 bg-[#332d21] p-4 text-sm text-[#e1d3b4]">Подключение Google не завершено. Доступ мог быть отклонён или ссылка истекла. Повторите подключение в этом браузере.</p>
        )}
        {offlinePreview ? (
          <div className="rounded-xl border border-dashed border-[#496064] bg-[#122328] p-4 text-sm leading-6 text-[#bdcbc7]">
            Публичный пример: календарь показан как отключённый. Подключение недоступно в preview, запросы к API не выполняются.
          </div>
        ) : loading ? (
          <div className="space-y-3" aria-label="Загрузка состояния календаря">
            <div className="h-4 w-44 animate-pulse rounded bg-[#294044]" />
            <div className="h-11 max-w-xl animate-pulse rounded-lg bg-[#20363a]" />
          </div>
        ) : error && !status ? (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-900/80 bg-[#302528] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>
            <Button variant="outline" onClick={() => void loadStatus()} className="border-[#53676a] text-[#e8efec] hover:bg-[#20363a]"><RefreshCw className="mr-2 h-4 w-4" />Повторить</Button>
          </div>
        ) : (
          <>
            {state === "setup_required" && <div className="rounded-xl border border-amber-800/80 bg-[#332d21] p-4 text-sm leading-6 text-[#e1d3b4]">Google Calendar пока не настроен. Администратору приложения нужно настроить Google OAuth. Не вводите и не отправляйте сюда пароли или OAuth-данные.</div>}
            {state === "reconnect_required" && <div className="rounded-xl border border-amber-800/80 bg-[#332d21] p-4 text-sm leading-6 text-[#e1d3b4]">Требуется повторное подключение Google-аккаунта. После авторизации выберите рабочий календарь заново.</div>}
            {state === "disconnected" && <p className="text-sm leading-6 text-[#bdcbc7]">Подключите Google-аккаунт, затем выберите отдельный рабочий календарь. Основной личный календарь в списке не предлагается.</p>}

            {status?.account && <p className="text-sm text-[#afc0bc]">Аккаунт <span className="font-medium text-[#dce8e4]">{status.account}</span></p>}
            {status?.calendar && state === "connected" && (
              <div className="rounded-xl border border-[#3c5355] bg-[#122328] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#dce8e4]"><Check className="h-4 w-4 text-teal-300" />{status.calendar.summary}</p>
                <p className="mt-1 text-xs text-[#9eb2ae]">{status.calendar.timeZone || "Часовой пояс не указан"}</p>
                {status.calendar.url && <a href={status.calendar.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-200 underline underline-offset-4 hover:text-white">Открыть календарь <ExternalLink className="h-3 w-3" /></a>}
              </div>
            )}

            {needsSelection && (
              <div className="space-y-3">
                <label htmlFor={`calendar-choice-${numberId}`} className="block text-sm font-medium text-[#dce8e4]">Отдельный рабочий календарь</label>
                {calendarsLoading ? (
                  <div className="h-11 max-w-xl animate-pulse rounded-lg bg-[#20363a]" />
                ) : calendars.length ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select id={`calendar-choice-${numberId}`} value={selectedCalendarId} onChange={(event) => setSelectedCalendarId(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-[#40585c] bg-[#102025] px-3 text-sm text-white">
                      {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.timeZone ? ` · ${calendar.timeZone}` : ""}</option>)}
                    </select>
                    <Button disabled={!selectedCalendarId || busy !== null || state === "connected" && selectedCalendarId === status?.calendar?.id} onClick={() => void performWrite("save")} className="bg-[#28756a] text-white hover:bg-[#328b7c]">
                      {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      {state === "connected" ? "Сменить календарь" : "Выбрать календарь"}
                    </Button>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-[#40585c] p-3 text-sm leading-5 text-[#9eb2ae]">Нет доступных отдельных календарей. Основной календарь намеренно исключён.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-[#30474b] pt-4">
              {(state === "disconnected" || state === "reconnect_required") && <Button disabled={busy !== null} onClick={() => void performWrite("connect")} className="bg-[#28756a] text-white hover:bg-[#328b7c]">{busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}{state === "reconnect_required" ? "Подключить заново" : "Подключить Google Calendar"}</Button>}
              {state && state !== "disconnected" && <Button variant="outline" disabled={busy !== null} onClick={() => void performWrite("disconnect")} className="border-[#53676a] text-[#dce8e4] hover:bg-[#20363a]">{busy === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}Отключить</Button>}
              {state === "selection_required" && <p className="self-center text-xs text-[#9eb2ae]">Аккаунт подключён — завершите настройку выбором календаря.</p>}
            </div>
          </>
        )}
        {error && status && <p role="alert" className="flex items-start gap-2 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        {notice && <p role="status" className="text-sm text-teal-200">{notice}</p>}
        <p className="border-t border-[#30474b] pt-3 text-xs leading-5 text-[#899e99]">Часы работы и условия обслуживания берутся только из выбранных рабочих карточек выше. Подключение календаря не активирует обработку звонков и не включает запись.</p>
      </div>
    </section>
  );
}
