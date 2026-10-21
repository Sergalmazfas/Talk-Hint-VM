import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useOptionalAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ArrowLeft, CalendarDays, Check, ChevronRight, Clock3, FileText, Loader2, Plus, RefreshCw, ShieldCheck, WandSparkles } from "lucide-react";

type Language = "en" | "ru" | "es";
type TurnRole = "caller" | "secretary";
type EndReason = "completed" | "disconnected";
type Fields = {
  name?: string; phone?: string; callbackConfirmed?: boolean; address?: string;
  localDate?: string; localTime?: string; durationMinutes?: number; language?: Language;
  notes?: string; reviewed?: boolean;
};
type Turn = { role: TurnRole; text: string; language?: Language };
type BusinessHours = { days: number[]; opens: string; closes: string; travelMinutes: number };
type WorkSetting = { numberId: string; enabled: boolean; timeZone: string; cardIds: string[]; business: BusinessHours };
type IncomingNumber = { id: string; phoneNumber: string; name: string };
type KnowledgeCard = { id: string; title: string; body: string; profileScope: string };
type IncomingRequest = {
  id: string; numberId: string; callSid: string; status: string; fields: Fields;
  missing: string[]; turns: Turn[]; outcome: string; updatedAt: string; notificationStatus?: string;
  timeZone?: string | null;
};
type Payload = {
  settings: WorkSetting[]; numbers: IncomingNumber[]; cards: KnowledgeCard[];
  requests: IncomingRequest[]; runtimeEnabled: boolean; calendarConnected: false; templateText: string;
  previewAvailable: boolean;
};

const weekdays = [
  { value: 1, label: "Пн" }, { value: 2, label: "Вт" }, { value: 3, label: "Ср" },
  { value: 4, label: "Чт" }, { value: 5, label: "Пт" }, { value: 6, label: "Сб" }, { value: 0, label: "Вс" },
];
const defaultBusiness: BusinessHours = { days: [0, 2, 3, 4, 5, 6], opens: "08:00", closes: "22:00", travelMinutes: 30 };
const languageLabels: Record<Language, string> = { en: "English", ru: "Русский", es: "Español" };
const publicPreviewFixture: Payload = {
  settings: [{ numberId: "demo-work-line", enabled: false, timeZone: "America/Los_Angeles", cardIds: ["demo-work-card"], business: { days: [0, 2, 3, 4, 5, 6], opens: "08:00", closes: "22:00", travelMinutes: 45 } }],
  numbers: [{ id: "demo-work-line", phoneNumber: "+14155550100", name: "Demo work line" }],
  cards: [{ id: "demo-work-card", title: "Mobile massage · synthetic context", body: "Sample-only service context. Availability, price, duration, travel area, and cancellation terms must be confirmed by the owner.", profileScope: "work" }],
  requests: [{
    id: "demo-request-01", numberId: "demo-work-line", callSid: "DEMO-CALL-001", status: "pending_owner_confirmation",
    fields: { name: "Morgan Example", phone: "+14155550127", callbackConfirmed: true, address: "12 Example Street", localDate: "2025-06-14", localTime: "15:00", durationMinutes: 60, language: "en", reviewed: false, notes: "Synthetic fixture only." },
    missing: [], turns: sampleTurns("en"), outcome: "Synthetic request · owner review pending", updatedAt: "2025-06-14T16:00:00.000Z", notificationStatus: "not_sent_demo",
  }],
  runtimeEnabled: false, calendarConnected: false,
  templateText: "Synthetic preview only. Ask for the caller's name, callback number, requested address and preferred time. Do not quote prices, duration, service area or cancellation terms. Tell the caller the owner must confirm.",
  previewAvailable: true,
};

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function emptyFields(language: Language): Fields {
  return { language, callbackConfirmed: false, reviewed: false };
}

function sampleTurns(language: Language, correction = false): Turn[] {
  if (language === "ru") return [
    { role: "caller", text: correction ? "Здравствуйте, хочу узнать про выездной массаж." : "Здравствуйте, хочу узнать про выездной массаж.", language },
    { role: "secretary", text: "Подскажите, пожалуйста, как к вам обращаться и по какому номеру можно перезвонить?", language },
    { role: "caller", text: correction ? "Меня зовут Анна, номер +74951234567. Сначала я сказала 12 июня, но правильная дата — 14 июня, после 15:00." : "Анна, +74951234567. Хотела бы 14 июня после 15:00.", language },
    { role: "secretary", text: "Записала пожелания. Владелец должен проверить возможность и подтвердить детали.", language },
  ];
  if (language === "es") return [
    { role: "caller", text: "Hola, quisiera preguntar por un masaje a domicilio.", language },
    { role: "secretary", text: "¿Me indica su nombre y un número para devolverle la llamada?", language },
    { role: "caller", text: "Soy Elena, +34600123456. El sábado por la tarde, por favor.", language },
    { role: "secretary", text: "Anoto su solicitud para que la revise el propietario. No es una reserva confirmada.", language },
  ];
  return [
    { role: "caller", text: "Hi, I'm interested in an in-home massage.", language },
    { role: "secretary", text: "May I have your name and the best number for a callback?", language },
    { role: "caller", text: correction ? "I'm Morgan Example, +14155550127. I first said Friday, but I meant Saturday around 2 pm." : "Morgan Example, +14155550127. Is Saturday around 2 pm possible?", language },
    { role: "secretary", text: "I’ll note your request for the owner to review. This is not a confirmed booking.", language },
  ];
}

