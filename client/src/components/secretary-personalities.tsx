import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { PersonalityEditorFields, PersonalityStatus, SecretaryPersonalityEditor } from "@/components/secretary-personality-editor";
import { PersonalityCatalogItem, PersonalityVersion, SecretaryPersonalityCatalog } from "@/components/secretary-personality-catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PersonalitySnapshot = {
  id: string;
  version: number;
  name: string;
  description: string;
  rules: string;
  examples: string[];
  modeGuidance: PersonalityVersion["modeGuidance"];
  status: PersonalityStatus;
};
type Assignment = {
  personalityId: string;
  version: number;
  snapshot: PersonalitySnapshot;
} | null;
type Support = { incoming: boolean; outgoingRetell: boolean; note: string };
type NumberOption = { id: string; type: string; twilioNumber: string; friendlyName: string };
type ListResult = { items: PersonalityCatalogItem[]; nextCursor: string | null };
type AssignmentResult = { assignment: Assignment; support: Support };
type PreviewResult = { text: string; personality: { id: string; name: string; version: number } | null; mode: string; model: string };

const emptyFields: PersonalityEditorFields = { slug: "", name: "", description: "", rules: "", examples: "", personal: "", work: "", status: "available" };
const panel = "border-[#344b4f] bg-[#17282d] text-[#e8efec]";
const subpanel = "rounded-xl border border-[#344b4f] bg-[#122328]";

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Не удалось выполнить запрос.");
  return body as T;
}

function versionFields(version: PersonalityVersion, personality: PersonalityCatalogItem): PersonalityEditorFields {
  return {
    slug: personality.slug,
    name: version.name,
    description: version.description,
    rules: version.rules,
    examples: version.examples.join("\n"),
    personal: version.modeGuidance.personal,
    work: version.modeGuidance.work,
    status: personality.status,
  };
}

