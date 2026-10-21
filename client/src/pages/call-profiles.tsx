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
  recommendedWorkNumber: { id: string; phoneNumber: string; available: boolean; existingBindingMove?: boolean };
  incomingAiEnabled: false;
  calendarConnected: false;
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
  personal: "Личное",
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
  const [profiles, setProfiles] = useState<CallProfile[]>([]);
  const [recommended, setRecommended] = useState<CallProfilesResponse["recommendedWorkNumber"] | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [scope, setScope] = useState<Scope>("personal");
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
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<KnowledgeCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>({ cardType: "project", title: "", body: "" });
  const [savingCard, setSavingCard] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) setLocation("/");
  }, [authLoading, user, setLocation]);

  const loadProfiles = useCallback(async () => {
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
      setRecommended(data.recommendedWorkNumber || null);
      setSelectedNumberId(data.recommendedWorkNumber?.available ? data.recommendedWorkNumber.id : "");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.");
    } finally {
      setProfileLoading(false);
    }
  }, [token]);

  const loadCards = useCallback(async (requestedScope: Scope, authToken = token) => {
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
  }, [token]);

  useEffect(() => {
    if (token && user) void loadProfiles();
  }, [token, user, loadProfiles]);

  useEffect(() => {
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
  }, [token, user, scope, loadCards]);

  async function attachWorkNumber() {
    if (!selectedNumberId) return;
    const selected = recommended?.id === selectedNumberId
      ? recommended.phoneNumber
      : selectedNumberId;
    const moveNotice = recommended?.existingBindingMove
      ? "\n\nCDL-линия перейдёт из вашего прежнего CDL-аккаунта в этот аккаунт: новые входящие будут приходить сюда. История прежнего аккаунта останется в нём."
      : "";
    const confirmed = window.confirm(`Сделать номер ${selected} рабочим?${moveNotice}\n\nЛичный номер не изменится. Ранее предложенный номер вернётся в пул, без отказа от него у оператора. Покупки не будет.`);
    if (!confirmed) return;
    setAttaching(true);
    try {
      const response = await fetch("/api/call-profiles/work-number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ numberId: selectedNumberId }),
      });
      if (!response.ok) throw new Error(await readError(response, "Не удалось подключить номер."));
      toast({ title: "Рабочий номер подключён", description: `${selected} теперь относится к рабочему профилю.` });
      await loadProfiles();
    } catch (error) {
      toast({
        title: "Не удалось подключить номер",
        description: error instanceof Error ? error.message : "Ошибка сети. Проверьте соединение и повторите.",
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
  const cardsViewLoading = cardsLoading || cardsScope !== scope || cardsToken !== token;

  if (authLoading || (!user && !profileError)) {
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
        <section className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Личное отдельно. Работа отдельно.</h2>
          <p className="mt-2 text-sm leading-6 text-gray-300 sm:text-base">
            Настройте, какой номер и какие знания относятся к каждому контексту. Это первый этап настройки номера и контекста, а не полноценная система записи на встречи.
          </p>
          <Button variant="outline" onClick={() => setLocation("/incoming-secretary")} className="mt-4 border-cyan-800 text-cyan-200 hover:bg-cyan-950/40">
            Настройки входящего Secretary
          </Button>
        </section>

        <section aria-label="Профили">
          {profileLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-gray-700 bg-gray-800/60" />)}
            </div>
          ) : profileError ? (
            <Card className="border-red-900/70 bg-gray-800/60">
              <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" />{profileError}</p>
                <Button variant="outline" onClick={() => void loadProfiles()}>Повторить</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-cyan-800/60 bg-gray-800/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg"><UserRound className="h-5 w-5 text-cyan-400" />Личный профиль</CardTitle>
                    <Badge variant="outline" className="border-cyan-800 text-cyan-300">Личное</Badge>
                  </div>
                  <CardDescription className="text-gray-400">Сохранённый личный номер остаётся без изменений.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {personal?.numbers.length ? personal.numbers.map((number) => (
                    <div key={number.id} className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="font-mono text-lg text-cyan-300">{number.phoneNumber}</p>
                      <p className="mt-1 text-sm text-gray-400">{number.name}</p>
                    </div>
                  )) : <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-400">Личный номер пока не указан.</p>}
                </CardContent>
              </Card>

              <Card className="border-purple-800/60 bg-gray-800/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg"><BriefcaseBusiness className="h-5 w-5 text-purple-300" />Рабочий профиль</CardTitle>
                    <Badge variant="outline" className="border-purple-800 text-purple-200">{workHasNumber ? "Номер подключён" : "Не настроен"}</Badge>
                  </div>
                  <CardDescription className="text-gray-400">Подключается только уже принадлежащий вам номер из пула.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {work?.numbers.map((number) => (
                    <div key={number.id} className="rounded-lg border border-purple-900/70 bg-gray-900/60 p-3">
                      <p className="font-mono text-lg text-purple-200">{number.phoneNumber}</p>
                      <p className="mt-1 text-sm text-gray-400">{number.name}</p>
                    </div>
                  ))}
                  {!workHasNumber && (
                    <>
                      {recommended?.available ? (
                        <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selectedNumberId === recommended.id ? "border-cyan-500 bg-cyan-950/30" : "border-gray-700 bg-gray-900/50 hover:border-gray-500"}`}>
                          <input
                            type="radio"
                            name="work-number"
                            value={recommended.id}
                            checked={selectedNumberId === recommended.id}
                            onChange={() => setSelectedNumberId(recommended.id)}
                            className="mt-1 accent-cyan-400"
                          />
                          <span>
                            <span className="block font-mono text-lg text-white">{recommended.phoneNumber}</span>
                            <span className="mt-1 block text-xs text-gray-400">Выбранная вами линия CDL · без покупки</span>
                          </span>
                        </label>
                      ) : (
                        <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-400">
                          Сейчас нет доступного номера для рабочего профиля.
                        </p>
                      )}
                      <p className="text-xs leading-5 text-gray-500">Выбор применяется только после подтверждения. Личный номер сохраняется. Если CDL закреплён за вашим прежним аккаунтом, новые входящие перейдут в этот аккаунт; старая история не переносится и не удаляется. Во время активного звонка назначение блокируется.</p>
                      <Button onClick={attachWorkNumber} disabled={!recommended?.available || !selectedNumberId || attaching} className="w-full bg-purple-700 hover:bg-purple-600">
                        {attaching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        Подключить выбранный номер
                      </Button>
                    </>
                  )}
                  {workHasNumber && (
                    <p className="flex items-center gap-2 text-xs text-gray-400"><ShieldCheck className="h-4 w-4 text-green-400" />Номер уже подключён к рабочему профилю. Личный номер и активная линия сохранены.</p>
                  )}
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
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-300" />Что пока недоступно</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-300">
              <p>• Автоматический Secretary для входящих звонков выключен.</p>
              <p>• Календарь не подключён.</p>
              <p>• Исходящий Secretary для рабочего профиля пока не включён.</p>
              <p className="leading-6 text-gray-400">Карточки сейчас помогают формировать подсказки владельцу и не управляют автономным ИИ на входящих звонках.</p>
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
