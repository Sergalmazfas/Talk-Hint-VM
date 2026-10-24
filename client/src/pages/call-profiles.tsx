import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  UserRound,
  Trash2,
  Pencil,
  Phone,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Scope = "personal" | "work" | "shared";
type CardType = "project" | "company";

interface ProfileNumber {
  id: string;
  phoneNumber: string;
  name: string;
  type: string;
}

interface CallProfile {
  id: "personal" | "work";
  label: string;
  numbers: ProfileNumber[];
  secretaryOutboundReady: boolean;
}

interface CallProfilesResponse {
  profiles: CallProfile[];
  onboarding?: { choices: Array<"frames" | "work" | "both">; subscribed: boolean; availableCount: number };
  recommendedWorkNumber?: { id: string; phoneNumber: string; available: boolean; existingBindingMove?: boolean } | null;
}

interface KnowledgeCard {
  id: string;
  cardType: CardType;
  title: string;
  body: string;
  profileScope: Scope;
}

interface CardDraft {
  cardType: CardType;
  title: string;
  body: string;
}

const scopeTitles: Record<Scope, string> = {
  personal: "Фреймы",
  work: "Работа",
  shared: "Общее",
};

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export default function CallProfiles() {
  const [, setLocation] = useLocation();
  const { user, token, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const previewMode = typeof window !== "undefined" && import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";
  const [profiles, setProfiles] = useState<CallProfile[]>([]);
  const [onboarding, setOnboarding] = useState<CallProfilesResponse["onboarding"]>({ choices: ["frames", "work", "both"], subscribed: false, availableCount: 0 });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [scope, setScope] = useState<Scope>(() => {
    if (typeof window === "undefined") return "personal";
    const requested = new URLSearchParams(window.location.search).get("profile");
    return requested === "work" ? "work" : "personal";
  });
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState("");
  const [cardsScope, setCardsScope] = useState<Scope | null>(null);
  const [cardsToken, setCardsToken] = useState<string | null>(null);
  const cardsRequestId = useRef(0);
  const cardsAbortController = useRef<AbortController | null>(null);
  const currentScope = useRef(scope);
  const currentToken = useRef(token);
  currentScope.current = scope;
  currentToken.current = token;
  const [attaching, setAttaching] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<"frames" | "work" | "both">("both");
  const [previewScenario, setPreviewScenario] = useState<"ready" | "empty" | "retry">("ready");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<KnowledgeCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>({ cardType: "project", title: "", body: "" });
  const [savingCard, setSavingCard] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!previewMode && !authLoading && !user) setLocation("/");
  }, [previewMode, authLoading, user, setLocation]);

  const loadProfiles = useCallback(async () => {
    if (previewMode) {
      setProfileError("");
      setProfileLoading(false);
      const fixtureProfiles: CallProfile[] = [
        { id: "personal", label: "Фреймы", numbers: [], secretaryOutboundReady: false },
        { id: "work", label: "Работа", numbers: [], secretaryOutboundReady: false },
      ];
      setProfiles(fixtureProfiles);
      setOnboarding({ choices: ["frames", "work", "both"], subscribed: true, availableCount: previewScenario === "empty" ? 0 : 6 });
      return;
    }
    if (!token) return;
    setProfileError("");
    setProfileLoading(true);
    try {
      const response = await fetch("/api/call-profiles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось загрузить профили."));
      const data = (await response.json()) as CallProfilesResponse;
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setOnboarding(data.onboarding || { choices: ["frames", "work", "both"], subscribed: false, availableCount: 0 });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.");
    } finally {
      setProfileLoading(false);
    }
  }, [previewMode, previewScenario, token]);

  const loadCards = useCallback(async (requestedScope: Scope, authToken = token) => {
    if (previewMode) {
      setCardsError("");
      setCardsLoading(false);
      setCardsScope(requestedScope);
      setCardsToken("synthetic-preview");
      setCards([]);
      return;
    }
    cardsAbortController.current?.abort();
    const requestId = ++cardsRequestId.current;
    if (!authToken) {
      setCards([]);
      setCardsError("");
      setCardsLoading(false);
      setCardsScope(null);
      setCardsToken(null);
      return;
    }
    const controller = new AbortController();
    cardsAbortController.current = controller;
    setCards([]);
    setCardsError("");
    setCardsLoading(true);
    setCardsScope(requestedScope);
    setCardsToken(authToken);
    try {
      const response = await fetch(`/api/cards?profile=${requestedScope}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось загрузить карточки."));
      const data = await response.json();
      if (
        requestId !== cardsRequestId.current ||
        currentScope.current !== requestedScope ||
        currentToken.current !== authToken
      ) return;
      setCards(Array.isArray(data.cards) ? data.cards : []);
    } catch (error) {
      if (controller.signal.aborted || requestId !== cardsRequestId.current) return;
      if (currentScope.current !== requestedScope || currentToken.current !== authToken) return;
      setCardsError(error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.");
    } finally {
      if (
        requestId === cardsRequestId.current &&
        currentScope.current === requestedScope &&
        currentToken.current === authToken
      ) {
        setCardsLoading(false);
        if (cardsAbortController.current === controller) cardsAbortController.current = null;
      }
    }
  }, [previewMode, token]);

  useEffect(() => {
    if (previewMode) void loadProfiles();
    else if (token && user) void loadProfiles();
  }, [token, user, loadProfiles, previewMode]);

  useEffect(() => {
    if (previewMode) {
      setCards([]);
      setCardsError("");
      setCardsLoading(false);
      setCardsScope(scope);
      setCardsToken("synthetic-preview");
      return;
    }
    if (token && user) {
      void loadCards(scope, token);
    } else {
      cardsAbortController.current?.abort();
      cardsRequestId.current += 1;
      cardsAbortController.current = null;
      setCards([]);
      setCardsError("");
      setCardsLoading(false);
      setCardsScope(null);
      setCardsToken(null);
    }
    return () => {
      cardsAbortController.current?.abort();
      cardsRequestId.current += 1;
      cardsAbortController.current = null;
    };
  }, [token, user, scope, loadCards, previewMode]);

  async function connectChoice(choice: "frames" | "work" | "both") {
    if (previewMode) {
      if (previewScenario === "retry") {
        setProfileError("Синтетическая ошибка соединения. Никакие данные не изменены; попробуйте ещё раз.");
        return;
      }
      setProfiles((previous) => previous.map((profile) => {
        if ((choice === "frames" && profile.id !== "personal") || (choice === "work" && profile.id !== "work")) return profile;
        if (profile.numbers.length) return profile;
        const syntheticNumber: ProfileNumber = profile.id === "personal"
          ? { id: "preview-personal", phoneNumber: "+1 202 555 0146", name: "Личная линия · пример", type: "personal" }
          : { id: "preview-work", phoneNumber: "+1 202 555 0182", name: "Рабочая линия · пример", type: "work" };
        return { ...profile, numbers: [syntheticNumber] };
      }));
      if (choice === "work") {
        setScope("work");
        setLocation("/settings/call-profiles?preview=1&profile=work");
      } else if (choice === "frames") {
        setScope("personal");
        setLocation("/settings/call-profiles?preview=1&profile=personal");
      } else {
        setScope("personal");
        setLocation("/settings/call-profiles?preview=1&profile=both");
      }
      return;
    }
    if (!token) return;
    setAttaching(true);
    setProfileError("");
    try {
      const response = await fetch("/api/call-profiles/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ choice }),
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось настроить профили."));
      const result = await response.json() as { phoneNumbers?: ProfileNumber[]; reused?: boolean };
      await loadProfiles();
      toast({ title: result.reused ? "Настройка уже выполнена" : "Профили настроены", description: "Существующие номера сохранены, новые назначения готовы." });
      if (choice === "work") {
        setScope("work");
        setLocation("/settings/call-profiles?profile=work");
      } else if (choice === "frames") {
        setScope("personal");
        setLocation("/settings/call-profiles?profile=personal");
      } else {
        setScope("personal");
        setLocation("/settings/call-profiles?profile=both");
      }
    } catch (error) {
      // A transport error may arrive after the atomic connect committed. Recover by
      // reading current state; never automatically repeat the assignment POST.
      await loadProfiles();
      toast({
        title: "Не удалось подтвердить настройку",
        description: `${error instanceof Error ? error.message : "Ошибка сети."} Состояние профилей обновлено; проверьте его перед повторной попыткой.`,
        variant: "destructive",
      });
    } finally {
      setAttaching(false);
    }
  }

  function openCreate() {
    setEditingCard(null);
    setDraft({ cardType: "project", title: "", body: "" });
    setEditorOpen(true);
  }

  function openEdit(card: KnowledgeCard) {
    setEditingCard(card);
    setDraft({ cardType: card.cardType, title: card.title, body: card.body });
    setEditorOpen(true);
  }

  async function saveCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.body.trim()) return;
    if (previewMode) {
      const localCard: KnowledgeCard = {
        id: editingCard?.id || `synthetic-card-${Date.now()}`,
        cardType: draft.cardType,
        title: draft.title.trim(),
        body: draft.body.trim(),
        profileScope: scope,
      };
      setCards((previous) => editingCard ? previous.map((card) => card.id === editingCard.id ? localCard : card) : [localCard, ...previous]);
      setEditorOpen(false);
      return;
    }
    const operationScope = scope;
    const operationToken = token;
    setSavingCard(true);
    try {
      const response = await fetch(editingCard ? `/api/cards/${encodeURIComponent(editingCard.id)}` : "/api/cards", {
        method: editingCard ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${operationToken}` },
        body: JSON.stringify(editingCard
          ? { cardType: draft.cardType, title: draft.title.trim(), body: draft.body.trim(), profileScope: operationScope }
          : { ...draft, title: draft.title.trim(), body: draft.body.trim(), profileScope: operationScope }),
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось сохранить карточку."));
      setEditorOpen(false);
      toast({ title: editingCard ? "Карточка обновлена" : "Карточка добавлена" });
      if (currentScope.current === operationScope && currentToken.current === operationToken) {
        await loadCards(operationScope, operationToken);
      }
    } catch (error) {
      toast({
        title: "Не удалось сохранить",
        description: error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.",
        variant: "destructive",
      });
    } finally {
      setSavingCard(false);
    }
  }

  async function deleteCard(card: KnowledgeCard) {
    if (!window.confirm(`Удалить карточку «${card.title}»? Это действие нельзя отменить.`)) return;
    if (previewMode) {
      setCards((previous) => previous.filter((item) => item.id !== card.id));
      return;
    }
    const operationScope = scope;
    const operationToken = token;
    setDeletingId(card.id);
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${operationToken}` },
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось удалить карточку."));
      toast({ title: "Карточка удалена" });
      if (currentScope.current === operationScope && currentToken.current === operationToken) {
        await loadCards(operationScope, operationToken);
      }
    } catch (error) {
      toast({
        title: "Не удалось удалить карточку",
        description: error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  const profileFor = (id: "personal" | "work") => profiles.find((profile) => profile.id === id);
  const personal = profileFor("personal");
  const work = profileFor("work");
  const workHasNumber = Boolean(work?.numbers.length);
  const personalHasNumber = Boolean(personal?.numbers.length);
  const missingLineCount = selectedChoice === "frames"
    ? Number(!personalHasNumber)
    : selectedChoice === "work"
      ? Number(!workHasNumber)
      : Number(!personalHasNumber) + Number(!workHasNumber);
  const cardsViewLoading = !previewMode && (cardsLoading || cardsScope !== scope || cardsToken !== token);

  if (!previewMode && (authLoading || (!user && !profileError))) {
    return <div className="min-h-[100dvh] flex items-center justify-center bg-gray-900"><Loader2 className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <Button variant="ghost" size="icon" aria-label="Назад" onClick={() => setLocation("/dashboard")} className="text-gray-300 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-cyan-400">TalkHint · Настройки</p>
            <h1 className="text-lg font-semibold sm:text-xl">Профили звонков</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:py-9">
        <section className="grid gap-5 border-b border-gray-700 pb-7 md:grid-cols-[1.2fr_0.8fr] md:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-800 bg-cyan-950/50 px-3 py-1 text-xs font-medium text-cyan-200"><ShieldCheck className="h-3.5 w-3.5" />Один Secretary · ваш контекст</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Кому звонят — определяет, что он знает.</h2>
            <p className="mt-3 text-sm leading-6 text-gray-300 sm:text-base">Выберите назначение ваших линий. Существующие номера сохраняются; TalkHint разделит личные фреймы и рабочие сведения, не создавая вторую бизнес-анкету.</p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/incoming-secretary")} className="w-fit border-cyan-800 text-cyan-200 hover:bg-cyan-950/40">
            Настройки входящего Secretary
          </Button>
        </section>

        {previewMode && (
          <section className="rounded-2xl border border-amber-700/70 bg-amber-950/30 p-4 sm:p-5" aria-label="Синтетический предпросмотр">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-amber-300">Dev preview · только локально</p><p className="mt-1 text-sm leading-5 text-amber-100">Синтетические линии и карточки. Здесь нет запросов, назначений, сохранения или действий с аккаунтом.</p></div>
              <div className="flex flex-wrap gap-2">
                {(["ready", "empty", "retry"] as const).map((scenario) => (
                  <Button key={scenario} size="sm" variant="outline" onClick={() => { setPreviewScenario(scenario); setProfileError(""); }} className={`border-amber-700 ${previewScenario === scenario ? "bg-amber-900/70 text-amber-50" : "text-amber-200"}`}>
                    {scenario === "ready" ? "Есть линии" : scenario === "empty" ? "Пустой пул" : "Ошибка / повтор"}
                  </Button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section aria-label="Профили">
          {profileLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-gray-700 bg-gray-800/60" />)}
            </div>
          ) : profileError && !previewMode ? (
            <Card className="border-red-900/70 bg-gray-800/60">
              <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" />{profileError}</p>
                <Button variant="outline" onClick={() => void loadProfiles()}>Повторить</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                {[{ id: "personal" as const, icon: UserRound, title: "Личное · фреймы", description: "Для частных звонков и личных целей. Ваши персональные фреймы остаются отдельно." }, { id: "work" as const, icon: BriefcaseBusiness, title: "Работа", description: "Для клиентов и деловых звонков. Сведения Secretary берёт из выбранных рабочих карточек." }].map(({ id, icon: Icon, title, description }) => {
                  const profile = id === "personal" ? personal : work;
                  const isPersonal = id === "personal";
                  return <Card key={id} className={`${isPersonal ? "border-cyan-800/60" : "border-teal-800/60"} bg-gray-800/60`}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-lg"><Icon className={`h-5 w-5 ${isPersonal ? "text-cyan-300" : "text-teal-300"}`} />{title}</CardTitle>
                        <Badge variant="outline" className={isPersonal ? "border-cyan-800 text-cyan-200" : "border-teal-800 text-teal-200"}>{profile?.numbers.length ? "Назначено" : "Ожидает настройки"}</Badge>
                      </div>
                      <CardDescription className="text-gray-400">{description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {profile?.numbers.length ? profile.numbers.map((number) => <div key={number.id} className="rounded-lg border border-gray-700 bg-gray-900/60 p-3"><p className="font-mono text-lg text-cyan-100">{number.phoneNumber}</p><p className="mt-1 text-sm text-gray-400">{number.name}</p></div>) : <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-400">Линия появится здесь после настройки.</p>}
                    </CardContent>
                  </Card>;
                })}
              </div>
              <Card className="overflow-hidden border-cyan-800/60 bg-gray-800/70">
                <CardHeader className="border-b border-gray-700 bg-gray-900/40">
                  <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Выберите назначение</p>
                  <CardTitle className="text-xl">Одна настройка. Три возможных пути.</CardTitle>
                  <CardDescription className="text-gray-400">Доступно линий в вашем пуле: {onboarding?.availableCount ?? 0}. Выбор сохраняет уже назначенные номера и добавляет только недостающие назначения.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-6">
                  <div className="grid gap-3 md:grid-cols-3">
                    {([
                      { id: "frames" as const, title: "Только фреймы", detail: "Личные звонки и ваши карточки для подсказок.", icon: UserRound },
                      { id: "work" as const, title: "Только работа", detail: "Переход прямо к рабочим карточкам.", icon: BriefcaseBusiness },
                      { id: "both" as const, title: "Оба номера", detail: "Два независимых потока: фреймы и работа.", icon: Check },
                    ]).map(({ id, title, detail, icon: Icon }) => <button key={id} type="button" onClick={() => setSelectedChoice(id)} aria-pressed={selectedChoice === id} className={`rounded-xl border p-4 text-left transition-colors ${selectedChoice === id ? "border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-400/30" : "border-gray-700 bg-gray-900/50 hover:border-gray-500"}`}>
                      <span className="flex items-center justify-between"><Icon className={`h-5 w-5 ${selectedChoice === id ? "text-cyan-300" : "text-gray-500"}`} />{selectedChoice === id && <Check className="h-4 w-4 text-cyan-200" />}</span>
                      <span className="mt-4 block font-semibold text-white">{title}</span><span className="mt-1 block text-sm leading-5 text-gray-400">{detail}</span>
                    </button>)}
                  </div>
                  {!onboarding?.subscribed && <p className="rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-sm leading-5 text-amber-100">Для этой возможности действует существующее ограничение доступа. Подписка не меняется на этом экране.</p>}
                  {onboarding?.availableCount === 0 && !workHasNumber && <p className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-sm leading-5 text-gray-300">Свободных линий сейчас нет. Выбор не активирует и не покупает номер; существующие номера не изменятся.</p>}
                  <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-xl text-xs leading-5 text-gray-500">Настройка не включает приём реальных звонков. В любой момент можно вернуться к карточкам и проверить назначение контекстов.</p>
                    <Button onClick={() => void connectChoice(selectedChoice)} disabled={attaching || !onboarding?.subscribed || missingLineCount > (onboarding?.availableCount ?? 0)} className="shrink-0 bg-cyan-700 hover:bg-cyan-600">
                      {attaching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      {attaching ? "Настраиваем…" : "Продолжить с выбранным путём"}
                    </Button>
                  </div>
                  {profileError && <div role="alert" className="flex flex-col gap-3 rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"><span>{profileError}</span><Button variant="outline" size="sm" onClick={() => void loadProfiles()}>Обновить состояние</Button></div>}
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Карточки знаний</h2>
              <p className="mt-1 text-sm text-gray-400">Создавайте контекст отдельно — существующие личные карточки не копируются.</p>
            </div>
            <Button onClick={openCreate} className="w-full bg-cyan-700 hover:bg-cyan-600 sm:w-auto" data-testid="button-create-context-card">
              <Plus className="mr-2 h-4 w-4" />Добавить карточку
            </Button>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-gray-700 bg-gray-900/60 p-1.5" role="tablist" aria-label="Область карточек">
            {(["personal", "work", "shared"] as Scope[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={scope === item}
                onClick={() => setScope(item)}
                className={`min-h-10 rounded-lg px-2 text-sm font-medium transition-colors ${scope === item ? "bg-cyan-800 text-white shadow-sm" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}
              >
                {scopeTitles[item]}
              </button>
            ))}
          </div>
          {cardsViewLoading ? (
            <div className="space-y-3">
              {[0, 1].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-gray-700 bg-gray-800/50" />)}
            </div>
          ) : cardsError ? (
            <Card className="border-red-900/70 bg-gray-800/50">
              <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" />{cardsError}</p>
                <Button variant="outline" size="sm" onClick={() => void loadCards(scope)}>Повторить</Button>
              </CardContent>
            </Card>
          ) : cards.length === 0 ? (
            <Card className="border-dashed border-gray-700 bg-gray-800/30">
              <CardContent className="py-9 text-center">
                <Phone className="mx-auto mb-3 h-8 w-8 text-gray-500" />
                <p className="font-medium text-gray-200">В разделе «{scopeTitles[scope]}» пока нет карточек</p>
                <p className="mt-1 text-sm text-gray-500">Добавьте только те сведения, которые подходят этому контексту.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {cards.map((card) => (
                <Card key={card.id} className="border-gray-700 bg-gray-800/50">
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-white">{card.title}</h3>
                        <Badge variant="outline" className="border-gray-600 text-gray-400">{card.cardType === "company" ? "Компания" : "Проект"}</Badge>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">{card.body}</p>
                    </div>
                    <div className="flex shrink-0 gap-2 self-end sm:self-start">
                      <Button variant="outline" size="sm" onClick={() => openEdit(card)} aria-label={`Изменить: ${card.title}`}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />Изменить
                      </Button>
                      <Button variant="outline" size="icon" aria-label={`Удалить: ${card.title}`} disabled={deletingId === card.id} onClick={() => void deleteCard(card)} className="border-red-900/70 text-red-300 hover:bg-red-950/50">
                        {deletingId === card.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Доступность функций">
          <Card className="border-amber-800/60 bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-300" />Назначение номера — не активация AI</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-300">
              <p>• Выбор номеров сам по себе не включает AI-приём.</p>
              <p>• Календарь и бронирование не подключаются этим шагом.</p>
              <p>• Существующие звонки и режимы сохраняются.</p>
              <p className="leading-6 text-gray-400">Для входящего Secretary отдельно разрешите нужные Work-карточки в его настройках. Это единственный источник рабочих сведений; общая карточка сама по себе не даёт права сообщать её содержимое клиентам.</p>
            </CardContent>
          </Card>
        </section>
      </main>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-gray-700 bg-gray-900 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCard ? "Изменить карточку" : "Новая карточка"}</DialogTitle>
            <DialogDescription className="text-gray-400">Область: {scopeTitles[scope]}. Содержимое останется в выбранном контексте.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCard} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="card-type">Тип</Label>
              <select id="card-type" value={draft.cardType} onChange={(event) => setDraft((previous) => ({ ...previous, cardType: event.target.value as CardType }))} className="h-10 w-full rounded-md border border-gray-700 bg-gray-800 px-3 text-sm text-white">
                <option value="project">Проект</option>
                <option value="company">Компания</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-title">Название</Label>
              <Input id="card-title" value={draft.title} maxLength={120} required onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))} className="border-gray-700 bg-gray-800 text-white" placeholder="Например, текущий проект" />
              <p className="text-right text-xs text-gray-500">{draft.title.length}/120</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-body">Контекст</Label>
              <Textarea id="card-body" value={draft.body} maxLength={600} required onChange={(event) => setDraft((previous) => ({ ...previous, body: event.target.value }))} className="min-h-32 border-gray-700 bg-gray-800 text-white" placeholder="Что важно помнить в этом контексте?" />
              <p className="text-right text-xs text-gray-500">{draft.body.length}/600</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)} className="text-gray-300"><X className="mr-1.5 h-4 w-4" />Отмена</Button>
              <Button type="submit" disabled={savingCard || !draft.title.trim() || !draft.body.trim()} className="bg-cyan-700 hover:bg-cyan-600">
                {savingCard ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