export function SecretaryPersonalities({ token, offlinePreview = false }: { token: string | null; offlinePreview?: boolean }) {
  const [numbers, setNumbers] = useState<NumberOption[]>([]);
  const [admin, setAdmin] = useState(false);
  const [numberId, setNumberId] = useState("");
  const [list, setList] = useState<PersonalityCatalogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(true);
  const [error, setError] = useState("");
  const [assignment, setAssignment] = useState<Assignment>(null);
  const [support, setSupport] = useState<Support>({ incoming: false, outgoingRetell: false, note: "" });
  const [selectedPersonalityId, setSelectedPersonalityId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [details, setDetails] = useState<PersonalityVersion | null>(null);
  const [editor, setEditor] = useState<PersonalityEditorFields | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const latestView = useRef({ numberId, query, selectedPersonalityId, selectedVersion });
  latestView.current = { numberId, query, selectedPersonalityId, selectedVersion };
  const latestPreviewText = useRef(previewText);
  latestPreviewText.current = previewText;
  const listRequest = useRef(0);
  const assignmentRequest = useRef(0);
  const detailsRequest = useRef(0);
  const saveRequest = useRef(0);
  const previewRequest = useRef(0);

  function currentViewKey() {
    return JSON.stringify(latestView.current);
  }

  function clearPreview() {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(false);
  }

  const loadContext = useCallback(async () => {
    if (!token || offlinePreview || !import.meta.env.DEV) {
      setContextBusy(false);
      return;
    }
    setContextBusy(true);
    setError("");
    try {
      const result = await api<{ numbers: NumberOption[]; admin: boolean }>(token, "/api/secretary-personalities/context");
      setNumbers(result.numbers);
      setAdmin(result.admin);
      setNumberId((previous) => result.numbers.some((number) => number.id === previous) ? previous : result.numbers[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить номера.");
    } finally {
      setContextBusy(false);
    }
  }, [token, offlinePreview]);

  const loadList = useCallback(async (term: string, next = false, pageCursor?: string | null) => {
    if (!token || offlinePreview || !import.meta.env.DEV) return;
    const requestId = ++listRequest.current;
    const viewKey = currentViewKey();
    setListBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: term, limit: "25" });
      if (next && pageCursor) params.set("cursor", pageCursor);
      if (admin) params.set("includeRetired", "true");
      const result = await api<ListResult>(token, `/api/secretary-personalities?${params.toString()}`);
      if (requestId !== listRequest.current || viewKey !== currentViewKey()) return;
      setList((current) => next ? [...current, ...result.items] : result.items);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (requestId === listRequest.current && viewKey === currentViewKey()) setError(cause instanceof Error ? cause.message : "Не удалось загрузить каталог.");
    } finally {
      if (requestId === listRequest.current) setListBusy(false);
    }
  }, [token, offlinePreview, admin]);

  const loadAssignment = useCallback(async () => {
    if (!token || !numberId || offlinePreview || !import.meta.env.DEV) {
      setAssignment(null);
      setSelectedPersonalityId("");
      setSelectedVersion(null);
      return;
    }
    const requestId = ++assignmentRequest.current;
    const requestedNumber = numberId;
    const startingSelection = JSON.stringify([selectedPersonalityId, selectedVersion]);
    setAssignmentMessage("");
    try {
      const result = await api<AssignmentResult>(token, `/api/secretary-personalities/numbers/${encodeURIComponent(numberId)}`);
      if (requestId !== assignmentRequest.current || requestedNumber !== latestView.current.numberId) return;
      setAssignment(result.assignment);
      setSupport(result.support);
      if (startingSelection === JSON.stringify([latestView.current.selectedPersonalityId, latestView.current.selectedVersion])) {
        setSelectedPersonalityId(result.assignment?.personalityId || "");
        setSelectedVersion(result.assignment?.version ?? null);
      }
    } catch (cause) {
      if (requestId === assignmentRequest.current && requestedNumber === latestView.current.numberId) setError(cause instanceof Error ? cause.message : "Не удалось загрузить назначение.");
    }
  }, [token, numberId, offlinePreview]);

  useEffect(() => { void loadContext(); }, [loadContext]);
  useEffect(() => {
    if (!contextBusy && token && !offlinePreview) {
      setDetails(null);
      detailsRequest.current += 1;
      clearPreview();
      void loadList(query);
    }
    return () => { listRequest.current += 1; };
  }, [contextBusy, token, offlinePreview, query, numberId, selectedPersonalityId, selectedVersion, loadList]);
  useEffect(() => { void loadAssignment(); }, [loadAssignment]);

  const selectedNumber = numbers.find((number) => number.id === numberId);
  const selectedCatalogItem = list.find((item) => item.id === selectedPersonalityId);
  const canSaveAssignment = Boolean(token && numberId && !savingAssignment && (selectedPersonalityId === "" || selectedVersion !== null));
  const listById = useMemo(() => new Map(list.map((item) => [item.id, item])), [list]);

  async function openDetails(personality: PersonalityCatalogItem) {
    if (!token || !import.meta.env.DEV) return;
    const requestId = ++detailsRequest.current;
    const viewKey = currentViewKey();
    setError("");
    setDetails(null);
    try {
      const result = await api<{ personality: PersonalityCatalogItem; versions: PersonalityVersion[] }>(token, `/api/secretary-personalities/${encodeURIComponent(personality.id)}`);
      if (requestId !== detailsRequest.current || viewKey !== currentViewKey()) return;
      setDetails(result.versions.find((version) => version.version === result.personality.currentVersion) || result.versions[0] || null);
    } catch (cause) {
      if (requestId === detailsRequest.current && viewKey === currentViewKey()) setError(cause instanceof Error ? cause.message : "Не удалось открыть карточку.");
    }
  }

  async function saveAssignment() {
    if (!token || !import.meta.env.DEV || !numberId || !canSaveAssignment) return;
    const requestId = ++saveRequest.current;
    const viewKey = currentViewKey();
    setSavingAssignment(true);
    setAssignmentMessage("");
    try {
      const result = await api<AssignmentResult>(token, `/api/secretary-personalities/numbers/${encodeURIComponent(numberId)}`, {
        method: "PUT",
        body: JSON.stringify({ personalityId: selectedPersonalityId || null, version: selectedPersonalityId ? selectedVersion : null }),
      });
      if (requestId !== saveRequest.current || viewKey !== currentViewKey()) return;
      setAssignment(result.assignment);
      setSupport(result.support);
      setSelectedPersonalityId(result.assignment?.personalityId || "");
      setSelectedVersion(result.assignment?.version ?? null);
      setAssignmentMessage("Назначение сохранено для выбранного номера.");
    } catch (cause) {
      if (requestId === saveRequest.current && viewKey === currentViewKey()) {
        const reason = cause instanceof Error ? cause.message : "повторите попытку";
        setAssignmentMessage(`Не удалось сохранить назначение. ${reason}`);
      }
    } finally {
      if (requestId === saveRequest.current) setSavingAssignment(false);
    }
  }

  function startCreate() {
    setEditingId(null);
    setEditor({ ...emptyFields });
  }

  async function startEdit(personality: PersonalityCatalogItem) {
    if (!token || !import.meta.env.DEV) return;
    try {
      const result = await api<{ personality: PersonalityCatalogItem; versions: PersonalityVersion[] }>(token, `/api/secretary-personalities/${encodeURIComponent(personality.id)}`);
      const current = result.versions.find((version) => version.version === personality.currentVersion) || result.versions[0];
      if (!current) throw new Error("Текущая версия не найдена.");
      setEditingId(personality.id);
      setEditor(versionFields(current, result.personality));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось открыть редактор.");
    }
  }

  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !import.meta.env.DEV || !editor) return;
    setSavingEditor(true);
    setError("");
    const fields = {
      name: editor.name.trim(),
      description: editor.description.trim(),
      rules: editor.rules.trim(),
      examples: editor.examples.split("\n").map((item) => item.trim()).filter(Boolean),
      modeGuidance: { personal: editor.personal.trim(), work: editor.work.trim() },
    };
    try {
      if (editingId) {
        const target = listById.get(editingId);
        if (!target) throw new Error("Запись каталога не найдена. Обновите список.");
        await api(token, `/api/secretary-personalities/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify({ ...fields, expectedVersion: target.currentVersion, status: editor.status }),
        });
      } else {
        await api(token, "/api/secretary-personalities", {
          method: "POST",
          body: JSON.stringify({ ...fields, slug: editor.slug.trim() }),
        });
      }
      setEditor(null);
      await loadList(query);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить редакцию.");
    } finally {
      setSavingEditor(false);
    }
  }

  async function runTextPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !import.meta.env.DEV || !numberId || !previewText.trim()) return;
    const requestId = ++previewRequest.current;
    const viewKey = currentViewKey();
    const requestedText = previewText.trim();
    setPreviewBusy(true);
    setPreviewError("");
    setPreview(null);
    try {
      const result = await api<PreviewResult>(token, "/api/secretary-personalities/preview", {
        method: "POST",
        body: JSON.stringify({ numberId, text: requestedText }),
      });
      if (requestId !== previewRequest.current || viewKey !== currentViewKey() || requestedText !== latestPreviewText.current.trim()) return;
      setPreview(result);
    } catch (cause) {
      if (requestId === previewRequest.current && viewKey === currentViewKey()) setPreviewError(cause instanceof Error ? cause.message : "Предпросмотр недоступен.");
    } finally {
      if (requestId === previewRequest.current) setPreviewBusy(false);
    }
  }

  const activeAssignmentVersion = assignment?.version;
  const hasPendingAssignment = (selectedPersonalityId || "") !== (assignment?.personalityId || "") || (selectedPersonalityId && selectedVersion !== activeAssignmentVersion);

  return (
    <section id="personalities" className="scroll-mt-6 space-y-5">
      <div className="flex flex-col gap-3 border-b border-[#2d4145] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-teal-300">04 / Манера общения</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Каталог характеров Secretary</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#a9bbb7]">Текстовые правила и примеры поведения. Каталог общий, назначение хранится отдельно для каждого вашего номера.</p>
        </div>
        {admin && <Button onClick={startCreate} className="shrink-0 bg-[#28756a] text-white hover:bg-[#328b7c]"><Plus className="mr-2 h-4 w-4" />Новый характер</Button>}
      </div>

      {offlinePreview || !import.meta.env.DEV ? (
        <div className={`${subpanel} p-4 text-sm leading-6 text-[#c0cec9]`}>{offlinePreview ? "Каталог характеров доступен только в Dev-админке и здесь не загружается." : "Каталог характеров и текстовый предпросмотр доступны только в Dev-сборке."}</div>
      ) : (
        <>
          {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-900/70 bg-[#302426] p-3 text-sm text-rose-200"><span>{error}</span><Button size="sm" variant="ghost" onClick={() => { setError(""); void loadContext(); void loadList(query); }} className="shrink-0 text-rose-100"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Повторить</Button></div>}
          {contextBusy ? (
            <div className="grid gap-4 lg:grid-cols-2"><div className="h-64 animate-pulse rounded-2xl border border-[#2d4145] bg-[#17282d]" /><div className="h-64 animate-pulse rounded-2xl border border-[#2d4145] bg-[#17282d]" /></div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-5">
                <Card className={panel}>
                  <CardHeader>
                    <p className="text-xs uppercase tracking-[0.15em] text-teal-300">Назначение номера</p>
                    <CardTitle className="text-xl">Выберите характер</CardTitle>
                    <CardDescription className="text-[#a9bbb7]">Изменение вступает в силу только после сохранения. Катя автоматически не назначается.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {numbers.length ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="personality-number" className="text-[#dce8e4]">Рабочий номер</Label>
                          <select id="personality-number" value={numberId} onChange={(event) => {
                            clearPreview();
                            setNumberId(event.target.value);
                            setAssignment(null);
                            setSelectedPersonalityId("");
                            setSelectedVersion(null);
                            setAssignmentMessage("");
                          }} className="h-11 w-full rounded-lg border border-[#40585c] bg-[#102025] px-3 text-sm text-white">
                            {numbers.map((number) => <option key={number.id} value={number.id}>{number.friendlyName || number.twilioNumber} · {number.twilioNumber}</option>)}
                          </select>
                        </div>
                        {selectedNumber && <p className="text-xs text-[#8fa49f]">Тип линии: {selectedNumber.type}</p>}
                        <div className="space-y-2">
                          <Label htmlFor="personality-choice" className="text-[#dce8e4]">Характер</Label>
                          <select id="personality-choice" value={selectedPersonalityId} onChange={(event) => {
                            clearPreview();
                            const nextId = event.target.value;
                            setSelectedPersonalityId(nextId);
                            const record = listById.get(nextId);
                            setSelectedVersion(record?.currentVersion ?? null);
                          }} className="h-11 w-full rounded-lg border border-[#40585c] bg-[#102025] px-3 text-sm text-white">
                            <option value="">Без характера · прежнее поведение</option>
                            {assignment?.snapshot.status === "retired" && <option value={assignment.personalityId}>Архив · {assignment.snapshot.name} · v{assignment.version} (текущее назначение)</option>}
                            {list.filter((item) => item.status === "available").map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentVersion}</option>)}
                          </select>
                        </div>
                        {selectedPersonalityId && <div className="flex items-center justify-between gap-3 rounded-lg border border-[#3b5653] bg-[#142b2c] px-3 py-2.5">
                          <span className="text-sm text-[#d3e5dd]">{selectedCatalogItem?.name || assignment?.snapshot.name || "Выбранный характер"}</span>
                          <label className="flex items-center gap-2 text-xs text-[#b9ccc4]">Версия
                            <select value={selectedVersion ?? ""} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="h-8 rounded-md border border-[#40585c] bg-[#102025] px-2 text-white">
                              {assignment?.personalityId === selectedPersonalityId && <option value={assignment.version}>v{assignment.version} · назначена</option>}
                              {selectedCatalogItem && <option value={selectedCatalogItem.currentVersion}>v{selectedCatalogItem.currentVersion} · текущая</option>}
                            </select>
                          </label>
                        </div>}
                        {assignment && <div className={`${subpanel} p-3 text-xs leading-5 text-[#b7c8c3]`}>
                          Сейчас назначена версия <strong className="text-teal-200">v{assignment.version}</strong> · {assignment.snapshot.name}. Новые редакции не меняют назначение; сохраните текущую версию явно, чтобы обновить.
                          {assignment.snapshot.status === "retired" && <span className="mt-1 block text-amber-200">Характер снят с выбора, прежнее назначение сохранено.</span>}
                        </div>}
                        {hasPendingAssignment && <p className="text-xs text-amber-200">Есть несохранённые изменения назначения.</p>}
                        <div className="space-y-2 border-t border-[#30474b] pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[#9eb2ae]">Совместимость</p>
                          <p className="text-sm text-[#c4d1cd]">Входящий Work: {support.incoming ? "поддерживается" : "не поддерживается"}</p>
                          <p className="text-sm text-[#c4d1cd]">Исходящий Retell: {support.outgoingRetell ? "поддерживается" : "не поддерживается"}</p>
                          <p className="rounded-lg border border-amber-800/70 bg-[#302b22] p-3 text-xs leading-5 text-amber-100"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Входящий Personal пока не поддерживается. Браузерные аудио-тесты пока не загружают характеры для каждого номера.</p>
                          {support.note && <p className="text-xs leading-5 text-[#8fa49f]">{support.note}</p>}
                        </div>
                        <Button onClick={() => void saveAssignment()} disabled={!canSaveAssignment || !hasPendingAssignment} className="w-full bg-[#28756a] text-white hover:bg-[#328b7c] disabled:opacity-50">
                          {savingAssignment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Сохранить назначение
                        </Button>
                        {assignmentMessage && <p role="status" className="text-sm text-teal-200">{assignmentMessage}</p>}
                      </>
                    ) : <div className="rounded-xl border border-dashed border-[#496064] p-4 text-sm leading-6 text-[#adbfbb]">Нет номеров, доступных для назначения характера. Вы можете изучить каталог ниже.</div>}
                  </CardContent>
                </Card>

                <Card className={panel}>
                  <CardHeader><p className="text-xs uppercase tracking-[0.15em] text-teal-300">Текстовая проверка</p><CardTitle className="text-xl">Проверьте ответ на примере</CardTitle><CardDescription className="text-[#a9bbb7]">Это только текстовый предпросмотр. Он не звонит, не отправляет сообщение и не выполняет действие для клиента.</CardDescription></CardHeader>
                  <CardContent>
                    <form onSubmit={runTextPreview} className="space-y-3">
                      <Textarea value={previewText} onChange={(event) => { clearPreview(); setPreviewText(event.target.value); }} maxLength={3000} placeholder="Напишите тестовую реплику…" className="min-h-24 border-[#40585c] bg-[#102025] text-white placeholder:text-[#70827e]" />
                      <Button type="submit" disabled={!numberId || !previewText.trim() || previewBusy} variant="outline" className="border-[#4a6665] text-[#c7dfd8] hover:bg-[#25413f]">
                        {previewBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Показать текстовый ответ
                      </Button>
                    </form>
                    {previewError && <p role="alert" className="mt-3 text-sm text-rose-200">{previewError}</p>}
                    {preview && <div className={`${subpanel} mt-4 space-y-2 p-4`}>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[#e0e9e5]">{preview.text}</p>
                      <p className="border-t border-[#30474b] pt-2 text-xs text-[#8fa49f]">
                        {preview.personality ? `${preview.personality.name} · v${preview.personality.version}` : "Без характера"}
                        {" · "}{preview.mode}{" · "}{preview.model}
                      </p>
                    </div>}
                  </CardContent>
                </Card>
              </div>

              <SecretaryPersonalityCatalog
                items={list}
                busy={listBusy}
                query={query}
                cursor={cursor}
                admin={admin}
                details={details}
                onQueryChange={(value) => {
                  clearPreview();
                  detailsRequest.current += 1;
                  listRequest.current += 1;
                  setList([]);
                  setCursor(null);
                  setDetails(null);
                  setQuery(value);
                }}
                onLoadMore={() => void loadList(query, true, cursor)}
                onOpen={(personality) => void openDetails(personality)}
                onChoose={(personality) => {
                  clearPreview();
                  setSelectedPersonalityId(personality.id);
                  setSelectedVersion(personality.currentVersion);
                  document.getElementById("personalities")?.scrollIntoView({ behavior: "smooth" });
                }}
                onEdit={(personality) => void startEdit(personality)}
                onCloseDetails={() => setDetails(null)}
              />
            </div>
          )}
        </>
      )}

      {editor && <SecretaryPersonalityEditor editor={editor} editingId={editingId} saving={savingEditor} onChange={setEditor} onClose={() => setEditor(null)} onSave={saveEditor} />}
    </section>
  );
}