export default function IncomingSecretary() {
  const [, setLocation] = useLocation();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const token = auth?.token ?? null;
  const authLoading = auth?.isLoading ?? false;
  const publicPreview = typeof window !== "undefined" && window.location.pathname === "/incoming-secretary-preview";
  const isOfflineDemoRoute = publicPreview && import.meta.env.DEV;
  const localPreviewId = useRef(1);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [timeZone, setTimeZone] = useState("");
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [business, setBusiness] = useState<BusinessHours>(defaultBusiness);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [creatingCard, setCreatingCard] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>(sampleTurns("en"));
  const [fields, setFields] = useState<Fields>({
    language: "en", name: "Morgan Example", phone: "+14155550127", callbackConfirmed: true,
    address: "12 Example Street", localDate: "2025-06-14", localTime: "15:00",
    durationMinutes: 60, reviewed: false, notes: "Synthetic sample data.",
  });
  const [endReason, setEndReason] = useState<EndReason>("completed");
  const [failSave, setFailSave] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState("");

  useEffect(() => {
    if (!publicPreview && !authLoading && !user) setLocation("/");
  }, [publicPreview, authLoading, user, setLocation]);

  const load = useCallback(async () => {
    if (isOfflineDemoRoute) {
      setLoading(false);
      setLoadError("");
      setPayload((current) => current ?? { ...publicPreviewFixture });
      setSelectedNumberId((current) => current || publicPreviewFixture.numbers[0].id);
      setSelectedRequestId((current) => current || publicPreviewFixture.requests[0].id);
      return;
    }
    if (!token) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/incoming-secretary", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(await responseError(response, "Не удалось загрузить настройки входящего Secretary."));
      const data = await response.json() as Payload;
      setPayload(data);
      setSelectedNumberId((previous) => previous && data.numbers.some((number) => number.id === previous) ? previous : data.numbers[0]?.id || "");
      setSelectedRequestId((previous) => previous || data.requests[0]?.id || "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Ошибка сети. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }, [token, isOfflineDemoRoute]);

  useEffect(() => {
    if (isOfflineDemoRoute) void load();
    else if (token && user) void load();
  }, [token, user, load, isOfflineDemoRoute]);

  const currentSetting = useMemo(
    () => payload?.settings.find((setting) => setting.numberId === selectedNumberId),
    [payload, selectedNumberId],
  );
  useEffect(() => {
    setEnabled(currentSetting?.enabled ?? false);
    setTimeZone(currentSetting?.timeZone ?? "");
    setCardIds(currentSetting?.cardIds ?? []);
    setBusiness(currentSetting?.business ?? defaultBusiness);
    setSettingsMessage("");
  }, [currentSetting]);

  const selectedNumber = payload?.numbers.find((number) => number.id === selectedNumberId);
  const workCards = payload?.cards.filter((card) => card.profileScope === "work") ?? [];
  const activeRequests = payload?.requests ?? [];
  const selectedRequest = activeRequests.find((request) => request.id === selectedRequestId) ?? activeRequests[0];
  const previewUser = user as (typeof user & { isOwner?: boolean }) | null;
  const isPreviewAllowed = Boolean(isOfflineDemoRoute || (import.meta.env.DEV && payload?.previewAvailable === true && (previewUser?.isAdmin || previewUser?.isOwner)));
  const timezoneReady = Boolean(timeZone.trim());
  const saveDisabled = savingSettings || !selectedNumberId || (enabled && !timezoneReady) || business.travelMinutes < 30;

  function updateField<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  function chooseScenario(language: Language, correction = false) {
    setTurns(sampleTurns(language, correction));
    setFields({ ...emptyFields(language), name: language === "ru" ? "Анна Example" : language === "es" ? "Elena Example" : "Morgan Example", phone: language === "ru" ? "+74951234567" : language === "es" ? "+34600123456" : "+14155550127", callbackConfirmed: true, address: "12 Example Street", localDate: "2025-06-14", localTime: "15:00", durationMinutes: 60, notes: correction ? "В реплике исправлена дата/время; проверить актуальное пожелание." : "Synthetic sample data." });
    setPreviewMessage("");
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isOfflineDemoRoute) {
      setSettingsMessage("Offline demo only. Изменения показаны локально и не сохраняются.");
      return;
    }
    if (saveDisabled || !token) return;
    setSavingSettings(true);
    setSettingsMessage("");
    try {
      const response = await fetch(`/api/incoming-secretary/settings/${encodeURIComponent(selectedNumberId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled, timeZone: timeZone.trim(), cardIds, business }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Не удалось сохранить настройки."));
      setSettingsMessage("Настройки сохранены. Сохранение не включает обработку входящих звонков.");
      await load();
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function createTemplateCard() {
    if (isOfflineDemoRoute) {
      setCardMessage("Offline demo only. Карточка не создана и не сохранена.");
      return;
    }
    if (!token || !payload || creatingCard) return;
    setCreatingCard(true);
    setCardMessage("");
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cardType: "company", title: "Выездной массаж — подготовка", body: payload.templateText, profileScope: "work" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Не удалось создать карточку."));
      setCardMessage("Рабочая карточка создана. Она не выбрана в настройках автоматически.");
      await load();
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : "Не удалось создать карточку.");
    } finally {
      setCreatingCard(false);
    }
  }

  async function runPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isOfflineDemoRoute) {
      if (!payload || !selectedNumberId || previewBusy) return;
      setPreviewBusy(true);
      setPreviewMessage("");
      window.setTimeout(() => {
        if (failSave) {
          setPreviewMessage("Offline simulation: deterministic save-failure branch. Nothing was saved or added to history.");
        } else {
          const required: Array<keyof Fields> = ["name", "phone", "address", "localDate", "localTime"];
          const missing = required.filter((field) => !String(fields[field] ?? "").trim()).map((field) => String(field));
          if (!fields.callbackConfirmed) missing.push("callbackConfirmed");
          const request: IncomingRequest = {
            id: `demo-offline-sim-${String(localPreviewId.current++).padStart(2, "0")}`,
            numberId: selectedNumberId,
            callSid: "DEMO-CALL-OFFLINE",
            status: "demo_pending_owner_confirmation",
            fields: { ...fields },
            missing,
            turns: turns.map((turn) => ({ ...turn })),
            outcome: "Offline simulation only · owner confirmation required",
            updatedAt: "2025-06-14T16:00:00.000Z",
            notificationStatus: "not_sent_demo",
          };
          setPayload((previous) => previous ? { ...previous, requests: [request, ...previous.requests] } : previous);
          setSelectedRequestId(request.id);
          setPreviewMessage("Offline simulation complete. Synthetic entry shown locally; no API, notification, or persistence was used.");
        }
        setPreviewBusy(false);
      }, 180);
      return;
    }
    if (!token || !selectedNumberId || previewBusy) return;
    setPreviewBusy(true);
    setPreviewMessage("");
    try {
      const response = await fetch("/api/incoming-secretary/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ numberId: selectedNumberId, turns, fields, endReason, failSave }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Предпросмотр не выполнен.");
      setPreviewMessage(typeof result.notice === "string" ? result.notice : "Симуляция завершена.");
      setSelectedRequestId(result.request?.id ?? "");
      await load();
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : "Не удалось выполнить предпросмотр.");
    } finally {
      setPreviewBusy(false);
    }
  }

  if (publicPreview && !import.meta.env.DEV) {
    return <main className="min-h-[100dvh] bg-[#101b21] p-8 text-[#e8efec]"><h1 className="text-2xl font-semibold">Preview unavailable</h1><p className="mt-2 text-[#a9bbb7]">This visual-only route is available in development builds only.</p></main>;
  }

  if (!publicPreview && (authLoading || (!user && !loadError))) {
    return <div className="min-h-[100dvh] bg-[#101b21] flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-teal-300" /></div>;
  }

  return (
    <div className="min-h-[100dvh] bg-[#101b21] text-[#e8efec]">
      <header className="border-b border-[#2d4145] bg-[#142328]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <Button variant="ghost" size="icon" aria-label="Назад к настройкам профилей" onClick={() => setLocation("/settings/call-profiles")} className="text-[#b6cbc5] hover:bg-[#20363a] hover:text-white"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-teal-300">TalkHint / Рабочая линия</p>
            <h1 className="text-lg font-semibold sm:text-xl">Входящий Secretary</h1>
          </div>
          <Link href="/settings/call-profiles" className="hidden text-sm text-[#b6cbc5] underline-offset-4 hover:text-white hover:underline sm:inline">Профили звонков</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-6 sm:py-9">
        {isOfflineDemoRoute && <div className="rounded-xl border border-amber-700/70 bg-[#332d21] px-4 py-3 text-sm leading-6 text-amber-100"><strong>Public visual preview · offline only.</strong> All names, numbers, transcripts, dates, requests, and statuses are synthetic fixtures. Interactions run locally in this browser; nothing is sent to a server or persisted after reload.</div>}
        <section className="grid gap-6 border-b border-[#2d4145] pb-7 md:grid-cols-[1.25fr_0.75fr] md:items-end">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#496761] bg-[#203a39] px-3 py-1 text-xs font-medium text-[#c2e7d9]"><ShieldCheck className="h-3.5 w-3.5" />Подготовка, не активация</p>
            <h2 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Соберите рабочий контекст для будущих входящих.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#a9bbb7] sm:text-base">Вы задаёте часы, рабочие карточки и границы разговора. Сейчас это только настройки и текстовая симуляция — Secretary не отвечает на реальные звонки.</p>
          </div>
          <div className="rounded-2xl border border-[#725f3f] bg-[#332d21] p-4">
            <div className="flex items-center gap-2 text-amber-200"><AlertTriangle className="h-4 w-4" /><strong className="text-sm">Обработка отключена</strong></div>
            <p className="mt-2 text-sm leading-5 text-[#d5cbb5]">Runtime: {payload?.runtimeEnabled ? "сервер сообщил enabled" : "выключен"}. Сохранённые настройки сами по себе ничего не активируют. Календарь не подключён; запись и подтверждение встречи не гарантируются.</p>
          </div>
        </section>

        {loading && !payload ? (
          <div className="grid gap-4 lg:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl border border-[#2d4145] bg-[#17282d]" /><div className="h-72 animate-pulse rounded-2xl border border-[#2d4145] bg-[#17282d]" /></div>
        ) : loadError ? (
          <Card className="border-rose-900 bg-[#20282b] text-white"><CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between"><p role="alert" className="text-sm text-rose-200">{loadError}</p><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Повторить</Button></CardContent></Card>
        ) : payload ? (
          <>
            <section className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
                <CardHeader>
                  <p className="text-xs uppercase tracking-[0.16em] text-teal-300">01 / Контекст линии</p>
                  <CardTitle className="text-xl">Настройки рабочего номера</CardTitle>
                  <CardDescription className="text-[#a9bbb7]">По умолчанию всё выключено. Для включённой настройки обязателен часовой пояс.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!payload.numbers.length ? (
                    <div className="rounded-xl border border-dashed border-[#496064] p-5 text-sm leading-6 text-[#adbfbb]">Нет доступных рабочих номеров. Подключите рабочую линию в <Link href="/settings/call-profiles" className="text-teal-200 underline underline-offset-4">профилях звонков</Link>, затем вернитесь сюда.</div>
                  ) : (
                    <form onSubmit={saveSettings} className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="incoming-number" className="text-[#dce8e4]">Рабочий номер</Label>
                        <select id="incoming-number" value={selectedNumberId} onChange={(event) => setSelectedNumberId(event.target.value)} className="h-11 w-full rounded-lg border border-[#40585c] bg-[#102025] px-3 text-sm text-white">
                          {payload.numbers.map((number) => <option key={number.id} value={number.id}>{number.name} · {number.phoneNumber}</option>)}
                        </select>
                      </div>
                      {selectedNumber && <div className="flex items-center justify-between rounded-lg border border-[#30484c] bg-[#122328] px-3 py-2.5"><span className="text-sm text-[#b4c5c1]">{selectedNumber.name}</span><span className="font-mono text-sm text-teal-200">{selectedNumber.phoneNumber}</span></div>}
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#3f575a] bg-[#13262a] p-3.5">
                        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-1 accent-teal-400" />
                        <span><span className="block text-sm font-semibold">Подготовить Secretary для этой линии</span><span className="mt-1 block text-xs leading-5 text-[#9eb2ae]">Это сохранит предпочтение, но не запускает runtime в текущем продукте.</span></span>
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="timezone" className="text-[#dce8e4]">Часовой пояс IANA</Label>
                          <Input id="timezone" list="incoming-timezones" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="Например, America/Los_Angeles" className="border-[#40585c] bg-[#102025] text-white placeholder:text-[#748985]" />
                          <datalist id="incoming-timezones"><option value="America/Los_Angeles" /><option value="America/New_York" /><option value="America/Chicago" /><option value="Europe/Moscow" /><option value="Europe/Madrid" /></datalist>
                          {enabled && !timezoneReady && <p className="text-xs text-amber-200">Укажите часовой пояс, прежде чем сохранить включённую настройку.</p>}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="travel-minutes" className="text-[#dce8e4]">Время на дорогу</Label>
                          <div className="relative"><Input id="travel-minutes" type="number" min={30} step={5} value={business.travelMinutes} onChange={(event) => setBusiness((previous) => ({ ...previous, travelMinutes: Number(event.target.value) }))} className="border-[#40585c] bg-[#102025] pr-16 text-white" /><span className="absolute right-3 top-2.5 text-xs text-[#8fa49f]">минут</span></div>
                          <p className="text-xs text-[#8fa49f]">Минимум 30 минут между выездами.</p>
                        </div>
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="flex items-center gap-2 text-sm font-medium text-[#dce8e4]"><CalendarDays className="h-4 w-4 text-teal-300" />Рабочие дни</legend>
                        <div className="flex flex-wrap gap-2">
                          {weekdays.map((day) => {
                            const checked = business.days.includes(day.value);
                            return <label key={day.value} className={`flex min-h-10 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm transition-colors ${checked ? "border-teal-500 bg-[#1d4744] text-teal-100" : "border-[#40585c] bg-[#102025] text-[#9eb2ae] hover:border-[#68817b]"}`}>
                              <input type="checkbox" className="sr-only" checked={checked} onChange={() => setBusiness((previous) => ({ ...previous, days: checked ? previous.days.filter((value) => value !== day.value) : [...previous.days, day.value] }))} aria-label={`${day.label}, день недели ${day.value}`} />
                              {day.label}
                            </label>;
                          })}
                        </div>
                        <p className="text-xs text-[#829793]">Нумерация JavaScript: воскресенье — 0, понедельник — 1.</p>
                      </fieldset>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="opens" className="text-[#dce8e4]">Открытие</Label><Input id="opens" type="time" value={business.opens} onChange={(event) => setBusiness((previous) => ({ ...previous, opens: event.target.value }))} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="closes" className="text-[#dce8e4]">Закрытие</Label><Input id="closes" type="time" value={business.closes} onChange={(event) => setBusiness((previous) => ({ ...previous, closes: event.target.value }))} className="border-[#40585c] bg-[#102025] text-white" /></div>
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-[#dce8e4]">Рабочие карточки для disclosure</legend>
                        {workCards.length ? <div className="space-y-2">{workCards.map((card) => <label key={card.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#344b4f] bg-[#122328] p-3"><input type="checkbox" checked={cardIds.includes(card.id)} onChange={() => setCardIds((previous) => previous.includes(card.id) ? previous.filter((id) => id !== card.id) : [...previous, card.id])} className="mt-1 accent-teal-400" /><span><span className="block text-sm font-medium">{card.title}</span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-[#9eb2ae]">{card.body}</span></span></label>)}</div> : <p className="rounded-lg border border-dashed border-[#40585c] p-3 text-sm text-[#9eb2ae]">Рабочих карточек пока нет. Общие карточки не предлагаются и не используются.</p>}
                      </fieldset>
                      <div className="flex flex-col gap-3 border-t border-[#30474b] pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-5 text-[#8fa49f]">Неизвестны цены, длительность услуги, зона выезда и условия отмены. Secretary не должен обещать их от имени владельца.</p>
                        <Button type="submit" disabled={saveDisabled} className="shrink-0 bg-[#28756a] text-white hover:bg-[#328b7c]"><Check className="mr-2 h-4 w-4" />{savingSettings ? "Сохраняем…" : "Сохранить настройки"}</Button>
                      </div>
                      {settingsMessage && <p role="status" className="text-sm text-teal-200">{settingsMessage}</p>}
                    </form>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
                  <CardHeader><p className="text-xs uppercase tracking-[0.16em] text-teal-300">02 / Сведения</p><CardTitle className="text-xl">Подготовительная карточка</CardTitle><CardDescription className="text-[#a9bbb7]">Создать можно только явно. Карточка останется рабочей, не общей.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-xl border border-[#3c5355] bg-[#122328] p-4"><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-teal-300" />Предлагаемый текст</p><p className="whitespace-pre-wrap text-sm leading-6 text-[#bdcbc7]">{payload.templateText || "Шаблон пока не предоставлен сервером."}</p></div>
                    <Button onClick={() => void createTemplateCard()} disabled={!payload.templateText || creatingCard} variant="outline" className="w-full border-[#53716a] text-teal-100 hover:bg-[#203a39]">{creatingCard ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Создать рабочую карточку</Button>
                    {cardMessage && <p role="status" className="text-sm text-teal-200">{cardMessage}</p>}
                    <p className="text-xs leading-5 text-[#899e99]">Создание не включает карточку в disclosure — выберите её вручную в настройках выше. Общие и личные карточки не доступны здесь.</p>
                  </CardContent>
                </Card>

                <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
                  <CardHeader><p className="text-xs uppercase tracking-[0.16em] text-teal-300">03 / Ограничения</p><CardTitle className="text-xl">Пока нет бронирования</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm leading-6 text-[#afc0bc]">
                    <p className="flex gap-2"><Clock3 className="mt-1 h-4 w-4 shrink-0 text-amber-200" />Секретарь может только собрать пожелания для проверки владельцем; цены и свободное время неизвестны.</p>
                    <p className="flex gap-2"><CalendarDays className="mt-1 h-4 w-4 shrink-0 text-amber-200" />Календарь {payload.calendarConnected ? "подключён по данным API" : "не подключён"}. Никакая встреча не создаётся и не подтверждается.</p>
                    <p className="rounded-lg border border-[#5d513a] bg-[#322d22] p-3 text-xs text-[#d7c9a9]">Будущая функция. Сохранение enabled не означает, что звонки уже направляются секретарю.</p>
                  </CardContent>
                </Card>
              </div>
            </section>

            {isPreviewAllowed && (
              <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <Card className="border-[#426060] bg-[#192e32] text-[#e8efec]">
                  <CardHeader className="border-b border-[#344d50]"><p className="text-xs uppercase tracking-[0.16em] text-amber-200">{isOfflineDemoRoute ? "PUBLIC PREVIEW · OFFLINE" : "DEVELOPMENT ONLY · ADMIN"}</p><CardTitle className="text-xl">Текстовый предпросмотр</CardTitle><CardDescription className="text-[#a9bbb7]">{isOfflineDemoRoute ? "Локальная детерминированная демонстрация. Без API, микрофона, ИИ, дозвона, реальной заявки или брони." : "Детерминированная серверная симуляция с теми же правилами валидации и сохранения. Без микрофона, ИИ, дозвона, реальной заявки или брони."}</CardDescription></CardHeader>
                  <CardContent className="pt-5">
                    <form onSubmit={runPreview} className="space-y-5">
                      <div className="flex flex-wrap gap-2">
                        {(["en", "ru", "es"] as Language[]).map((language) => <Button key={language} type="button" size="sm" variant="outline" onClick={() => chooseScenario(language)} className="border-[#4a6665] text-[#c7dfd8] hover:bg-[#25413f]">{languageLabels[language]} sample</Button>)}
                        <Button type="button" size="sm" variant="outline" onClick={() => chooseScenario("en", true)} className="border-amber-800 text-amber-100 hover:bg-amber-950/40"><WandSparkles className="mr-1.5 h-3.5 w-3.5" />Correction</Button>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between"><Label className="text-[#dce8e4]">Реплики transcript</Label><Button type="button" size="sm" variant="ghost" onClick={() => setTurns((previous) => [...previous, { role: "caller", text: "", language: "en" }])} className="text-teal-200"><Plus className="mr-1 h-4 w-4" />Реплика</Button></div>
                        {turns.map((turn, index) => <div key={`${index}-${turn.role}`} className="grid gap-2 rounded-xl border border-[#385054] bg-[#14272b] p-3 sm:grid-cols-[120px_120px_1fr_auto]">
                          <select value={turn.role} onChange={(event) => setTurns((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value as TurnRole } : item))} aria-label={`Роль реплики ${index + 1}`} className="h-10 rounded-md border border-[#40585c] bg-[#102025] px-2 text-sm text-white"><option value="caller">Caller</option><option value="secretary">Secretary</option></select>
                          <select value={turn.language || "en"} onChange={(event) => setTurns((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, language: event.target.value as Language } : item))} aria-label={`Язык реплики ${index + 1}`} className="h-10 rounded-md border border-[#40585c] bg-[#102025] px-2 text-sm text-white">{(["en", "ru", "es"] as Language[]).map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}</select>
                          <Textarea value={turn.text} maxLength={1500} onChange={(event) => setTurns((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} aria-label={`Текст реплики ${index + 1}`} className="min-h-10 border-[#40585c] bg-[#102025] text-white" />
                          <Button type="button" variant="ghost" size="icon" aria-label={`Удалить реплику ${index + 1}`} onClick={() => setTurns((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="text-[#a8bbb5] hover:text-rose-200"><span aria-hidden="true">×</span></Button>
                        </div>)}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="preview-name" className="text-[#dce8e4]">Имя</Label><Input id="preview-name" value={fields.name || ""} onChange={(event) => updateField("name", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-phone" className="text-[#dce8e4]">Телефон</Label><Input id="preview-phone" value={fields.phone || ""} onChange={(event) => updateField("phone", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-address" className="text-[#dce8e4]">Адрес</Label><Input id="preview-address" value={fields.address || ""} onChange={(event) => updateField("address", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-language" className="text-[#dce8e4]">Язык звонка</Label><select id="preview-language" value={fields.language || "en"} onChange={(event) => updateField("language", event.target.value as Language)} className="h-10 w-full rounded-md border border-[#40585c] bg-[#102025] px-3 text-sm text-white">{(["en", "ru", "es"] as Language[]).map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}</select></div>
                        <div className="space-y-2"><Label htmlFor="preview-date" className="text-[#dce8e4]">Желаемая дата</Label><Input id="preview-date" type="date" value={fields.localDate || ""} onChange={(event) => updateField("localDate", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-time" className="text-[#dce8e4]">Желаемое время</Label><Input id="preview-time" type="time" value={fields.localTime || ""} onChange={(event) => updateField("localTime", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-duration" className="text-[#dce8e4]">Длительность, минуты</Label><Input id="preview-duration" type="number" min={1} value={fields.durationMinutes ?? ""} onChange={(event) => updateField("durationMinutes", event.target.value ? Number(event.target.value) : undefined)} className="border-[#40585c] bg-[#102025] text-white" /></div>
                        <div className="space-y-2"><Label htmlFor="preview-end" className="text-[#dce8e4]">Завершение сценария</Label><select id="preview-end" value={endReason} onChange={(event) => setEndReason(event.target.value as EndReason)} className="h-10 w-full rounded-md border border-[#40585c] bg-[#102025] px-3 text-sm text-white"><option value="completed">Завершён</option><option value="disconnected">Связь прервана</option></select></div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex gap-2 text-sm text-[#b9c9c5]"><input type="checkbox" checked={Boolean(fields.callbackConfirmed)} onChange={(event) => updateField("callbackConfirmed", event.target.checked)} className="accent-teal-400" />Согласие на обратный звонок</label>
                        <label className="flex gap-2 text-sm text-[#b9c9c5]"><input type="checkbox" checked={Boolean(fields.reviewed)} onChange={(event) => updateField("reviewed", event.target.checked)} className="accent-teal-400" />Сценарий отмечен как reviewed</label>
                        <label className="flex gap-2 text-sm text-[#b9c9c5] sm:col-span-2"><input type="checkbox" checked={failSave} onChange={(event) => setFailSave(event.target.checked)} className="accent-amber-400" />Имитировать отказ сохранения (failSave)</label>
                      </div>
                      <div className="space-y-2"><Label htmlFor="preview-notes" className="text-[#dce8e4]">Заметки</Label><Textarea id="preview-notes" value={fields.notes || ""} onChange={(event) => updateField("notes", event.target.value)} className="min-h-20 border-[#40585c] bg-[#102025] text-white" /></div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-[#91a7a1]">Номер для симуляции: {selectedNumber?.phoneNumber || "не выбран"}. Настройка должна быть доступна для тестирования; проверки сервера являются окончательными.</p><Button type="submit" disabled={previewBusy || !selectedNumberId} className="bg-[#28756a] hover:bg-[#328b7c]">{previewBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronRight className="mr-2 h-4 w-4" />}Выполнить симуляцию</Button></div>
                      {previewMessage && <p role="status" className="rounded-lg border border-[#46675d] bg-[#193832] p-3 text-sm text-[#d0e8dc]">{previewMessage}</p>}
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
                  <CardHeader className="border-b border-[#344b4f]"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-teal-300">04 / История симуляций</p><CardTitle className="mt-1 text-xl">Заявки для проверки</CardTitle></div><Badge variant="outline" className="border-[#52716a] text-[#c1ded4]">{activeRequests.length}</Badge></div></CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    {activeRequests.length ? <div className="max-h-56 space-y-2 overflow-y-auto pr-1">{activeRequests.map((request) => {
                      const requestNumber = payload.numbers.find((number) => number.id === request.numberId);
                      return <button type="button" key={request.id} onClick={() => setSelectedRequestId(request.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedRequest?.id === request.id ? "border-teal-500 bg-[#1c3b39]" : "border-[#344b4f] bg-[#122328] hover:border-[#627c76]"}`}>
                        <span className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{request.fields.name || "Имя не указано"} · {requestNumber?.phoneNumber || request.numberId}</span><span className="shrink-0 text-xs text-[#a3b7b1]">{request.status}</span></span>
                        <span className="mt-1 block truncate text-xs text-[#8da39c]">{request.outcome || "Ожидает проверки владельцем"} · {new Date(request.updatedAt).toLocaleString()}</span>
                        {request.notificationStatus && <span className="mt-1 block truncate text-[11px] text-[#839891]">Уведомление: {request.notificationStatus}</span>}
                      </button>;
                    })}</div> : <div className="rounded-xl border border-dashed border-[#40585c] px-4 py-8 text-center"><FileText className="mx-auto mb-2 h-6 w-6 text-[#75918a]" /><p className="text-sm font-medium">История пока пуста</p><p className="mt-1 text-xs text-[#8fa49f]">Новый текстовый сценарий появится после симуляции.</p></div>}
                    {selectedRequest && <div className="space-y-4 border-t border-[#344b4f] pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Детали заявки</h3><Badge variant="outline" className="border-amber-800 text-amber-200">{isOfflineDemoRoute ? "DEMO · не реальная заявка" : "Ожидает подтверждения владельцем"}</Badge></div>
                      <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-[#122328] p-3 text-sm sm:grid-cols-2">
                        {Object.entries(selectedRequest.fields || {}).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs text-[#8fa49f]">{key}</dt><dd className="break-words text-[#d6e1dd]">{typeof value === "boolean" ? value ? "Да" : "Нет" : value || "—"}</dd></div>)}
                        <div><dt className="text-xs text-[#8fa49f]">Нужно уточнить</dt><dd className="text-[#d6e1dd]">{selectedRequest.missing?.length ? selectedRequest.missing.join(", ") : "Нет"}</dd></div>
                        <div><dt className="text-xs text-[#8fa49f]">Исход</dt><dd className="text-[#d6e1dd]">{selectedRequest.outcome || "Ожидает проверки"}</dd></div>
                        <div><dt className="text-xs text-[#8fa49f]">Статус / call SID</dt><dd className="break-all text-[#d6e1dd]">{selectedRequest.status} · {selectedRequest.callSid || "нет"}</dd></div>
                        <div><dt className="text-xs text-[#8fa49f]">Часовой пояс заявки</dt><dd className="break-words text-[#d6e1dd]">{selectedRequest.timeZone || "Не сохранён"}</dd></div>
                        {selectedRequest.notificationStatus && <div><dt className="text-xs text-[#8fa49f]">Статус уведомления</dt><dd className="break-words text-[#d6e1dd]">{selectedRequest.notificationStatus}</dd></div>}
                      </dl>
                      <div>
                        <p className="mb-2 text-sm font-medium">Оригинальные реплики и языки</p>
                        <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-[#344b4f] bg-[#122328] p-3">
                          {selectedRequest.turns?.length ? selectedRequest.turns.map((turn, index) => <div key={`${index}-${turn.role}`} className={`max-w-[92%] rounded-lg p-2.5 text-sm leading-5 ${turn.role === "caller" ? "bg-[#203a3b] text-[#e0ece7]" : "ml-auto bg-[#28443b] text-[#e1eee5]"}`}><div className="mb-1 flex justify-between gap-3 text-[10px] uppercase tracking-wider text-[#a7c0b5]"><span>{turn.role === "caller" ? "Caller" : "Secretary"}</span><span>{turn.language ? languageLabels[turn.language] || turn.language : "Язык не указан"}</span></div>{turn.text}</div>) : <p className="text-sm text-[#8fa49f]">Реплики отсутствуют.</p>}
                        </div>
                      </div>
                    </div>}
                  </CardContent>
                </Card>
              </section>
            )}
            {!isPreviewAllowed && (
              <section aria-label="История входящих заявок">
                <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
                  <CardHeader className="border-b border-[#344b4f]">
                    <div className="flex items-center justify-between gap-3">
                      <div><p className="text-xs uppercase tracking-[0.16em] text-teal-300">История</p><CardTitle className="mt-1 text-xl">Заявки для проверки владельцем</CardTitle></div>
                      <Badge variant="outline" className="border-[#52716a] text-[#c1ded4]">{activeRequests.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    {activeRequests.length ? <div className="grid gap-2 md:grid-cols-2">{activeRequests.map((request) => {
                      const requestNumber = payload.numbers.find((number) => number.id === request.numberId);
                      return <button type="button" key={request.id} onClick={() => setSelectedRequestId(request.id)} className={`rounded-xl border p-3 text-left transition-colors ${selectedRequest?.id === request.id ? "border-teal-500 bg-[#1c3b39]" : "border-[#344b4f] bg-[#122328] hover:border-[#627c76]"}`}>
                        <span className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{request.fields.name || "Имя не указано"} · {requestNumber?.phoneNumber || request.numberId}</span><span className="shrink-0 text-xs text-[#a3b7b1]">{request.status}</span></span>
                        <span className="mt-1 block text-xs text-[#8da39c]">{request.outcome || "Ожидает подтверждения владельцем"} · {new Date(request.updatedAt).toLocaleString()}</span>
                        {request.notificationStatus && <span className="mt-1 block truncate text-[11px] text-[#839891]">Уведомление: {request.notificationStatus}</span>}
                      </button>;
                    })}</div> : <div className="rounded-xl border border-dashed border-[#40585c] px-4 py-8 text-center"><FileText className="mx-auto mb-2 h-6 w-6 text-[#75918a]" /><p className="text-sm font-medium">История пока пуста</p><p className="mt-1 text-xs text-[#8fa49f]">Здесь появятся запросы по рабочим номерам.</p></div>}
                    {selectedRequest && <div className="grid gap-5 border-t border-[#344b4f] pt-4 lg:grid-cols-2">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Сведения</h3><Badge variant="outline" className="border-amber-800 text-amber-200">{isOfflineDemoRoute ? "DEMO · не реальная заявка" : "Ожидает подтверждения владельцем"}</Badge></div>
                        <dl className="grid gap-2 rounded-xl bg-[#122328] p-3 text-sm sm:grid-cols-2">
                          {Object.entries(selectedRequest.fields || {}).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs text-[#8fa49f]">{key}</dt><dd className="break-words text-[#d6e1dd]">{typeof value === "boolean" ? value ? "Да" : "Нет" : value || "—"}</dd></div>)}
                          <div><dt className="text-xs text-[#8fa49f]">Нужно уточнить</dt><dd className="text-[#d6e1dd]">{selectedRequest.missing?.length ? selectedRequest.missing.join(", ") : "Нет"}</dd></div>
                          <div><dt className="text-xs text-[#8fa49f]">Исход / статус</dt><dd className="text-[#d6e1dd]">{selectedRequest.outcome || "Ожидает проверки"} · {selectedRequest.status}</dd></div>
                          <div><dt className="text-xs text-[#8fa49f]">Часовой пояс заявки</dt><dd className="break-words text-[#d6e1dd]">{selectedRequest.timeZone || "Не сохранён"}</dd></div>
                          <div className="sm:col-span-2"><dt className="text-xs text-[#8fa49f]">Call SID</dt><dd className="break-all text-[#d6e1dd]">{selectedRequest.callSid || "Не указан"}</dd></div>
                          {selectedRequest.notificationStatus && <div className="sm:col-span-2"><dt className="text-xs text-[#8fa49f]">Статус уведомления</dt><dd className="break-words text-[#d6e1dd]">{selectedRequest.notificationStatus}</dd></div>}
                        </dl>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">Оригинальный transcript и язык</p>
                        <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[#344b4f] bg-[#122328] p-3">
                          {selectedRequest.turns?.length ? selectedRequest.turns.map((turn, index) => <div key={`${index}-${turn.role}`} className={`max-w-[92%] rounded-lg p-2.5 text-sm leading-5 ${turn.role === "caller" ? "bg-[#203a3b] text-[#e0ece7]" : "ml-auto bg-[#28443b] text-[#e1eee5]"}`}><div className="mb-1 flex justify-between gap-3 text-[10px] uppercase tracking-wider text-[#a7c0b5]"><span>{turn.role === "caller" ? "Caller" : "Secretary"}</span><span>{turn.language ? languageLabels[turn.language] || turn.language : "Язык не указан"}</span></div>{turn.text}</div>) : <p className="text-sm text-[#8fa49f]">Реплики отсутствуют.</p>}
                        </div>
                      </div>
                    </div>}
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
