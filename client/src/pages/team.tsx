import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TeamEvent, TeamMember, TeamPin, TeamStatus, TeamView } from "@shared/team";
import { partitionTeamMembers } from "@/lib/teamPresentation";
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, BriefcaseBusiness, Check, ChevronDown,
  CircleHelp, Clock3, Eye, EyeOff, Fingerprint, LockKeyhole, Network, RefreshCw, X,
  ShieldCheck, Sparkles, UserRound, Users,
} from "lucide-react";

const TEAM_URL = "/api/admin/team";
const GRANT_URL = "/api/admin/team/grant";
const APPLY_URL = "/api/admin/team/apply";
const PARTNERS_GRANT_URL = "/api/admin/team/partners/grant";
const PARTNERS_APPLY_URL = "/api/admin/team/partners/apply";

const statusCopy: Record<TeamStatus, { label: string; tone: string }> = {
  autonomous: { label: "Работает сам", tone: "green" },
  replit: { label: "Роль играет Replit", tone: "teal" },
  disconnected: { label: "Описан, но не подключён", tone: "amber" },
  planned: { label: "Запланирован", tone: "slate" },
  unresolved: { label: "Требует уточнения", tone: "rose" },
  owner_chat: { label: "Работает с владельцем в чате", tone: "indigo" },
  contractor: { label: "Внешний подрядчик", tone: "orange" },
};

type TeamActionReport = NonNullable<TeamMember["actionReports"]>[number];
type TeamPartners = NonNullable<TeamView["partners"]>;
type ActivityFilter = "all" | "reports" | TeamEvent["source"];
type TeamFeedItem = { kind: "event"; event: TeamEvent } | { kind: "report"; report: TeamActionReport; member: TeamMember };

const eventSourceLabel: Record<TeamEvent["source"], string> = {
  journal: "Журнал",
  call_lab: "Лаборатория звонков",
  oncall: "Дежурство",
};

function missing(value: string | null | undefined) {
  return value?.trim() ? value : "Не заполнено";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru")).join("") || "?";
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Не заполнено";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function hashLabel(value: string) {
  return value || "Не получен от сервера";
}

async function responseError(response: Response) {
  let message = "";
  try {
    const body = await response.json();
    if (typeof body?.error === "string") message = body.error;
    else if (typeof body?.message === "string") message = body.message;
  } catch {
    // Use the HTTP status if the response does not contain JSON.
  }
  if (response.status === 401) return `Требуется вход владельца (401). ${message}`.trim();
  if (response.status === 403) return `Сервер отказал в доступе (403). ${message}`.trim();
  return message || `Сервер ответил с ошибкой (${response.status}).`;
}

async function readTeam(response: Response): Promise<TeamView> {
  if (!response.ok) throw new Error(await responseError(response));
  const value = await response.json() as TeamView;
  if (!value || !value.source || !Array.isArray(value.members) || !Array.isArray(value.feed) || !value.apply) {
    throw new Error("Сервер вернул неполный состав команды.");
  }
  return value;
}

export default function TeamPage() {
  const [view, setView] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [applyNotice, setApplyNotice] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [partnersApplying, setPartnersApplying] = useState(false);
  const [partnersApplyError, setPartnersApplyError] = useState("");
  const [partnersApplyNotice, setPartnersApplyNotice] = useState("");
  const [partnersNeedsRefresh, setPartnersNeedsRefresh] = useState(false);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const mounted = useRef(true);
  const requestLock = useRef(false);
  const viewRef = useRef<TeamView | null>(null);
  const applyingRef = useRef(false);
  viewRef.current = view;
  applyingRef.current = applying || partnersApplying;

  const refresh = useCallback(async () => {
    if (requestLock.current || applyingRef.current) return;
    requestLock.current = true;
    setRefreshing(true);
    if (!viewRef.current) setLoading(true);
    try {
      const response = await fetch(TEAM_URL, {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });
      const next = await readTeam(response);
      if (mounted.current) {
        setView(next);
        setLoadError("");
        setApplyError("");
        setApplyNotice("");
        setNeedsRefresh(false);
        setPartnersApplyError("");
        setPartnersApplyNotice("");
        setPartnersNeedsRefresh(false);
      }
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить состав команды.");
    } finally {
      requestLock.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const applyAll = async () => {
    if (!view?.apply.available || !view.apply.pin || !view.apply.csrfToken || applying || needsRefresh) return;
    setConfirmApply(false);
    applyingRef.current = true;
    setApplying(true);
    setApplyError("");
    setApplyNotice("");
    let current = view;
    let completed = current.apply.completed;
    let expected: TeamPin | null = current.apply.pin;
    try {
      while (current.apply.available && expected) {
        setProgress({ step: completed + 1, total: current.apply.total });
        const csrf = current.apply.csrfToken;
        if (!csrf) throw new Error("Сервер не вернул CSRF-токен для следующего шага.");
        const grantResponse = await fetch(GRANT_URL, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "x-team-csrf": csrf },
          body: JSON.stringify({ expected, confirm: true }),
        });
        if (!grantResponse.ok) throw new Error(`Не удалось получить разрешение. ${await responseError(grantResponse)}`);
        const grantBody = await grantResponse.json() as { grant?: unknown };
        if (typeof grantBody?.grant !== "string" || !grantBody.grant) {
          throw new Error("Сервер не вернул разрешение. Результат шага требует сверки.");
        }

        const applyResponse = await fetch(APPLY_URL, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "x-team-csrf": csrf },
          body: JSON.stringify({ expected, confirm: true, grant: grantBody.grant }),
        });
        const updated = await readTeam(applyResponse);
        completed += 1;
        current = updated;
        if (mounted.current) setView(updated);
        expected = updated.apply.pin;
        if (!updated.apply.available && updated.apply.completed !== updated.apply.total) {
          throw new Error("Пакет остановлен: источник изменился или запись закрыта. Обновите статус; автоматического повтора нет.");
        }
        if (updated.apply.available && (!expected || !updated.apply.csrfToken)) {
          throw new Error("Сервер не вернул закреплённую ревизию или CSRF-токен для следующего шага.");
        }
      }
      if (mounted.current) {
        setApplyNotice(completed
          ? `Завершено шагов: ${completed}. Источник обновлён до r${current.source.revision}.`
          : "Нет доступных шагов для применения.");
      }
    } catch (error) {
      if (mounted.current) {
        setApplyError(`Последовательное применение остановлено после ${completed} подтверждённых шагов. Не отправляйте запрос повторно. Обновите статус вручную и сверьте ревизию с владельцем. ${error instanceof Error ? error.message : "Неизвестная ошибка."}`);
        setNeedsRefresh(true);
      }
    } finally {
      if (mounted.current) {
        applyingRef.current = false;
        setApplying(false);
        setProgress(null);
      }
    }
  };

  const applyPartners = async () => {
    const partners = view?.partners;
    if (!partners?.available || !partners.pin || !view?.apply.csrfToken || applying || partnersApplying || applyingRef.current || requestLock.current || partnersNeedsRefresh) return;

    const expected = partners.pin;
    const csrf = view.apply.csrfToken;
    applyingRef.current = true;
    setPartnersApplying(true);
    setPartnersApplyError("");
    setPartnersApplyNotice("");
    try {
      const grantResponse = await fetch(PARTNERS_GRANT_URL, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "x-team-csrf": csrf },
        body: JSON.stringify({ expected, confirm: true }),
      });
      if (!grantResponse.ok) throw new Error(`Не удалось получить разрешение на документ партнёров. ${await responseError(grantResponse)}`);
      const grantBody = await grantResponse.json() as { grant?: unknown };
      if (typeof grantBody?.grant !== "string" || !grantBody.grant) {
        throw new Error("Сервер не вернул одноразовое разрешение. Результат требует сверки.");
      }

      const applyResponse = await fetch(PARTNERS_APPLY_URL, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "x-team-csrf": csrf },
        body: JSON.stringify({ expected, confirm: true, grant: grantBody.grant }),
      });
      const updated = await readTeam(applyResponse);
      if (mounted.current) setView(updated);

      if (!updated.partners?.completed) {
        const currentPin = updated.partners?.pin;
        const pinChanged = !currentPin
          || currentPin.workspace !== expected.workspace
          || currentPin.revision !== expected.revision
          || currentPin.rootHash !== expected.rootHash
          || currentPin.documentHash !== expected.documentHash;
        throw new Error(pinChanged
          ? "Закрепление документа изменилось. Применение остановлено; обновите состояние и сверьте новую ревизию."
          : updated.partners?.reason || "Источник не подтвердил завершение применения документа.");
      }
      if (mounted.current) setPartnersApplyNotice(`Сервер подтвердил применение документа партнёров · r${updated.source.revision}.`);
    } catch (error) {
      if (mounted.current) {
        setPartnersApplyError(`Применение остановлено. Не отправляйте запрос повторно: результат может быть неоднозначным. Обновите состояние и сверьте его с владельцем. ${error instanceof Error ? error.message : "Неизвестная ошибка."}`);
        setPartnersNeedsRefresh(true);
      }
    } finally {
      applyingRef.current = false;
      if (mounted.current) setPartnersApplying(false);
    }
  };

  return (
    <main className="team-page min-h-[100dvh] px-4 pb-16 text-[#263a35] sm:px-7">
      <TeamHeader />
      <div className="mx-auto max-w-[1320px] py-7 sm:py-10">
        {loading && !view ? <TeamSkeleton /> : loadError && !view ? (
          <LoadError error={loadError} onRetry={() => void refresh()} />
        ) : view ? (
          <>
            {loadError && <div className="mb-5 rounded-xl border border-[#e6c8bf] bg-[#fff4ef] px-4 py-3 text-sm text-[#874b3e]" role="alert">{loadError}</div>}
            <TeamContent
              view={view}
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              applying={applying}
              progress={progress}
              applyError={applyError}
              applyNotice={applyNotice}
              applyBlocked={needsRefresh}
              onApply={() => setConfirmApply(true)}
              partnersApplying={partnersApplying}
              partnersApplyError={partnersApplyError}
              partnersApplyNotice={partnersApplyNotice}
              partnersApplyBlocked={partnersNeedsRefresh}
              onPartnersApply={() => void applyPartners()}
            />
          </>
        ) : null}
      </div>
      {confirmApply && view && (
        <div className="team-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmApply(false); }}>
          <section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="apply-title">
            <div className="team-modal-body">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e4efe8] text-[#28634f]"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <h2 id="apply-title" className="text-xl font-semibold tracking-[-0.035em] text-[#263c34]">Подтвердить применение пакета?</h2>
                <p className="mt-2 text-sm leading-6 text-[#687b72]">Будет запущена последовательность из доступных серверных шагов. Для каждого шага запрашивается новое одноразовое разрешение и используется свежая закреплённая ревизия.</p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-[#e0e9e2] bg-[#f3f7f3] p-4 text-sm leading-6 text-[#53685e]">
              Применение нельзя автоматически повторить. Если ответ любого шага будет неоднозначным, последовательность остановится; обновите статус вручную и проверьте состояние перед новым подтверждением.
            </div>
            </div>
            <div className="team-modal-actions mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmApply(false)} className="team-button-secondary">Отмена</button>
              <button type="button" onClick={() => void applyAll()} className="team-button-primary">Подтвердить последовательность</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export function TeamContent({
  view, refreshing, onRefresh, applying, progress, applyError, applyNotice, applyBlocked, onApply,
  partnersApplying = false, partnersApplyError = "", partnersApplyNotice = "", partnersApplyBlocked = false,
  onPartnersApply, initialSelectedId = null, initialConfirmPartners = false,
}: {
  view: TeamView;
  refreshing?: boolean;
  onRefresh?: () => void;
  applying?: boolean;
  progress?: { step: number; total: number } | null;
  applyError?: string;
  applyNotice?: string;
  applyBlocked?: boolean;
  onApply?: () => void;
  partnersApplying?: boolean;
  partnersApplyError?: string;
  partnersApplyNotice?: string;
  partnersApplyBlocked?: boolean;
  onPartnersApply?: () => void;
  /** Standalone visual tests/deep-link hosts may select a profile; no auth bypass. */
  initialSelectedId?: string | null;
  /** Standalone confirmation rendering only; does not bypass owner authentication. */
  initialConfirmPartners?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [confirmPartners, setConfirmPartners] = useState(initialConfirmPartners);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [showAllRoles, setShowAllRoles] = useState(false);
  const { staff, external: externalMembers, plans } = useMemo(
    () => partitionTeamMembers(view.members),
    [view.members],
  );
  const displayMembers = useMemo(
    () => [...staff, ...externalMembers, ...plans],
    [staff, externalMembers, plans],
  );
  const selected = displayMembers.find((member) => member.id === selectedId) ?? null;
  const focusCodes = useMemo(() => new Set(["HEAD.06", "P.PRODUCT", "P.LAB", "P.LG.QA", "P.OPS", "P.COORD", "HEAD.07"]), []);
  const visibleMembers = useMemo(
    () => showAllRoles
      ? staff
      : staff.filter((member) => {
        const code = member.code.trim().toUpperCase();
        const id = member.id.trim().toUpperCase();
        const isStudioHat = code === "REPLIT-HAT" || id === "REPLIT-HAT" || member.status === "replit";
        return focusCodes.has(code)
          || member.status === "planned"
          || member.status === "unresolved"
          || member.kind === "employee"
          || isStudioHat;
      }),
    [focusCodes, staff, showAllRoles],
  );
  const departments = useMemo(() => {
    const preferred = ["Продукт", "Инженерия", "Работают на клиентов"];
    return Array.from(new Set(visibleMembers.map((member) => member.department))).sort((left, right) => {
      const leftRank = preferred.indexOf(left);
      const rightRank = preferred.indexOf(right);
      return (leftRank < 0 ? preferred.length : leftRank) - (rightRank < 0 ? preferred.length : rightRank) || left.localeCompare(right, "ru");
    });
  }, [visibleMembers]);
  const activities = useMemo(() => {
    const events: TeamFeedItem[] = view.feed
      .filter((event) => activityFilter !== "all" || !event.id.startsWith("action:"))
      .filter((event) => activityFilter === "all" || (activityFilter !== "reports" && event.source === activityFilter))
      .map((event) => ({ kind: "event", event }));
    const reports: TeamFeedItem[] = activityFilter === "reports" || activityFilter === "all"
      ? view.members.flatMap((member) => {
        const displayMember = displayMembers.find((candidate) => candidate.id === member.id) ?? member;
        return (member.actionReports ?? []).map((report) => ({ kind: "report" as const, report, member: displayMember }));
      })
      : [];
    return [...events, ...reports].sort((left, right) => {
      const leftAt = left.kind === "event" ? left.event.at : left.report.at;
      const rightAt = right.kind === "event" ? right.event.at : right.report.at;
      return new Date(rightAt).getTime() - new Date(leftAt).getTime();
    });
  }, [displayMembers, view.feed, view.members, activityFilter]);
  const departmentGroups = (selectedDepartment ? [selectedDepartment] : departments)
    .map((department) => ({ department, members: visibleMembers.filter((member) => member.department === department) }))
    .filter((group) => group.members.length > 0);

  const selectMember = (id: string) => {
    setSelectedId(id);
  };
  const closeProfile = useCallback(() => setSelectedId(null), []);

  return (
    <div className="team-page team-content-root">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#87958d]">
        <span>Владелец</span><span aria-hidden="true">/</span><span className="text-[#247761]">Команда</span>
      </div>
      <section className="team-hero mt-5 overflow-hidden rounded-[26px] px-5 py-7 sm:px-9 sm:py-10">
        <div className="team-orbit" aria-hidden="true"><span /><span /><span /></div>
        <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_350px] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d1e0d7]/80 bg-[#edf4ed]/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#3c6a56]">
              <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" /> Личное пространство владельца
            </div>
            <h1 className="mt-5 max-w-3xl font-[var(--font-display)] text-[clamp(2.6rem,7vw,5.7rem)] font-medium leading-[.94] tracking-[-0.075em] text-[#203e33]">Люди и роли<br className="hidden sm:block" /> TalkHint.</h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#62756b] sm:text-base">
              Живая карта команды: кто исполняет роль, чем занимается и что действительно произошло. Описанный профиль не означает, что роль уже подключена.
            </p>
          </div>
          <div className="rounded-2xl border border-[#d6e1d8] bg-[#f6f8f2]/85 p-4 backdrop-blur-sm sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative grid h-12 w-12 place-items-center rounded-[15px] bg-[#285642] font-display text-sm font-semibold text-[#f0f2e8]">{initials(view.owner.name)}<span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-[3px] border-[#f6f8f2] bg-[#70a479]" /></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#86958a]">Владелец · верхний уровень</p><p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-[#294b3c]">{missing(view.owner.name)}</p></div>
              </div>
              <span className="rounded-md bg-[#e8efe7] px-2 py-1 font-mono text-[10px] text-[#54705f]">{missing(view.owner.code)}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniStat label="Профили" value={String(view.members.length)} />
              <MiniStat label="Шаги пакета" value={`${view.apply.completed}/${view.apply.total}`} />
            </div>
            <button type="button" onClick={onRefresh} disabled={!onRefresh || refreshing || applying || partnersApplying} className="team-refresh mt-3 w-full">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /> Обновить данные
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,.8fr)]">
        <div className="team-panel min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e4eae3] px-5 py-5 sm:px-7">
            <div>
              <p className="team-eyebrow"><Network className="h-3.5 w-3.5" aria-hidden="true" /> Карта команды</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.055em] text-[#294437]">От владельца — к исполнению</h2>
            </div>
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-[#718077]">Отдел
                <span className="relative min-w-0">
                  <select aria-label="Фильтр по отделу" value={selectedDepartment ?? ""} onChange={(event) => setSelectedDepartment(event.target.value || null)} className="team-select max-w-full">
                    <option value="">Все отделы</option>
                    {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f8276]" aria-hidden="true" />
                </span>
              </label>
              <button type="button" aria-pressed={showAllRoles} onClick={() => setShowAllRoles((value) => !value)} className="team-filter-toggle">
                {showAllRoles ? "Только команда владельца" : `Все роли модели · ${view.members.length}`}
              </button>
            </div>
          </div>
          <div className="px-5 py-5 sm:px-7">
            <div className="mx-auto mb-5 flex max-w-sm items-center justify-center gap-3 rounded-xl border border-[#dce8dd] bg-[#f5f8f2] px-4 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[#dceadd] text-[#41664e]"><Users className="h-4 w-4" aria-hidden="true" /></div>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#849286]">Команда TalkHint</p><p className="text-sm font-semibold text-[#3b5a45]">Под руководством {missing(view.owner.name)}</p></div>
            </div>
            {departmentGroups.length ? (
              <div className="space-y-6">
                {departmentGroups.map((group) => <section key={group.department} aria-label={`Отдел ${group.department}`}>
                  <div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-[#e7ece4]" /><h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#859287]">{missing(group.department)}</h3><span className="h-px flex-1 bg-[#e7ece4]" /></div>
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {group.members.map((member, index) => <MemberCard key={member.id} member={member} selected={member.id === selectedId} index={index} onSelect={() => selectMember(member.id)} />)}
                  </div>
                </section>)}
              </div>
            ) : (
              <EmptyState icon={<BriefcaseBusiness className="h-5 w-5" />} title="В этом отделе пока нет профилей" detail="Выберите другой отдел, чтобы посмотреть состав." />
            )}
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-[#f7f8f2] px-3 py-2.5 text-[11px] leading-5 text-[#819087]"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8b9d8d]" aria-hidden="true" /> Карточка отражает поля источника. Статус роли не выводится из имени или наличия описания.</p>
          </div>
        </div>

        <section className="team-panel" aria-labelledby="activity-heading">
          <div className="border-b border-[#e4eae3] px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="team-eyebrow"><Activity className="h-3.5 w-3.5" aria-hidden="true" /> Журнал фактов</p><h2 id="activity-heading" className="mt-2 text-2xl font-semibold tracking-[-0.055em] text-[#294437]">Что происходит</h2></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf1e8] text-[#4e7156]"><Clock3 className="h-4 w-4" aria-hidden="true" /></span>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-[#748278]">Источник
              <span className="relative flex-1">
                <select aria-label="Фильтр активности по источнику" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)} className="team-select w-full">
                  <option value="all">Все записи</option><option value="reports">Рапорты действий</option><option value="journal">Журнал</option><option value="call_lab">Лаборатория звонков</option><option value="oncall">Дежурство</option>
                </select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f8276]" aria-hidden="true" />
              </span>
            </label>
          </div>
          <div className="max-h-[690px] overflow-y-auto px-5 py-2 sm:px-6">
            {activities.length ? <ol className="divide-y divide-[#edf0e9]">
              {activities.map((item) => item.kind === "event"
                ? <ActivityRow key={`event-${item.event.id}`} event={item.event} members={displayMembers} onSelect={selectMember} />
                : <ReportActivityRow key={`report-${item.report.id}`} report={item.report} member={item.member} onSelect={selectMember} />)}
            </ol> : <EmptyState icon={<Activity className="h-5 w-5" />} title="Записей нет" detail="В выбранном источнике сейчас нет событий или рапортов." />}
          </div>
        </section>
      </section>

      {plans.length > 0 && <section className="team-panel mt-6 overflow-hidden" aria-labelledby="plans-heading">
        <div className="border-b border-[#e4eae3] px-5 py-5 sm:px-7">
          <p className="team-eyebrow"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Будущее команды</p>
          <h2 id="plans-heading" className="mt-2 text-2xl font-semibold tracking-[-0.055em] text-[#294437]">Планы</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#7d8b81]">
            Будущая лаборатория секретаря ещё не создана. Здесь показаны планы, а не вымышленные сотрудники.
          </p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
          {plans.map((member, index) => <MemberCard
            key={member.id}
            member={member}
            selected={member.id === selectedId}
            index={index}
            onSelect={() => selectMember(member.id)}
            showPortrait={false}
            fullName
          />)}
        </div>
      </section>}

      {externalMembers.length > 0 && <section className="team-panel mt-6 overflow-hidden" aria-labelledby="external-team-heading">
        <div className="border-b border-[#e4eae3] px-5 py-5 sm:px-7">
          <p className="team-eyebrow"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Вне иерархии</p>
          <h2 id="external-team-heading" className="mt-2 text-2xl font-semibold tracking-[-0.055em] text-[#294437]">Рядом с командой</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#7d8b81]">Внешние участники работают напрямую с владельцем. Это отдельные карточки, не должности в оргструктуре.</p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
          {externalMembers.map((member, index) => <MemberCard key={member.id} member={member} selected={member.id === selectedId} index={index} onSelect={() => selectMember(member.id)} />)}
        </div>
      </section>}

      <ApplyPanel view={view} applying={Boolean(applying)} progress={progress ?? null} applyError={applyError ?? ""} applyNotice={applyNotice ?? ""} blocked={Boolean(applyBlocked)} onApply={partnersApplying ? undefined : onApply} />
      {view.partners && <PartnersApplyPanel
        partners={view.partners}
        csrfAvailable={Boolean(view.apply.csrfToken)}
        applying={partnersApplying}
        blocked={Boolean(partnersApplyBlocked)}
        applyError={partnersApplyError}
        applyNotice={partnersApplyNotice}
        onConfirm={() => setConfirmPartners(true)}
        actionAvailable={Boolean(onPartnersApply)}
        firstPackageApplying={Boolean(applying)}
      />}
      {confirmPartners && view.partners && <PartnersConfirmationModal
        partners={view.partners}
        applying={partnersApplying}
        canApply={Boolean(onPartnersApply && view.partners.available && !view.partners.completed && view.partners.pin && view.apply.csrfToken && !partnersApplyBlocked && !applying)}
        onCancel={() => setConfirmPartners(false)}
        onConfirm={() => { setConfirmPartners(false); onPartnersApply?.(); }}
      />}

      <footer className="mt-7 flex flex-col gap-2 border-t border-[#dce4dc] pt-4 text-[11px] text-[#829087] sm:flex-row sm:items-center sm:justify-between">
        <span>Только владелец · состояние получено с сервера</span>
        <span className="font-mono">Источник: {view.source.environment} · {view.source.workspace} · r{view.source.revision}</span>
      </footer>
      {selected && <ProfileDrawer member={selected} members={displayMembers} onSelect={selectMember} onClose={closeProfile} />}
    </div>
  );
}

function TeamHeader() {
  return (
    <header className="mx-auto flex min-h-[66px] max-w-[1320px] items-center justify-between border-b border-[#d9e2d9]">
      <a href="/admin" className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-wide text-[#315342] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#41856b]">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#2b5942] font-display text-[10px] font-bold text-[#eff2e8]">TH</span>
        TalkHint <span className="hidden font-normal text-[#7d8b81] sm:inline">администрирование</span>
      </a>
      <a href="/admin" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-[#607269] transition-colors hover:bg-[#e8eee7] hover:text-[#2d5842] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#41856b]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /><span>В админ-панель</span>
      </a>
    </header>
  );
}

function MemberCard({ member, selected, index, onSelect, showPortrait = true, fullName = false }: {
  member: TeamMember;
  selected: boolean;
  index: number;
  onSelect: () => void;
  showPortrait?: boolean;
  fullName?: boolean;
}) {
  const colorClass = member.color === "indigo" ? "team-member-indigo" : member.color === "orange" ? "team-member-orange" : "";
  const isExternal = member.kind === "external" || member.status === "owner_chat" || member.status === "contractor";
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`team-member-card text-left ${colorClass} ${selected ? "team-member-selected" : ""}`} style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}>
      <div className="flex items-start gap-3">
        {showPortrait && <Portrait member={member} size="large" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className={`${fullName ? "break-words" : "truncate"} text-[17px] font-semibold tracking-[-0.045em] text-[#2b4538]`}>{missing(member.name)}</h3>
            <span className="min-w-0 max-w-full break-all font-mono text-[9px] text-[#9aa398]">{missing(member.code)} · {member.id}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#77867b]">{missing(member.title)}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#9bad9d] transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={member.status} />
        <span className="rounded-full bg-[#f2f4ee] px-2.5 py-1 text-[10px] font-medium text-[#77857b]">{missing(member.department)}</span>
      </div>
      <p className="mt-3 line-clamp-2 min-h-9 text-xs leading-[1.55] text-[#738178]">{missing(member.statusEvidence)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-[#edf0e9] pt-3 text-[10px] text-[#87938a]">
        <span>{member.duties.length} обязанностей</span><span>{isExternal ? "Вне иерархии" : `Роль: ${missing(member.mode)}`}</span>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[#8b968c]">Последнее действие: {member.lastActionAt ? dateLabel(member.lastActionAt) : "Не заполнено"}</p>
    </button>
  );
}

function Profile({ member, members, onSelect }: { member: TeamMember; members: TeamMember[]; onSelect: (id: string) => void }) {
  const [promptVisible, setPromptVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "hats">("overview");
  const nameAccepted = member.nameStatus?.toLowerCase() === "accepted";
  return (
    <div className="p-5 sm:p-7">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(275px,.8fr)]">
        <div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Portrait member={member} size="hero" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#829087]">{missing(member.department)} · {missing(member.code)} · ID {member.id}</p>
              <span className="rounded-full border border-[#dbe8dd] bg-[#f0f6ee] px-2 py-0.5 text-[10px] font-semibold text-[#52755b]">Имя: {missing(member.nameStatus)}</span>
              </div>
              <h3 id="team-profile-title" className="mt-2 break-words font-display text-3xl font-medium tracking-[-0.06em] text-[#284536] sm:text-4xl">{missing(member.name)}</h3>
              <p className="mt-1 text-sm text-[#75847a]">{missing(member.title)}</p>
              {nameAccepted && <p className="mt-2 text-[11px] leading-5 text-[#88948b]">Статус имени «принято» подтверждает только имя профиля — это не означает активацию промпта.</p>}
            </div>
          </div>
          <div className="mt-6 rounded-2xl border border-[#dce8dd] bg-[#f5f8f2] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusBadge status={member.status} /><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#879489]">Исполнение: {missing(member.mode)}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#556a5e]">{missing(member.statusEvidence)}</p>
          </div>

          <div className="mt-5 flex gap-2 border-b border-[#e2e9df]" role="tablist" aria-label="Разделы профиля">
            <button type="button" role="tab" aria-selected={activeTab === "overview"} onClick={() => setActiveTab("overview")} className="team-profile-tab">Обзор</button>
            <button type="button" role="tab" aria-selected={activeTab === "hats"} onClick={() => setActiveTab("hats")} className="team-profile-tab">Шляпы</button>
          </div>

          {activeTab === "hats" ? <HatsTab member={member} /> : <>
          <div className="mt-6 grid gap-x-7 gap-y-6 sm:grid-cols-2">
            <Field label="Характерные черты"><TraitList values={member.traits} /></Field>
            <Field label="Девиз"><p className="text-sm leading-6 text-[#52685b]">{missing(member.motto)}</p></Field>
            <Field label="План"><p className="text-sm leading-6 text-[#52685b]">{missing(member.metrics.plan)}</p></Field>
            <Field label="Факт"><p className="text-sm leading-6 text-[#52685b]">{missing(member.metrics.fact)}</p></Field>
            <Field label="Модель"><p className="text-sm leading-6 text-[#52685b]">{missing(member.model)}</p></Field>
            <Field label="Последнее действие">
              <p className="text-sm leading-6 text-[#52685b]">{member.lastActionAt ? dateLabel(member.lastActionAt) : "Не заполнено"}</p>
              <p className="mt-1 text-[10px] leading-4 text-[#89958b]">Дата не оценивает качество или результат работы.</p>
            </Field>
            <Field label="Источник исполнения"><p className="text-sm leading-6 text-[#52685b]">{missing(member.runtimeSource)}</p></Field>
          </div>
          </>}
        </div>

        <aside className={activeTab === "hats" ? "hidden" : "space-y-5"}>
          <div className="rounded-2xl border border-[#e1e8df] bg-[#fafbf7] p-4 sm:p-5">
            <h4 className="team-eyebrow"><BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" /> Обязанности</h4>
            {member.duties.length ? <ol className="mt-4 space-y-3">
              {member.duties.map((duty, index) => <li key={duty.id} className="flex gap-3 border-b border-[#edf0e9] pb-3 last:border-0 last:pb-0">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#e9f0e8] font-mono text-[9px] text-[#6e8872]">{String(index + 1).padStart(2, "0")}</span>
                <div><p className="text-sm font-semibold text-[#405d4b]">{missing(duty.title)}</p><p className="mt-1 text-xs leading-5 text-[#819087]">{missing(duty.detail)}</p><p className="mt-1 font-mono text-[9px] text-[#9aa398]">ID {duty.id}</p></div>
              </li>)}
            </ol> : <p className="mt-3 text-sm text-[#879389]">Не заполнено</p>}
          </div>
          <div className="rounded-2xl border border-[#e1e8df] bg-[#fafbf7] p-4 sm:p-5">
            <h4 className="team-eyebrow"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Связи</h4>
            {member.relations.length ? <ul className="mt-3 space-y-2">
              {member.relations.map((relation, index) => {
                const linked = members.find((item) => item.id === relation.id);
                return <li key={`${relation.id}-${index}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs text-[#819087]">{missing(relation.kind)} · <span className="font-mono text-[9px]">{relation.id}</span></span>
                  {linked ? <button type="button" onClick={() => onSelect(linked.id)} className="truncate text-right text-xs font-semibold text-[#3c6f56] underline decoration-[#b8cfbb] underline-offset-4 hover:text-[#245c42]">{relation.name}</button> : <span className="text-xs text-[#75847a]">{relation.name || "Не заполнено"}</span>}
                </li>;
              })}
            </ul> : <p className="mt-3 text-sm text-[#879389]">Не заполнено</p>}
          </div>
          <FieldPanel label="Инструменты" values={member.tools} />
          <FieldPanel label="Запреты" values={member.prohibitions} />
        </aside>
      </div>

      <div className={`mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] ${activeTab === "hats" ? "hidden" : ""}`}>
        <section className="rounded-2xl border border-[#e1e8df] bg-[#fafbf7] p-4 sm:p-5" aria-labelledby="prompt-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h4 id="prompt-heading" className="team-eyebrow"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Промпт</h4>
              <p className="mt-2 text-[11px] leading-5 text-[#89958b]">Принятое имя не является подтверждением включённого промпта.</p></div>
            <button type="button" onClick={() => setPromptVisible((visible) => !visible)} className="team-button-secondary !min-h-9 !px-3 !text-xs" aria-expanded={promptVisible} disabled={!member.prompt.text}>
              {promptVisible ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}{promptVisible ? "Скрыть промпт" : "Показать промпт"}
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Meta label="Версия" value={member.prompt.version} /><Meta label="Статус в источнике" value={member.prompt.status} /><Meta label="Принят" value={member.prompt.acceptedBy} />
          </div>
          <div className={`mt-3 rounded-xl border border-[#e5eae2] bg-[#f2f5ef] p-4 text-xs leading-6 text-[#53675b] ${promptVisible ? "whitespace-pre-wrap" : "line-clamp-3"}`}>
            {member.prompt.text ? (promptVisible ? member.prompt.text : "Текст промпта скрыт. Нажмите «Показать промпт», чтобы раскрыть.") : "Не заполнено"}
          </div>
        </section>
        <section className="rounded-2xl border border-[#e1e8df] bg-[#fafbf7] p-4 sm:p-5">
          <h4 className="team-eyebrow"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Уроки и история</h4>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#89968b]">Уроки</p>{member.lessons.length ? <ul className="mt-2 space-y-2">{member.lessons.map((lesson, i) => <li key={`${lesson}-${i}`} className="flex gap-2 text-xs leading-5 text-[#65786c]"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6d9572]" aria-hidden="true" />{lesson}</li>)}</ul> : <p className="mt-2 text-xs text-[#879389]">Не заполнено</p>}</div>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#89968b]">История профиля</p>{member.history.length ? <ol className="mt-2 space-y-2">{member.history.map((entry, i) => <li key={`${entry.at}-${i}`} className="border-l border-[#dbe5d9] pl-3"><p className="text-[10px] font-medium text-[#8c988e]">{dateLabel(entry.at)}</p><p className="mt-0.5 text-xs leading-5 text-[#63776a]">{entry.text}</p></li>)}</ol> : <p className="mt-2 text-xs text-[#879389]">Не заполнено</p>}</div>
          </div>
        </section>
      </div>
      {activeTab === "overview" && <ActionReportsSection member={member} />}
    </div>
  );
}

function HatsTab({ member }: { member: TeamMember }) {
  const hats = member.hats ?? [];
  return <section className="mt-6" aria-labelledby="hats-heading">
    <div className="mb-4">
      <p className="team-eyebrow"><BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" /> Роли, закрываемые источником</p>
      <h4 id="hats-heading" className="mt-2 text-lg font-semibold tracking-[-0.04em] text-[#365341]">Шляпы</h4>
      <p className="mt-1 text-xs leading-5 text-[#819087]">Текущий статус и история отображаются только по данным источника.</p>
    </div>
    {hats.length ? <ol className="space-y-3">
      {hats.map((hat) => <li key={hat.id} className="rounded-xl border border-[#e1e8df] bg-[#fafbf7] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h5 className="text-sm font-semibold text-[#405d4b]">{missing(hat.title)}</h5><p className="mt-1 font-mono text-[9px] text-[#9aa398]">ID {hat.id}</p></div>
          <span className="rounded-full bg-[#edf2e9] px-2.5 py-1 text-[10px] font-semibold text-[#647a68]">{missing(hat.status)}</span>
        </div>
        {hat.history?.length ? <ol className="mt-3 space-y-2 border-l border-[#dbe5d9] pl-3">
          {hat.history.map((entry, index) => <li key={`${entry.at}-${index}`}>
            <p className="text-[10px] font-medium text-[#8c988e]">{dateLabel(entry.at)}</p>
            <p className="mt-0.5 text-xs leading-5 text-[#63776a]">{missing(entry.text)}</p>
          </li>)}
        </ol> : <p className="mt-3 text-xs text-[#879389]">История: Не заполнено</p>}
      </li>)}
    </ol> : <EmptyState icon={<BriefcaseBusiness className="h-5 w-5" />} title="Шляпы не указаны" detail="Источник не передал список должностей, которые закрывает эта роль." />}
  </section>;
}

function ActionReportsSection({ member }: { member: TeamMember }) {
  const reports = [...(member.actionReports ?? [])].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  return <section className="mt-6 rounded-2xl border border-[#dfe7dc] bg-[#f8faf5] p-4 sm:p-5" aria-labelledby="action-reports-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="team-eyebrow"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Рапорты действий</p>
        <h4 id="action-reports-heading" className="mt-2 text-lg font-semibold tracking-[-0.04em] text-[#365341]">Последняя работа</h4></div>
      <span className="font-mono text-[10px] text-[#89958b]">{reports.length} {reports.length === 1 ? "рапорт" : "рапортов"}</span>
    </div>
    {reports.length ? <ol className="mt-4 space-y-3">
      {reports.map((report) => <li key={report.id}><ActionReportCard report={report} /></li>)}
    </ol> : <p className="mt-3 text-sm leading-6 text-[#718177]">{missing(member.lastWork)}</p>}
  </section>;
}

function ActionReportCard({ report }: { report: TeamActionReport }) {
  const outcome: Record<TeamActionReport["outcome"], string> = {
    completed: "Выполнено",
    partial: "Частично",
    not_completed: "Не выполнено",
  };
  return <article className="rounded-xl border border-[#e2e9df] bg-[#fbfcf8] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="rounded-full bg-[#e9f0e8] px-2.5 py-1 text-[10px] font-semibold text-[#4d7055]">{outcome[report.outcome] ?? "Не заполнено"}</span>
      <time className="text-[10px] text-[#89958b]">{report.at ? dateLabel(report.at) : "Не заполнено"}</time>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <ReportField label="Что поручено" value={report.assigned} />
      <ReportField label="Роль" value={report.role} />
      <ReportListField label="Что получилось" values={report.succeeded} />
      <ReportListField label="Что не получилось" values={report.failed} />
      <ReportListField label="Что нужно от владельца" values={report.needsOwner} />
      <ReportField label="Источник" value={report.source} />
    </div>
    <p className="mt-3 border-t border-[#edf0e9] pt-2 font-mono text-[9px] text-[#9aa398]">ID рапорта: {report.id}</p>
  </article>;
}

function ReportField({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#89958b]">{label}</p><p className="mt-1 text-xs leading-5 text-[#586f61]">{missing(value)}</p></div>;
}

function ReportListField({ label, values }: { label: string; values: string[] | null | undefined }) {
  const entries = (values ?? []).filter((value) => Boolean(value?.trim()));
  return <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#89958b]">{label}</p>
    {entries.length ? <ul className="mt-1 space-y-1">{entries.map((value, index) => <li key={`${index}-${value}`} className="text-xs leading-5 text-[#586f61]">{value}</li>)}</ul> : <p className="mt-1 text-xs leading-5 text-[#586f61]">Не заполнено</p>}
  </div>;
}

function ProfileDrawer({ member, members, onSelect, onClose }: {
  member: TeamMember;
  members: TeamMember[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    closeButtonRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [member.id, onClose]);

  return (
    <div className="team-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={drawerRef} className="team-profile-drawer" role="dialog" aria-modal="true" aria-labelledby="team-profile-title" tabIndex={-1}>
        <header className="team-profile-drawer-header">
          <div className="min-w-0">
            <p className="team-eyebrow"><UserRound className="h-3.5 w-3.5" aria-hidden="true" /> Карточка участника</p>
            <p className="mt-1 break-words text-xs text-[#77867b]">{member.name} · {member.code}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="team-button-secondary h-10 w-10 shrink-0 !p-0" aria-label="Закрыть профиль">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="team-profile-drawer-content">
          <Profile member={member} members={members} onSelect={onSelect} />
        </div>
      </section>
    </div>
  );
}

function PartnersApplyPanel({
  partners, csrfAvailable, applying, blocked, applyError, applyNotice, onConfirm, actionAvailable, firstPackageApplying,
}: {
  partners: TeamPartners;
  csrfAvailable: boolean;
  applying: boolean;
  blocked: boolean;
  applyError: string;
  applyNotice: string;
  onConfirm: () => void;
  actionAvailable: boolean;
  firstPackageApplying: boolean;
}) {
  const available = partners.available && !partners.completed && Boolean(partners.pin) && csrfAvailable && !blocked;
  const disabled = !available || applying || firstPackageApplying || !actionAvailable;
  return <section className="team-panel mt-6 overflow-hidden" aria-labelledby="partners-apply-heading">
    <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
      <div>
        <p className="team-eyebrow"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Отдельный документ · одно применение</p>
        <h2 id="partners-apply-heading" className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#2a493a]">Внешние партнёры и шляпы</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687a70]">
          Отдельный уже рассмотренный документ для Клавдия, Ефима и шляп. Применяется ровно один закреплённый документ; состав команды и пакет ролей остаются отдельными.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Meta label="Рабочая область" value={partners.pin?.workspace} />
          <Meta label="Ревизия документа" value={partners.pin ? `r${partners.pin.revision}` : null} />
          <Meta label="Корневой хеш" value={partners.pin?.rootHash} mono />
          <Meta label="Хеш документа" value={partners.pin?.documentHash ?? partners.documentHash} mono />
        </div>
        <p className={`mt-3 text-xs leading-5 ${partners.completed ? "text-[#477252]" : "text-[#7b8171]"}`}>
          {partners.completed
            ? "Документ отмечен сервером как применённый."
            : blocked
              ? "Заблокировано до обновления: результат предыдущего запроса требует сверки."
              : partners.available
                ? "Доступно одно отдельное подтверждение владельца."
                : `Заблокировано: ${missing(partners.reason)}`}
        </p>
      </div>
      <div className="rounded-xl border border-[#dde7dd] bg-[#f9faf5] p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-semibold text-[#586f61]">Состояние документа</p>
            <p className="mt-1 text-[11px] leading-5 text-[#859187]">{partners.completed ? "Применение завершено" : partners.available ? "Ожидает подтверждения владельца" : missing(partners.reason)}</p></div>
          <span className="font-mono text-xs text-[#789082]">{partners.completed ? "готово" : partners.available ? `r${partners.pin?.revision ?? "—"}` : "заблокировано"}</span>
        </div>
        {applyNotice && <p className="mt-3 flex gap-2 text-xs leading-5 text-[#477252]" role="status"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{applyNotice}</p>}
        {applyError && <p className="mt-3 flex gap-2 text-xs leading-5 text-[#8d5145]" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{applyError}</p>}
        <button type="button" onClick={onConfirm} disabled={disabled} className="team-button-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-45">
          {applying ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />Применение…</> : "Применить Клавдия, Ефима и шляпы"}
        </button>
      </div>
    </div>
  </section>;
}

function PartnersConfirmationModal({
  partners, applying, canApply, onCancel, onConfirm,
}: {
  partners: TeamPartners;
  applying: boolean;
  canApply: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="team-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !applying) onCancel(); }}>
    <section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="partners-confirm-title">
      <div className="team-modal-body">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e4efe8] text-[#28634f]"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h2 id="partners-confirm-title" className="text-xl font-semibold tracking-[-0.035em] text-[#263c34]">Применить документ партнёров?</h2>
            <p className="mt-2 text-sm leading-6 text-[#687b72]">Это одно применение одного уже рассмотренного документа для Клавдия, Ефима и шляп. Не выполняется цикл и не выбирается автоматически новая ревизия.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Meta label="Рабочая область" value={partners.pin?.workspace} />
          <Meta label="Закреплённая ревизия" value={partners.pin ? `r${partners.pin.revision}` : null} />
          <Meta label="Корневой хеш" value={partners.pin?.rootHash} mono />
          <Meta label="Хеш документа" value={partners.pin?.documentHash ?? partners.documentHash} mono />
        </div>
        <div className="mt-5 rounded-xl border border-[#e0e9e2] bg-[#f3f7f3] p-4 text-sm leading-6 text-[#53685e]">
          Если закрепление не совпадает с актуальной ревизией, сервер остановит применение. При любой неоднозначной ошибке не повторяйте запрос: сначала обновите состояние и сверьте его. Это не запускает агентов и не совершает звонки.
        </div>
      </div>
      <div className="team-modal-actions mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={applying} className="team-button-secondary">Отмена</button>
        <button type="button" onClick={onConfirm} disabled={!canApply || applying} className="team-button-primary disabled:cursor-not-allowed disabled:opacity-45">
          {applying ? "Применение…" : "Подтвердить одно применение"}
        </button>
      </div>
    </section>
  </div>;
}

function ApplyPanel({ view, applying, progress, applyError, applyNotice, blocked, onApply }: { view: TeamView; applying: boolean; progress: { step: number; total: number } | null; applyError: string; applyNotice: string; blocked: boolean; onApply?: () => void }) {
  const available = view.apply.available && Boolean(view.apply.pin && view.apply.csrfToken) && !blocked;
  return (
    <section className="team-apply-panel mt-6 overflow-hidden rounded-2xl" aria-labelledby="apply-panel-heading">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        <div>
          <p className="team-eyebrow !text-[#779187]"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Закреплённое состояние</p>
          <h2 id="apply-panel-heading" className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#2a493a]">Пакет команды</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687a70]">{view.apply.reason || (available ? "Сервер разрешил последовательное применение. Каждый шаг требует отдельного одноразового разрешения." : "Сейчас нет подтверждённых шагов, доступных для применения.")}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Meta label="Среда / рабочая область" value={`${missing(view.source.environment)} / ${missing(view.source.workspace)}`} />
            <Meta label="Ревизия источника" value={`r${view.source.revision}`} />
            <Meta label="Корневой хеш" value={view.source.rootHash} mono />
            <Meta label="Фаза" value={view.source.phase} />
          </div>
          <div className="mt-3 break-all rounded-lg border border-[#e1e8df] bg-[#f4f7f1] px-3 py-2 text-[10px] leading-5 text-[#7b8a80]">
            <span className="font-semibold text-[#64796a]">Закрепление шага {view.apply.pin?.step ?? "—"} · r{view.apply.pin?.revision ?? "—"}:</span> {hashLabel(view.apply.pin?.rootHash ?? "")} · план {hashLabel(view.apply.pin?.planHash ?? "")} · область {missing(view.apply.pin?.workspace)}
          </div>
          <p className="mt-2 break-all font-mono text-[9px] leading-4 text-[#89968b]">Корневой хеш источника: {hashLabel(view.source.rootHash)}</p>
        </div>
        <div className="rounded-xl border border-[#dde7dd] bg-[#f9faf5] p-4">
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-[#586f61]">Готовность пакета</span><span className="font-mono text-xs text-[#789082]">{view.apply.completed} / {view.apply.total}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e5ebe3]" role="progressbar" aria-label="Прогресс пакета" aria-valuemin={0} aria-valuemax={Math.max(1, view.apply.total)} aria-valuenow={Math.min(view.apply.completed, view.apply.total)}>
            <div className="h-full rounded-full bg-[#65936d] transition-[width] duration-300" style={{ width: `${view.apply.total ? Math.min(100, view.apply.completed / view.apply.total * 100) : 0}%` }} />
          </div>
          {applying && progress && <p className="mt-3 text-xs font-medium text-[#587663]" aria-live="polite">Шаг {progress.step} из {progress.total || progress.step} · последовательно</p>}
          {applyNotice && <p className="mt-3 flex gap-2 text-xs leading-5 text-[#477252]" role="status"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{applyNotice}</p>}
          {applyError && <p className="mt-3 flex gap-2 text-xs leading-5 text-[#8d5145]" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{applyError}</p>}
          <button type="button" onClick={onApply} disabled={!available || applying || !onApply} className="team-button-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-45">
            {applying ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />Шаг выполняется…</> : <><ShieldCheck className="h-4 w-4" aria-hidden="true" />{available ? "Подтвердить применение" : "Нет доступных шагов"}</>}
          </button>
          {!view.apply.available && view.apply.reason && <p className="mt-3 text-center text-[10px] leading-5 text-[#8a958b]">Доступность определяется сервером.</p>}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ event, members, onSelect }: { event: TeamEvent; members: TeamMember[]; onSelect: (id: string) => void }) {
  const linked = event.role ? members.find((member) => member.id === event.role || member.name === event.role) : undefined;
  return <li className="relative py-4 pl-7 before:absolute before:left-[7px] before:top-0 before:h-full before:w-px before:bg-[#e4ebe1] first:before:top-5 last:before:h-5">
    <span className="absolute left-0 top-[21px] h-[15px] w-[15px] rounded-full border-[4px] border-[#fafbf7] bg-[#87a27e] ring-1 ring-[#d6e3d4]" />
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-md bg-[#eef3eb] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#69816b]">{eventSourceLabel[event.source]}</span><time className="text-[10px] text-[#929d93]">{dateLabel(event.at)}</time></div>
    <h3 className="mt-2 text-sm font-semibold leading-5 text-[#3b5545]">{missing(event.title)}</h3>
    <p className="mt-1 text-xs leading-5 text-[#7a887e]">{missing(event.detail)}</p>
    <div className="mt-2 text-[10px] text-[#929d93]">Роль: {event.role ? (linked ? <button type="button" onClick={() => onSelect(linked.id)} className="font-semibold text-[#4d765c] underline decoration-[#c0d4c1] underline-offset-2">{linked.name}</button> : event.role) : "Не заполнено"}</div>
    <p className="mt-1 font-mono text-[9px] text-[#a0a99f]">ID события: {event.id}</p>
  </li>;
}

function ReportActivityRow({ report, member, onSelect }: { report: TeamActionReport; member: TeamMember; onSelect: (id: string) => void }) {
  const outcome: Record<TeamActionReport["outcome"], string> = {
    completed: "Выполнено",
    partial: "Частично",
    not_completed: "Не выполнено",
  };
  return <li className="relative py-4 pl-7 before:absolute before:left-[7px] before:top-0 before:h-full before:w-px before:bg-[#e4ebe1] first:before:top-5 last:before:h-5">
    <span className="absolute left-0 top-[21px] h-[15px] w-[15px] rounded-full border-[4px] border-[#fafbf7] bg-[#7773a9] ring-1 ring-[#deddee]" />
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-md bg-[#efeff8] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#66628f]">Рапорт действия</span><time className="text-[10px] text-[#929d93]">{report.at ? dateLabel(report.at) : "Не заполнено"}</time></div>
    <h3 className="mt-2 text-sm font-semibold leading-5 text-[#3b5545]">
      <button type="button" onClick={() => onSelect(member.id)} className="text-left underline decoration-[#c0d4c1] underline-offset-2">{member.name}</button>
    </h3>
    <p className="mt-1 text-xs leading-5 text-[#7a887e]">{missing(report.assigned)}</p>
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#78877c]">
      <span>Итог: <strong className="font-semibold text-[#5a7161]">{outcome[report.outcome] ?? "Не заполнено"}</strong></span>
      <span>Роль: {missing(report.role)}</span>
      <span>Источник: {missing(report.source)}</span>
    </div>
    <div className="mt-2 grid gap-2 rounded-lg bg-[#f6f7f2] p-3 sm:grid-cols-2">
      <ReportListField label="Получилось" values={report.succeeded} />
      <ReportListField label="Не получилось" values={report.failed} />
      <ReportListField label="Нужно от владельца" values={report.needsOwner} />
    </div>
    <p className="mt-2 font-mono text-[9px] text-[#a0a99f]">ID рапорта: {report.id}</p>
  </li>;
}

function Portrait({ member, size }: { member: TeamMember; size: "large" | "hero" }) {
  const portraitSrc = member.portrait || null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const classes = size === "hero" ? "h-24 w-24 rounded-[24px] text-2xl sm:h-28 sm:w-28" : "h-14 w-14 rounded-[17px] text-sm";
  const colorClass = member.color === "indigo" ? "team-portrait-indigo" : member.color === "orange" ? "team-portrait-orange" : "";
  const showImage = !!portraitSrc && failedSrc !== portraitSrc;
  const imageLoaded = !!portraitSrc && loadedSrc === portraitSrc;
  return (
    <span
      role="img"
      aria-label={`Портрет ${member.name}; инициалы ${initials(member.name)}`}
      className={`${classes} ${colorClass} relative grid shrink-0 place-items-center overflow-hidden border border-[#dbe7d9] bg-[linear-gradient(145deg,#e5eee1,#dce8df)] font-display font-semibold tracking-[-0.06em] text-[#4d7055]`}
    >
      <span aria-hidden="true">{initials(member.name)}</span>
      {showImage && (
        <img
          key={portraitSrc}
          src={portraitSrc}
          alt=""
          onLoad={() => setLoadedSrc(portraitSrc)}
          onError={() => setFailedSrc(portraitSrc)}
          className={`${classes} absolute inset-0 border border-[#e1e8df] object-cover transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: TeamStatus }) {
  const item = statusCopy[status] ?? statusCopy.unresolved;
  const colors: Record<string, string> = {
    green: "bg-[#e8f2e7] text-[#49714d] ring-[#d6e7d5]",
    teal: "bg-[#e5f1ed] text-[#3f7569] ring-[#d2e6df]",
    amber: "bg-[#f7f0df] text-[#8a6a35] ring-[#eee2c6]",
    slate: "bg-[#edf0eb] text-[#6d7b70] ring-[#e2e7df]",
    rose: "bg-[#f7e9e5] text-[#995b4e] ring-[#eed6cf]",
    indigo: "bg-[#eeedf8] text-[#625e8b] ring-[#dddbed]",
    orange: "bg-[#fbefe3] text-[#9a6335] ring-[#f0ddc8]",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${colors[item.tone]}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{item.label}
  </span>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#e5ebe2] bg-[#fafbf6] px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#929d90]">{label}</p><p className="mt-1 font-mono text-xs font-semibold text-[#506b57]">{value}</p></div>;
}

function Meta({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return <div className="min-w-0 rounded-lg border border-[#e7ece4] bg-[#fafbf7] px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#929d90]">{label}</p><p className={`mt-1 break-words text-xs leading-5 text-[#5b7061] ${mono ? "font-mono" : ""}`}>{missing(value)}</p></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#8a978b]">{label}</p>{children}</div>;
}

function TagList({ values }: { values: (string | null)[] }) {
  const filled = values.filter((value): value is string => Boolean(value?.trim()));
  return filled.length ? <div className="flex flex-wrap gap-1.5">{filled.map((value, index) => <span key={`${value}-${index}`} className="rounded-md border border-[#e1e9df] bg-[#f4f7f1] px-2 py-1 text-[11px] text-[#647a68]">{value}</span>)}</div> : <p className="text-sm text-[#879389]">Не заполнено</p>;
}

function TraitList({ values }: { values: (string | null)[] }) {
  const slots = Array.from({ length: Math.max(3, values.length) }, (_, index) => values[index] ?? null);
  return <ol className="grid gap-1.5">
    {slots.map((trait, index) => <li key={index} className="flex items-center gap-2 rounded-md border border-[#e1e9df] bg-[#f4f7f1] px-2 py-1 text-[11px] text-[#647a68]">
      <span className="font-mono text-[9px] text-[#99a398]">{String(index + 1).padStart(2, "0")}</span>
      <span>{missing(trait)}</span>
    </li>)}
  </ol>;
}

function FieldPanel({ label, values }: { label: string; values: string[] }) {
  return <div className="rounded-2xl border border-[#e1e8df] bg-[#fafbf7] p-4 sm:p-5"><h4 className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#8a978b]">{label}</h4><TagList values={values} /></div>;
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf2e9] text-[#789078]">{icon}</span><h3 className="mt-3 text-sm font-semibold text-[#526858]">{title}</h3><p className="mt-1 max-w-xs text-xs leading-5 text-[#879389]">{detail}</p></div>;
}

function TeamSkeleton() {
  return <div className="animate-pulse space-y-6" aria-label="Загрузка состава команды" aria-busy="true">
    <div className="h-7 w-32 rounded bg-[#e2eae0]" />
    <div className="h-64 rounded-[26px] bg-[#e8eee6]" />
    <div className="grid gap-6 xl:grid-cols-[1.65fr_.8fr]"><div className="h-[500px] rounded-2xl bg-[#e8eee6]" /><div className="h-[500px] rounded-2xl bg-[#e8eee6]" /></div>
  </div>;
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section className="mx-auto max-w-lg rounded-2xl border border-[#e5c9bf] bg-[#fff5f0] p-6" role="alert">
    <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#9a584c]" aria-hidden="true" /><div><h1 className="font-semibold text-[#7d483f]">Не удалось загрузить команду</h1><p className="mt-2 break-words text-sm leading-6 text-[#8c655b]">{error}</p><p className="mt-3 text-xs leading-5 text-[#98766c]">Эта страница доступна только владельцу. Проверьте вход и попробуйте обновить состояние.</p></div></div>
    <button type="button" onClick={onRetry} className="team-button-primary mt-5"><RefreshCw className="h-4 w-4" aria-hidden="true" />Повторить загрузку</button>
  </section>;
}

