import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

// ---------------------------------------------------------------------------
// Types (mirrors of server/benchmark shapes; scorecard fields are defensive)
// ---------------------------------------------------------------------------

interface EarsCandidate {
  id: string;
  label: string;
  provider: "deepgram" | "openai" | "azure";
  kind: "realtime" | "batch";
  referenceOnly?: boolean;
  optional?: boolean;
  config: Record<string, string | number | boolean>;
}
interface BrainCandidate {
  id: string;
  label: string;
  model: string;
  reasoningEffort: "none" | "low" | "n/a";
  baseline?: boolean;
}
interface AvailabilityResult {
  candidateId: string;
  status: "AVAILABLE" | "UNAVAILABLE" | "NOT_CHECKED";
  checkedAt: string;
  detail: string;
  latencyMs?: number;
}
interface Fixture {
  id: string;
  title: string;
  kind: string;
  goal: string;
  referenceTurns: { idx: number; role: string; text: string }[];
  criticalEntities: Record<string, string[]>;
  confirmedFacts: string[];
  audioBase64: string | null;
  audioFormat: string | null;
  audioChannels: string | null;
  channelRoles?: ("owner" | "guest")[];
  tags: string[];
}

interface EarsScorecardRow {
  candidateId: string;
  label: string;
  semantic: number | null;
  semanticIsProxy?: boolean;
  wer: number | null;
  ownerWer?: number | null;
  guestWer?: number | null;
  terms?: number | null;
  referenceOnly?: boolean;
  numbersMoney: number | null;
  roleSplit: number | null;
  prematureEot: number | null;
  falseWait: number | null;
  eotP50: number | null;
  finalP50: number | null;
  costEstimate: number | null;
  turnsScored?: number;
}
type JudgeDim =
  | "understood_current_turn" | "goal_memory" | "tried_memory"
  | "avoids_rejected_strategy" | "next_move_quality" | "reply_naturalness_en"
  | "overall_live_copilot_quality";

interface DeadlineBucket { count: number; pct: number }

interface BrainScorecardEntry {
  candidateId: string;
  model: string;
  turns: number;
  successfulHints: number;
  errors: number;
  schemaInvalid: number;
  avgFirstTokenMs: number | null;
  avgFullOutputMs: number | null;
  avgReadyMs: number | null;
  deadlineBuckets: Record<"<=500" | "<=1000" | "<=1500" | "<=2000", DeadlineBucket>;
  clientRenderEstimateMs: number | null;
  clientRenderEstimated: boolean;
  avgTokensIn: number | null;
  avgTokensOut: number | null;
  estCostPer10MinCall: number | null;
  costNote: string | null;
  judgeAverages: Record<JudgeDim, number> | null;
}
interface BrainScorecard { candidates: BrainScorecardEntry[] }

interface ContinuityMetrics {
  eligibleGuestTurns: number;
  hintsRequested: number;
  hintsGenerated: number;
  hintsWsSent: number;
  hintsClientRendered: number;
  hintsMissed: number;
  maxConsecutiveMissedHints: number;
  misses: { turnIdx: number; stage: string; reason: string }[];
}
interface BrainTurnResult {
  turnIdx: number;
  candidateId: string;
  output: {
    should_suggest?: boolean;
    suggested_reply?: string;
    current_topic?: string;
    goal_status?: string;
    strategy?: string;
  } | null;
  schemaValid?: boolean;
  error?: string;
  firstTokenMs?: number | null;
  suggestionReadyAfterGuestEndMs: number | null;
  judge?: { judgeModel: string; selfJudged: boolean; scores: Record<JudgeDim, number> } | null;
}
interface EarsTurnResult {
  turnIdx: number;
  candidateId: string;
  hypothesisText: string;
  role: string | null;
}

interface BenchmarkRun {
  id: string;
  runType: "ears" | "brain" | "availability" | "replay" | "goal_return";
  status: "running" | "completed" | "failed";
  corpusHash: string;
  fixtureIds?: string[];
  config?: any;
  promptVersion?: string;
  availability?: { ears?: AvailabilityResult[]; brain?: AvailabilityResult[] };
  scorecard?: any;
  results?: {
    turnResults?: (BrainTurnResult | EarsTurnResult)[];
    continuity?: Record<string, ContinuityMetrics>;
    judgeModel?: string;
    notes?: string[];
  };
  report?: string | boolean | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

interface ReplayTurn {
  turnIdx: number;
  role: string;
  said: string;
  aiState: string | null;
  strategy: string | null;
  suggestedReply: string | null;
  timestamps: Partial<Record<
    "audioEnd" | "sttFinal" | "hintTrigger" | "llmFirstToken"
    | "suggestionReady" | "wsSent" | "clientRendered", number>>;
  latencyMs: number | null;
  judgeScore: number | null;
}
interface ReplayData {
  candidateId: string;
  estimatedStages: string[];
  turns: ReplayTurn[];
}

const BASE = "/api/admin/benchmark";
const DEADLINE_KEYS = ["<=500", "<=1000", "<=1500", "<=2000"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function ms(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.round(v)}ms`;
}
function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `$${v.toFixed(4)}`;
}
function num(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}
function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

interface ParsedTurn { idx: number; role: "owner" | "guest"; text: string }

/**
 * Parse a transcript textarea into reference turns. Accepts either:
 *  - a JSON array of { idx?, role, text }
 *  - simple lines "guest: Hello" / "owner: Hi" (idx auto-numbered).
 * Throws on empty / unparseable input.
 */
function parseTranscript(raw: string): ParsedTurn[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Транскрипт обязателен для аудио-фикстуры (пусто).");

  // Try JSON array first.
  if (trimmed.startsWith("[")) {
    let arr: any;
    try { arr = JSON.parse(trimmed); }
    catch { throw new Error("Не удалось распарсить JSON транскрипта."); }
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("JSON транскрипт должен быть непустым массивом.");
    return arr.map((t: any, i: number) => {
      const role = String(t?.role ?? "").toLowerCase();
      if (role !== "owner" && role !== "guest") throw new Error(`Turn ${i}: role должен быть 'owner' или 'guest'.`);
      const text = String(t?.text ?? "").trim();
      if (!text) throw new Error(`Turn ${i}: text пустой.`);
      return { idx: typeof t?.idx === "number" ? t.idx : i, role: role as "owner" | "guest", text };
    });
  }

  // Otherwise parse "role: text" lines.
  const turns: ParsedTurn[] = [];
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(owner|guest)\s*:\s*(.+)$/i);
    if (!m) throw new Error(`Строка не распознана (нужно "guest: ..." или "owner: ..."): "${line}"`);
    turns.push({ idx: turns.length, role: m[1].toLowerCase() as "owner" | "guest", text: m[2].trim() });
  }
  if (turns.length === 0) throw new Error("Транскрипт пуст после разбора.");
  return turns;
}

function useAuthedQuery<T>(key: (string | undefined)[], enabled = true, refetchInterval: number | false = false) {
  const { token } = useAuth();
  return useQuery<T>({
    queryKey: key,
    enabled: enabled && !!token,
    refetchInterval,
    queryFn: async () => {
      const res = await fetch(key.join("/"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        const err: any = new Error("403");
        err.status = 403;
        throw err;
      }
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function AvailabilityBadge({ status }: { status?: AvailabilityResult["status"] }) {
  if (!status || status === "NOT_CHECKED")
    return <Badge variant="outline" className="text-gray-400 border-gray-600" data-testid="badge-availability">NOT_CHECKED</Badge>;
  if (status === "AVAILABLE")
    return <Badge className="bg-green-600 hover:bg-green-600" data-testid="badge-availability">AVAILABLE</Badge>;
  return <Badge variant="destructive" data-testid="badge-availability">UNAVAILABLE</Badge>;
}

function StatusBadge({ status }: { status: BenchmarkRun["status"] }) {
  if (status === "running")
    return <Badge className="bg-amber-500 hover:bg-amber-500">running</Badge>;
  if (status === "completed")
    return <Badge className="bg-green-600 hover:bg-green-600">completed</Badge>;
  return <Badge variant="destructive">failed</Badge>;
}

// ===========================================================================
// Main page
// ===========================================================================

export default function AdminDiagnostics() {
  const [, setLocation] = useLocation();
  const { token, isLoading } = useAuth();
  const [tab, setTab] = useState("ears");

  useEffect(() => {
    if (!isLoading && !token) setLocation("/");
  }, [isLoading, token, setLocation]);

  const candidatesQ = useAuthedQuery<{ ears: EarsCandidate[]; brain: BrainCandidate[] }>(
    [BASE, "candidates"], !!token,
  );

  if (isLoading || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const is403 = (candidatesQ.error as any)?.status === 403;
  if (is403) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <Card className="bg-gray-800/60 border-red-700 max-w-md w-full" data-testid="state-403">
          <CardContent className="py-12 text-center">
            <h1 className="text-2xl font-bold text-red-400 mb-2">403 — admin only</h1>
            <p className="text-gray-400 mb-6">
              Диагностика доступна только администраторам бенчмарка.
            </p>
            <Button onClick={() => setLocation("/")} variant="outline">На главную</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
            TalkHint Diagnostics — LIVE Ears &amp; Brain Benchmark
          </h1>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")} className="text-gray-400">
            ← Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="mb-4 flex-wrap h-auto">
            <TabsTrigger value="ears" data-testid="tab-ears">LIVE Ears Benchmark</TabsTrigger>
            <TabsTrigger value="brain" data-testid="tab-brain">LIVE Brain Benchmark</TabsTrigger>
            <TabsTrigger value="replay" data-testid="tab-replay">LIVE End-to-End Replay</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">Benchmark History</TabsTrigger>
            <TabsTrigger value="recorded" data-testid="tab-recorded">Записанные звонки</TabsTrigger>
            <TabsTrigger value="pipeline" data-testid="tab-pipeline">Candidate Pipeline</TabsTrigger>
            <TabsTrigger value="goalreturn" data-testid="tab-goalreturn">Goal-Return</TabsTrigger>
          </TabsList>

          <TabsContent value="ears"><EarsTab candidates={candidatesQ.data?.ears ?? []} /></TabsContent>
          <TabsContent value="brain"><BrainTab candidates={candidatesQ.data?.brain ?? []} /></TabsContent>
          <TabsContent value="replay"><ReplayTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="recorded"><RecordedCallsTab active={tab === "recorded"} onOpenReplay={() => setTab("replay")} /></TabsContent>
          <TabsContent value="pipeline"><CandidatePipelineTab active={tab === "pipeline"} /></TabsContent>
          <TabsContent value="goalreturn"><GoalReturnTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: pull latest completed run by type + latest availability map
// ---------------------------------------------------------------------------

function useRuns(refetch = true) {
  const runsQ = useAuthedQuery<BenchmarkRun[]>([BASE, "runs"], true, false);
  const anyRunning = (runsQ.data ?? []).some((r) => r.status === "running");
  // Re-arm poll while something is running.
  const runsPollQ = useAuthedQuery<BenchmarkRun[]>([BASE, "runs"], refetch, anyRunning ? 3000 : false);
  return runsPollQ.data ? runsPollQ : runsQ;
}

function latestByType(runs: BenchmarkRun[], type: BenchmarkRun["runType"], completedOnly = false): BenchmarkRun | undefined {
  return runs.find((r) => r.runType === type && (!completedOnly || r.status === "completed"));
}

function availabilityMap(runs: BenchmarkRun[], side: "ears" | "brain"): Record<string, AvailabilityResult> {
  const map: Record<string, AvailabilityResult> = {};
  // Find newest run (any type) that carries availability for this side.
  for (const r of runs) {
    const arr = r.availability?.[side];
    if (arr && arr.length) {
      for (const a of arr) if (!map[a.candidateId]) map[a.candidateId] = a;
      break;
    }
  }
  return map;
}

// ===========================================================================
// EARS TAB
// ===========================================================================

function EarsTab({ candidates }: { candidates: EarsCandidate[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const availQ = useAuthedQuery<Fixture[]>([BASE, "fixtures"], !!token);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editFixtureId, setEditFixtureId] = useState<string | null>(null);

  const availMap = availabilityMap(runs, "ears");
  const latestEarsMeta = latestByType(runs, "ears", true);
  const earsFullQ = useAuthedQuery<BenchmarkRun>([BASE, "runs", latestEarsMeta?.id], !!latestEarsMeta?.id);
  const latestEars = earsFullQ.data ?? latestEarsMeta;
  const scorecardRows: EarsScorecardRow[] =
    Array.isArray(latestEars?.scorecard) ? (latestEars!.scorecard as EarsScorecardRow[]) : [];
  const notes: string[] = latestEars?.results?.notes ?? [];

  const fixtures = availQ.data ?? [];
  const withAudio = fixtures.filter((f) => !!f.audioBase64);

  const post = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BASE, "runs"] });
      toast({ title: "Запущено", description: "Проверьте статус в History / обновится автоматически." });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // Realtime shortlist control run: only realtime candidates (no batch
  // ceiling, no optional externals) on one fixture; saved to history.
  const runRealtime = useMutation({
    mutationFn: async (fixtureId: string) => {
      const res = await fetch(`${BASE}/ears/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureIds: [fixtureId], realtimeOnly: true }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BASE, "runs"] });
      toast({ title: "Realtime-прогон запущен", description: "Только realtime-кандидаты; результат появится в History и в отчёте." });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => post.mutate("/availability")} disabled={post.isPending}
          className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-run-availability">
          Run availability check
        </Button>
        <Button onClick={() => post.mutate("/ears/run")} disabled={post.isPending}
          className="bg-purple-600 hover:bg-purple-700" data-testid="button-run-ears">
          Run EARS benchmark
        </Button>
        <Button onClick={() => setUploadOpen(true)} variant="outline" data-testid="button-open-upload">
          Upload fixture
        </Button>
        <Button onClick={() => setImportOpen(true)} variant="outline" data-testid="button-open-import">
          Импортировать запись звонка
        </Button>
      </div>

      {/* Candidate matrix */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader><CardTitle className="text-base">Candidate matrix (EARS)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800">
                <TableHead>Candidate</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c) => {
                const a = availMap[c.id];
                return (
                  <TableRow key={c.id} className="border-gray-800" data-testid={`row-ears-candidate-${c.id}`}>
                    <TableCell className="font-medium max-w-xs">{c.label}<div className="text-xs text-gray-500 font-mono">{c.id}</div></TableCell>
                    <TableCell>{c.provider}</TableCell>
                    <TableCell>{c.kind}</TableCell>
                    <TableCell className="space-x-1">
                      {c.referenceOnly && <Badge variant="outline" className="text-amber-400 border-amber-600">reference-only</Badge>}
                      {c.optional && <Badge variant="outline" className="text-gray-400 border-gray-600">optional</Badge>}
                    </TableCell>
                    <TableCell><AvailabilityBadge status={a?.status} /></TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-md truncate" title={a?.detail}>{a?.detail ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Fixtures */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader><CardTitle className="text-base">Fixtures (corpus)</CardTitle></CardHeader>
        <CardContent>
          {withAudio.length === 0 && (
            <div className="mb-4 rounded border border-amber-700 bg-amber-950/30 px-4 py-3 text-amber-300 text-sm" data-testid="callout-no-audio">
              ⚠ No real audio fixtures yet — EARS benchmark needs an audio fixture. Upload one above.
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800">
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Turns</TableHead>
                <TableHead>Audio</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fixtures.map((f) => (
                <TableRow key={f.id} className="border-gray-800" data-testid={`row-fixture-${f.id}`}>
                  <TableCell className="font-medium">{f.title}</TableCell>
                  <TableCell>{f.kind}</TableCell>
                  <TableCell>{f.referenceTurns?.length ?? 0}</TableCell>
                  <TableCell>
                    {f.audioBase64
                      ? <Badge className="bg-green-600 hover:bg-green-600">{String(f.audioBase64)}</Badge>
                      : <Badge variant="outline" className="text-gray-500 border-gray-700">no audio</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{f.audioFormat ?? "—"}{f.audioChannels ? ` / ${f.audioChannels}` : ""}</TableCell>
                  <TableCell className="text-xs text-gray-400">{(f.tags ?? []).join(", ") || "—"}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => setEditFixtureId(f.id)} data-testid={`button-edit-reference-${f.id}`}>
                      Edit reference
                    </Button>
                    {f.audioBase64 && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-purple-300"
                        onClick={() => runRealtime.mutate(f.id)} disabled={runRealtime.isPending}
                        data-testid={`button-run-realtime-${f.id}`}>
                        Run realtime EARS
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {fixtures.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-gray-500 py-6">No fixtures.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Scorecard */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader>
          <CardTitle className="text-base">
            Latest completed EARS scorecard
            {latestEars && <span className="text-xs text-gray-500 ml-2 font-normal">{fmtTime(latestEars.finishedAt)} · {latestEars.corpusHash}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scorecardRows.length === 0 ? (
            <p className="text-gray-500 text-sm">No completed EARS run yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>STT</TableHead>
                    <TableHead>LIVE?</TableHead>
                    <TableHead>Semantic</TableHead>
                    <TableHead>WER</TableHead>
                    <TableHead className="text-cyan-400">Owner WER</TableHead>
                    <TableHead>Guest WER</TableHead>
                    <TableHead>Numbers/Money</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead>Role split</TableHead>
                    <TableHead>Premature EOT</TableHead>
                    <TableHead>False wait</TableHead>
                    <TableHead>EOT p50</TableHead>
                    <TableHead>Final p50</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scorecardRows.map((r) => (
                    <TableRow key={r.candidateId} className="border-gray-800" data-testid={`row-ears-score-${r.candidateId}`}>
                      <TableCell className="font-medium max-w-xs">{r.label ?? r.candidateId}</TableCell>
                      <TableCell>
                        {r.referenceOnly
                          ? <Badge variant="outline" className="text-amber-400 border-amber-700">ceiling</Badge>
                          : <Badge className="bg-green-700 hover:bg-green-700">LIVE</Badge>}
                      </TableCell>
                      <TableCell>{pct(r.semantic)}{r.semanticIsProxy && <span className="text-xs text-gray-500"> (proxy)</span>}</TableCell>
                      <TableCell>{pct(r.wer)}</TableCell>
                      <TableCell className="text-cyan-300">{pct(r.ownerWer ?? null)}</TableCell>
                      <TableCell>{pct(r.guestWer ?? null)}</TableCell>
                      <TableCell>{pct(r.numbersMoney)}</TableCell>
                      <TableCell>{pct(r.terms ?? null)}</TableCell>
                      <TableCell>{pct(r.roleSplit)}</TableCell>
                      <TableCell>{pct(r.prematureEot)}</TableCell>
                      <TableCell>{pct(r.falseWait)}</TableCell>
                      <TableCell>{ms(r.eotP50)}</TableCell>
                      <TableCell>{ms(r.finalP50)}</TableCell>
                      <TableCell>{usd(r.costEstimate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {notes.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-300 mb-1">Notes</p>
              <ul className="list-disc list-inside text-xs text-gray-400 space-y-1">
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* EARS run report (Best STT for Owner / Guest, accuracy ceiling) */}
      {typeof latestEars?.report === "string" && latestEars.report && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader><CardTitle className="text-base">EARS run report</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono" data-testid="text-ears-report">{latestEars.report}</pre>
          </CardContent>
        </Card>
      )}

      <UploadFixtureDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <ImportRecordingDialog open={importOpen} onOpenChange={setImportOpen} />
      <EditReferenceDialog fixtureId={editFixtureId} onClose={() => setEditFixtureId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit reference transcript of an existing fixture (Owner/Guest, terms,
// channel-role mapping). The production transcript is never ground truth —
// the admin listens to the recording and fixes the reference by hand.
// ---------------------------------------------------------------------------

function EditReferenceDialog({ fixtureId, onClose }: { fixtureId: string | null; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [transcript, setTranscript] = useState("");
  const [terms, setTerms] = useState("");
  const [swapChannels, setSwapChannels] = useState(false);
  const [loaded, setLoaded] = useState<{ title: string; channelRoles: string[]; hasAudio: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Per-turn verification state
  interface RefTurn { idx: number; role: "owner" | "guest"; text: string; verified?: boolean; tEndMs?: number; tStartMs?: number }
  const [turns, setTurns] = useState<RefTurn[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [divergence, setDivergence] = useState<Record<number, { disagreement: number; maxWerVsRef: number | null }>>({});

  async function reload() {
    if (!fixtureId || !token) return;
    const res = await fetch(`${BASE}/fixtures/${fixtureId}/reference`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json();
    setTurns((data.referenceTurns ?? []) as RefTurn[]);
    setDrafts({});
    setTranscript((data.referenceTurns ?? []).map((t: ParsedTurn) => `${t.role}: ${t.text}`).join("\n"));
    setTerms(((data.criticalEntities?.terms ?? []) as string[]).join(", "));
    setSwapChannels(Array.isArray(data.channelRoles) && data.channelRoles[0] === "guest");
    setLoaded({ title: data.title, channelRoles: data.channelRoles ?? ["owner", "guest"], hasAudio: !!data.hasAudio });
  }

  useEffect(() => {
    if (!fixtureId || !token) { setLoaded(null); setTurns([]); setDivergence({}); return; }
    (async () => {
      try {
        await reload();
        // Disputed-turn highlighting from the latest completed EARS run (best-effort).
        try {
          const res = await fetch(`${BASE}/fixtures/${fixtureId}/turn-divergence`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const d = await res.json();
            const map: Record<number, { disagreement: number; maxWerVsRef: number | null }> = {};
            for (const t of d.turns ?? []) map[t.idx] = { disagreement: t.disagreement, maxWerVsRef: t.maxWerVsRef };
            setDivergence(map);
          }
        } catch { /* highlighting is optional */ }
      } catch (e: any) {
        toast({ title: "Не удалось загрузить reference", description: String(e?.message ?? e), variant: "destructive" });
        onClose();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, token]);

  async function playTurn(idx: number) {
    if (!fixtureId) return;
    try {
      setPlayingIdx(idx);
      const res = await fetch(`${BASE}/fixtures/${fixtureId}/turn-audio/${idx}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPlayingIdx((v) => (v === idx ? null : v)); };
      audio.onerror = () => { URL.revokeObjectURL(url); setPlayingIdx((v) => (v === idx ? null : v)); };
      await audio.play();
    } catch (e: any) {
      setPlayingIdx(null);
      toast({ title: "Не удалось проиграть реплику", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function saveTurn(idx: number, patch: { text?: string; verified?: boolean }) {
    if (!fixtureId) return;
    setSavingIdx(idx);
    try {
      const res = await fetch(`${BASE}/fixtures/${fixtureId}/reference/turns/${idx}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      setTurns((prev) => prev.map((t) => (t.idx === idx ? { ...t, ...data.turn } : t)));
      setDrafts((d) => { const n = { ...d }; delete n[idx]; return n; });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
    } catch (e: any) {
      toast({ title: "Не сохранилось", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSavingIdx(null);
    }
  }

  const ownerTurns = turns.filter((t) => t.role === "owner");
  const ownerVerified = ownerTurns.filter((t) => t.verified === true).length;
  // "Disputed": top divergence among owner turns — listen to these first.
  const disputedCut = 0.15;

  async function submit() {
    if (!fixtureId) return;
    let referenceTurns: ParsedTurn[];
    try {
      referenceTurns = parseTranscript(transcript);
    } catch (e: any) {
      toast({ title: "Проверьте транскрипт", description: String(e?.message ?? e), variant: "destructive" });
      return;
    }
    if (referenceTurns.length === 0) {
      toast({ title: "Транскрипт пуст", description: "Нужна хотя бы одна строка owner:/guest:", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/fixtures/${fixtureId}/reference`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceTurns,
          terms: terms.split(",").map((t) => t.trim()).filter(Boolean),
          channelRoles: swapChannels ? ["guest", "owner"] : ["owner", "guest"],
          confirmDestructive,
        }),
      });
      if (res.status === 409) {
        toast({
          title: "Структура реплик изменилась",
          description: "Bulk-сохранение уничтожит тайминги и verified-флаги. Отметьте «подтверждаю сброс», если это намеренно, или правьте реплики по одной.",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      toast({ title: "Reference сохранён", description: "Новая версия reference transcript зафиксирована." });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!fixtureId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit reference transcript{loaded ? ` — ${loaded.title}` : ""}</DialogTitle>
          {ownerTurns.length > 0 && (
            <DialogDescription className="text-gray-400" data-testid="text-owner-verify-progress">
              Human-verify прогресс: <span className={ownerVerified === ownerTurns.length ? "text-green-400" : "text-amber-300"}>
                {ownerVerified}/{ownerTurns.length} owner turns verified
              </span>
              {Object.keys(divergence).length > 0 && " · оранжевым — «спорные» реплики (кандидаты сильнее всего расходятся): слушать в первую очередь"}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={bulkMode} onChange={(e) => setBulkMode(e.target.checked)} data-testid="checkbox-bulk-mode" />
            Bulk-режим (весь транскрипт одним текстом; сбрасывает тайминги и verified — только для полного перепечатывания)
          </label>

          {!bulkMode && (
            <div className="space-y-2" data-testid="list-reference-turns">
              {turns.map((t) => {
                const div = divergence[t.idx];
                const disputed = t.role === "owner" && !!div && (div.disagreement >= disputedCut || (div.maxWerVsRef ?? 0) >= disputedCut);
                const draft = drafts[t.idx];
                const dirty = draft !== undefined && draft !== t.text;
                return (
                  <div key={t.idx}
                    className={`rounded border px-3 py-2 ${disputed ? "border-amber-600 bg-amber-950/20" : "border-gray-800 bg-gray-950/40"} ${t.role === "guest" ? "opacity-70" : ""}`}
                    data-testid={`row-turn-${t.idx}`}>
                    <div className="flex items-center gap-2 mb-1 text-xs">
                      <Badge variant="outline" className={t.role === "owner" ? "text-cyan-300 border-cyan-700" : "text-gray-400 border-gray-700"}>
                        #{t.idx} {t.role}
                      </Badge>
                      {disputed && <Badge className="bg-amber-600 hover:bg-amber-600">спорная · max WER {div ? (Math.max(div.disagreement, div.maxWerVsRef ?? 0) * 100).toFixed(0) : "?"}%</Badge>}
                      {t.role === "owner" && (t.verified
                        ? <Badge className="bg-green-700 hover:bg-green-700" data-testid={`badge-verified-${t.idx}`}>verified</Badge>
                        : <Badge variant="outline" className="text-gray-500 border-gray-700">не проверено</Badge>)}
                      <div className="flex-1" />
                      {loaded?.hasAudio && typeof t.tEndMs === "number" && (
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs"
                          onClick={() => playTurn(t.idx)} disabled={playingIdx === t.idx}
                          data-testid={`button-play-turn-${t.idx}`}>
                          {playingIdx === t.idx ? "▶ играет…" : "▶ слушать"}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <Textarea rows={2} value={draft ?? t.text}
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.idx]: e.target.value }))}
                        className="bg-gray-950 border-gray-700 font-mono text-xs flex-1"
                        data-testid={`input-turn-text-${t.idx}`} />
                      <div className="flex flex-col gap-1 shrink-0">
                        {dirty && (
                          <Button size="sm" className="h-6 px-2 text-xs bg-cyan-600 hover:bg-cyan-700"
                            onClick={() => saveTurn(t.idx, { text: draft })} disabled={savingIdx === t.idx}
                            data-testid={`button-save-turn-${t.idx}`}>
                            Сохранить
                          </Button>
                        )}
                        {t.role === "owner" && !dirty && (
                          <Button size="sm" variant={t.verified ? "outline" : "default"}
                            className={`h-6 px-2 text-xs ${t.verified ? "" : "bg-green-700 hover:bg-green-800"}`}
                            onClick={() => saveTurn(t.idx, { verified: !t.verified })} disabled={savingIdx === t.idx}
                            data-testid={`button-verify-turn-${t.idx}`}>
                            {t.verified ? "снять verified" : "✓ verified"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {turns.length === 0 && <p className="text-gray-500 text-sm">Нет реплик.</p>}
            </div>
          )}

          {bulkMode && (
          <div>
            <Label className="text-gray-300">Reference transcript (одна строка = один ход, «owner: …» / «guest: …»)</Label>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={14}
              className="bg-gray-950 border-gray-700 font-mono text-xs" data-testid="input-edit-reference-transcript" />
          </div>
          )}
          {bulkMode && (
          <>
          <div>
            <Label className="text-gray-300">Domain terms (через запятую: eSIM, SMS code, port-in …)</Label>
            <Input value={terms} onChange={(e) => setTerms(e.target.value)}
              className="bg-gray-950 border-gray-700" data-testid="input-edit-reference-terms" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={swapChannels} onChange={(e) => setSwapChannels(e.target.checked)}
              data-testid="checkbox-swap-channels" />
            Поменять каналы местами (канал 0 = Guest, канал 1 = Owner)
          </label>
          <label className="flex items-center gap-2 text-sm text-red-300">
            <input type="checkbox" checked={confirmDestructive} onChange={(e) => setConfirmDestructive(e.target.checked)}
              data-testid="checkbox-confirm-destructive" />
            Подтверждаю сброс таймингов и verified-флагов (только при изменении структуры реплик)
          </label>
          </>
          )}
        </div>
        <DialogFooter>
          {bulkMode ? (
            <Button onClick={submit} disabled={submitting || !loaded} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-save-reference">
              {submitting ? "Saving…" : "Save reference (bulk)"}
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose} data-testid="button-close-reference">Готово</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upload fixture dialog
// ---------------------------------------------------------------------------

function UploadFixtureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("bank_dispute");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<"mulaw8k" | "wav" | "mp3">("wav");
  const [channels, setChannels] = useState<"mono" | "dual">("mono");
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function readAsBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });
  }

  async function submit() {
    if (!title.trim()) {
      toast({ title: "title required", variant: "destructive" });
      return;
    }
    let referenceTurns: ParsedTurn[] = [];
    if (file) {
      try {
        referenceTurns = parseTranscript(transcript);
      } catch (e: any) {
        toast({ title: "Проверьте транскрипт", description: String(e?.message ?? e), variant: "destructive" });
        return;
      }
    } else if (transcript.trim()) {
      try { referenceTurns = parseTranscript(transcript); }
      catch (e: any) {
        toast({ title: "Проверьте транскрипт", description: String(e?.message ?? e), variant: "destructive" });
        return;
      }
    }
    setSubmitting(true);
    try {
      const body: any = {
        title: title.trim(),
        kind,
        goal: goal.trim(),
        referenceTurns,
        criticalEntities: {},
        confirmedFacts: [],
        tags: [],
      };
      if (file) {
        body.audioBase64 = await readAsBase64(file);
        body.audioFormat = format;
        body.audioChannels = channels;
      }
      const res = await fetch(`${BASE}/fixtures`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      toast({ title: "Fixture создан" });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
      onOpenChange(false);
      setTitle(""); setGoal(""); setFile(null); setTranscript("");
    } catch (e: any) {
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload fixture</DialogTitle>
          <DialogDescription className="text-gray-400">
            Добавить запись в корпус. Audio (optional) для EARS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-gray-950 border-gray-700" data-testid="input-fixture-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="bg-gray-950 border-gray-700" data-testid="select-fixture-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bank_dispute", "doctor", "insurance", "ivr_heavy", "accent", "overlap", "other"].map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Goal</Label>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)}
                className="bg-gray-950 border-gray-700" data-testid="input-fixture-goal" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Audio file (optional)</Label>
            <Input type="file" accept="audio/*,.ulaw,.raw"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="bg-gray-950 border-gray-700" data-testid="input-fixture-audio" />
          </div>
          {file && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as any)}>
                  <SelectTrigger className="bg-gray-950 border-gray-700" data-testid="select-fixture-format"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mulaw8k">mulaw8k</SelectItem>
                    <SelectItem value="wav">wav</SelectItem>
                    <SelectItem value="mp3">mp3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Channels</Label>
                <Select value={channels} onValueChange={(v) => setChannels(v as any)}>
                  <SelectTrigger className="bg-gray-950 border-gray-700" data-testid="select-fixture-channels"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mono">mono</SelectItem>
                    <SelectItem value="dual">dual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>
              Transcript {file ? <span className="text-red-400">*</span> : <span className="text-gray-500 text-xs">(optional без аудио)</span>}
            </Label>
            <p className="text-xs text-gray-500">
              JSON-массив {`{idx, role, text}`} или строки «guest: Hello» / «owner: Hi». Обязателен для аудио-фикстуры (EARS сверяет точность по нему).
            </p>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
              rows={6} placeholder={"guest: Hello, I'd like to dispute a charge\nowner: Sure, what's the amount?"}
              className="bg-gray-950 border-gray-700 font-mono text-xs" data-testid="input-fixture-transcript" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-submit-fixture">
            {submitting ? "Uploading…" : "Create fixture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Import recording dialog (Twilio benchmark recording -> wav fixture)
// ---------------------------------------------------------------------------

function ImportRecordingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [callSid, setCallSid] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!callSid.trim()) {
      toast({ title: "callSid required", variant: "destructive" });
      return;
    }
    let referenceTurns: ParsedTurn[];
    try {
      referenceTurns = parseTranscript(transcript);
    } catch (e: any) {
      toast({ title: "Проверьте транскрипт", description: String(e?.message ?? e), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/fixtures/import-recording`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          callSid: callSid.trim(),
          title: title.trim() || undefined,
          goal: goal.trim() || undefined,
          referenceTurns,
        }),
      });
      if (res.status === 404) {
        toast({
          title: "Запись не найдена",
          description: "Для этого звонка нет benchmark-записи. Убедитесь, что звонок был сделан с BENCHMARK_CALL_RECORDING=1.",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      toast({ title: "Запись импортирована", description: "Fixture создан из записи звонка." });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
      onOpenChange(false);
      setCallSid(""); setTitle(""); setGoal(""); setTranscript("");
    } catch (e: any) {
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>Импортировать запись звонка</DialogTitle>
          <DialogDescription className="text-gray-400">
            Скачивает dual-channel запись из Twilio (звонок с BENCHMARK_CALL_RECORDING=1) и сохраняет как wav-фикстуру.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Call SID <span className="text-red-400">*</span></Label>
            <Input value={callSid} onChange={(e) => setCallSid(e.target.value)}
              placeholder="CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="bg-gray-950 border-gray-700 font-mono" data-testid="input-import-callsid" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title <span className="text-gray-500 text-xs">(optional)</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                className="bg-gray-950 border-gray-700" data-testid="input-import-title" />
            </div>
            <div className="space-y-1">
              <Label>Goal <span className="text-gray-500 text-xs">(optional)</span></Label>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)}
                className="bg-gray-950 border-gray-700" data-testid="input-import-goal" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Transcript <span className="text-red-400">*</span></Label>
            <p className="text-xs text-gray-500">
              JSON-массив {`{idx, role, text}`} или строки «guest: Hello» / «owner: Hi». Обязателен (EARS сверяет точность по нему).
            </p>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
              rows={6} placeholder={"guest: Hello, I'd like to dispute a charge\nowner: Sure, what's the amount?"}
              className="bg-gray-950 border-gray-700 font-mono text-xs" data-testid="input-import-transcript" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-submit-import">
            {submitting ? "Импорт…" : "Импортировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// BRAIN TAB
// ===========================================================================

function BrainTab({ candidates }: { candidates: BrainCandidate[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const [judgeEnabled, setJudgeEnabled] = useState(true);

  const latestBrainMeta = latestByType(runs, "brain", true);
  // fetch full run for details (turnResults, continuity)
  const fullQ = useAuthedQuery<BenchmarkRun>([BASE, "runs", latestBrainMeta?.id], !!latestBrainMeta?.id);
  const run = fullQ.data;

  const labelById = useMemo(() => {
    const m: Record<string, string> = {};
    candidates.forEach((c) => { m[c.id] = c.label; });
    return m;
  }, [candidates]);

  const scorecard = run?.scorecard as BrainScorecard | undefined;
  const scorecardRows: BrainScorecardEntry[] = scorecard?.candidates ?? [];
  const notes: string[] = run?.results?.notes ?? [];
  const judgeModel = run?.results?.judgeModel;

  const continuityEntries: [string, ContinuityMetrics][] = useMemo(() => {
    const c = run?.results?.continuity;
    if (!c) return [];
    return Object.entries(c);
  }, [run]);

  const turnResults = (run?.results?.turnResults ?? []) as BrainTurnResult[];

  const post = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/brain/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ judgeEnabled }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BASE, "runs"] });
      toast({ title: "BRAIN benchmark запущен" });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={() => post.mutate()} disabled={post.isPending}
          className="bg-purple-600 hover:bg-purple-700" data-testid="button-run-brain">
          Запустить BRAIN benchmark (Gold Call)
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={judgeEnabled} onCheckedChange={setJudgeEnabled} data-testid="switch-judge" />
          Judge enabled
        </label>
      </div>

      {/* Scorecard */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader>
          <CardTitle className="text-base">
            Latest completed BRAIN scorecard
            {latestBrainMeta && <span className="text-xs text-gray-500 ml-2 font-normal">{fmtTime(latestBrainMeta.finishedAt)} · prompt {latestBrainMeta.promptVersion}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scorecardRows.length === 0 ? (
            <p className="text-gray-500 text-sm">No completed BRAIN run yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>LLM</TableHead>
                    <TableHead title="Понял текущую реплику Guest">Понял ход</TableHead>
                    <TableHead title="Помнит цель звонка">Цель</TableHead>
                    <TableHead title="Помнит, что уже пробовали">Помнит попытки</TableHead>
                    <TableHead title="Не повторяет отвергнутую стратегию">Не повторяет</TableHead>
                    <TableHead title="Выбирает правильный следующий ход">След. ход</TableHead>
                    <TableHead>Natural EN</TableHead>
                    <TableHead className="text-cyan-400">Overall</TableHead>
                    <TableHead>First token avg</TableHead>
                    <TableHead>Ready avg</TableHead>
                    <TableHead>Cost/call</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scorecardRows.map((r) => {
                    const selfJudged = !!judgeModel && r.model === judgeModel;
                    const j = r.judgeAverages;
                    return (
                      <TableRow key={r.candidateId} className="border-gray-800" data-testid={`row-brain-score-${r.candidateId}`}>
                        <TableCell className="font-medium max-w-xs">
                          {labelById[r.candidateId] ?? r.model ?? r.candidateId}
                          {selfJudged && <Badge variant="outline" className="ml-2 text-amber-400 border-amber-600">self-judged</Badge>}
                        </TableCell>
                        <TableCell>{num(j?.understood_current_turn ?? null, 1)}</TableCell>
                        <TableCell>{num(j?.goal_memory ?? null, 1)}</TableCell>
                        <TableCell>{num(j?.tried_memory ?? null, 1)}</TableCell>
                        <TableCell>{num(j?.avoids_rejected_strategy ?? null, 1)}</TableCell>
                        <TableCell>{num(j?.next_move_quality ?? null, 1)}</TableCell>
                        <TableCell>{num(j?.reply_naturalness_en ?? null, 1)}</TableCell>
                        <TableCell className="text-cyan-300">{num(j?.overall_live_copilot_quality ?? null, 1)}</TableCell>
                        <TableCell>{ms(r.avgFirstTokenMs)}</TableCell>
                        <TableCell>{ms(r.avgReadyMs)}</TableCell>
                        <TableCell>
                          {r.estCostPer10MinCall !== null
                            ? usd(r.estCostPer10MinCall)
                            : <span className="text-gray-500 text-xs" title={r.costNote ?? undefined}>{r.costNote ?? "—"}</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deadline buckets */}
      {scorecardRows.length > 0 && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader><CardTitle className="text-base">Hint deadline buckets (% rendered within)</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead>Candidate</TableHead>
                  {DEADLINE_KEYS.map((k) => <TableHead key={k}>{k.replace("<=", "≤")}ms</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scorecardRows.map((r) => (
                  <TableRow key={r.candidateId} className="border-gray-800" data-testid={`row-deadline-${r.candidateId}`}>
                    <TableCell className="font-medium">{labelById[r.candidateId] ?? r.model ?? r.candidateId}</TableCell>
                    {DEADLINE_KEYS.map((k) => {
                      const b = r.deadlineBuckets?.[k];
                      return (
                        <TableCell key={k}>
                          {b ? `${b.pct.toFixed(1)}%` : "—"}
                          {b && <span className="text-xs text-gray-500"> ({b.count})</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Continuity */}
      {continuityEntries.length > 0 && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader><CardTitle className="text-base">Hint chain continuity</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead>Candidate</TableHead>
                  <TableHead>Eligible turns</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>WS sent</TableHead>
                  <TableHead>Rendered</TableHead>
                  <TableHead>Missed</TableHead>
                  <TableHead>Max consec. missed</TableHead>
                  <TableHead>Miss stages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {continuityEntries.map(([cid, c]) => (
                  <ContinuityRow key={cid} candidateId={labelById[cid] ?? cid} c={c} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Per-turn */}
      {turnResults.length > 0 && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader><CardTitle className="text-base">Per-turn detail</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead>#</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>AI understood</TableHead>
                  <TableHead>Suggested reply</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Judge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {turnResults.map((t, i) => {
                  const overall = t.judge?.scores?.overall_live_copilot_quality ?? null;
                  const jx = (t.judge as any)?.explanations as Record<string, string> | undefined;
                  const chainTip = jx
                    ? Object.entries(jx).map(([k, v]) => `${k}: ${(t.judge?.scores as any)?.[k] ?? "—"} — ${v}`).join("\n")
                    : (t.judge as any)?.rationale;
                  return (
                    <TableRow key={`${t.candidateId}-${t.turnIdx}-${i}`} className="border-gray-800" data-testid={`row-turn-${t.candidateId}-${t.turnIdx}`}>
                      <TableCell>{t.turnIdx}</TableCell>
                      <TableCell className="text-xs font-mono">{t.candidateId}</TableCell>
                      <TableCell className="max-w-xs text-xs text-gray-300">
                        {t.output?.current_topic ?? "—"}
                        {t.output?.goal_status && <span className="text-gray-500"> · {t.output.goal_status}</span>}
                      </TableCell>
                      <TableCell className="max-w-sm text-xs">{t.output?.should_suggest ? (t.output?.suggested_reply ?? "—") : <span className="text-gray-500">(no suggest)</span>}</TableCell>
                      <TableCell>{t.output?.strategy ? <Badge variant="outline" className="border-cyan-700 text-cyan-300">{t.output.strategy}</Badge> : "—"}</TableCell>
                      <TableCell>{ms(t.suggestionReadyAfterGuestEndMs)}</TableCell>
                      <TableCell title={chainTip || undefined} className={chainTip ? "cursor-help" : undefined}>
                        {overall !== null ? num(overall, 1) : "—"}
                        {t.judge?.selfJudged && <Badge variant="outline" className="ml-1 text-amber-400 border-amber-600">self</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {notes.length > 0 && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-xs text-gray-400 space-y-1">
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContinuityRow({ candidateId, c }: { candidateId: string; c: ContinuityMetrics }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="border-gray-800" data-testid={`row-continuity-${candidateId}`}>
        <TableCell className="font-medium">{candidateId}</TableCell>
        <TableCell>{c.eligibleGuestTurns}</TableCell>
        <TableCell>{c.hintsRequested}</TableCell>
        <TableCell>{c.hintsGenerated}</TableCell>
        <TableCell>{c.hintsWsSent}</TableCell>
        <TableCell>{c.hintsClientRendered}</TableCell>
        <TableCell className={c.hintsMissed > 0 ? "text-red-400" : ""}>{c.hintsMissed}</TableCell>
        <TableCell>{c.maxConsecutiveMissedHints}</TableCell>
        <TableCell>
          {c.misses?.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen((v) => !v)} data-testid={`button-toggle-misses-${candidateId}`}>
              {open ? "hide" : `${c.misses.length} misses`}
            </Button>
          ) : "—"}
        </TableCell>
      </TableRow>
      {open && c.misses?.map((m, i) => (
        <TableRow key={i} className="border-gray-800 bg-gray-950/50">
          <TableCell colSpan={9} className="text-xs text-gray-400">
            turn {m.turnIdx} · stage <span className="text-amber-400">{m.stage}</span> · {m.reason}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ===========================================================================
// REPLAY TAB
// ===========================================================================

function ReplayTab() {
  const { token } = useAuth();
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const brainRuns = runs.filter((r) => r.runType === "brain" && r.status === "completed");
  const [runId, setRunId] = useState<string>("");
  const [candidateId, setCandidateId] = useState<string>("");

  const candidatesQ = useAuthedQuery<{ brain: BrainCandidate[] }>([BASE, "candidates"], !!token);
  const brainCandidates = candidatesQ.data?.brain ?? [];

  const replayQ = useAuthedQuery<ReplayData>(
    [BASE, "runs", runId, "replay", candidateId],
    !!runId && !!candidateId,
  );
  const replay = replayQ.data;

  const STAGES: [keyof ReplayTurn["timestamps"], string][] = [
    ["audioEnd", "audio end"],
    ["sttFinal", "STT final"],
    ["hintTrigger", "hint trigger"],
    ["llmFirstToken", "LLM first token"],
    ["suggestionReady", "suggestion ready"],
    ["wsSent", "WS sent"],
    ["clientRendered", "client rendered"],
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-gray-900/50 border-gray-800">
        <CardContent className="py-4 flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label>Completed BRAIN run</Label>
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger className="bg-gray-950 border-gray-700 w-72" data-testid="select-replay-run"><SelectValue placeholder="Pick a run" /></SelectTrigger>
              <SelectContent>
                {brainRuns.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{fmtTime(r.finishedAt)} · {r.corpusHash?.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Candidate</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger className="bg-gray-950 border-gray-700 w-72" data-testid="select-replay-candidate"><SelectValue placeholder="Pick a candidate" /></SelectTrigger>
              <SelectContent>
                {brainCandidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {brainRuns.length === 0 && <p className="text-gray-500 text-sm">No completed BRAIN runs to replay.</p>}

      {replay && (
        <>
          <div className="text-xs text-gray-500">
            Estimated stages: {replay.estimatedStages.join(" · ")}
          </div>
          <div className="space-y-3">
            {replay.turns.map((t) => (
              <Card key={t.turnIdx} className="bg-gray-900/50 border-gray-800" data-testid={`card-replay-turn-${t.turnIdx}`}>
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={t.role === "guest" ? "secondary" : "outline"}>{t.role}</Badge>
                      <span className="text-xs text-gray-500">turn {t.turnIdx}</span>
                      {t.strategy && <Badge variant="outline" className="border-cyan-700 text-cyan-300">{t.strategy}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {t.latencyMs !== null && <span className="text-gray-400">latency {ms(t.latencyMs)}</span>}
                      {t.judgeScore !== null && <span className="text-amber-300">judge {num(t.judgeScore, 1)}</span>}
                    </div>
                  </div>
                  <p className="text-sm text-gray-200"><span className="text-gray-500">said:</span> {t.said}</p>
                  {t.aiState && <p className="text-xs text-gray-400"><span className="text-gray-500">AI state:</span> {t.aiState}</p>}
                  {t.suggestedReply && <p className="text-sm text-cyan-200"><span className="text-gray-500">suggested:</span> {t.suggestedReply}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {STAGES.map(([key, label]) => {
                      const v = t.timestamps[key];
                      return (
                        <span key={key} className={`text-[10px] px-2 py-0.5 rounded border ${v !== undefined ? "border-gray-700 text-gray-300" : "border-gray-800 text-gray-600"}`}>
                          {label}: {v !== undefined ? `+${Math.round(v)}ms` : "—"}
                        </span>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
            {replay.turns.length === 0 && <p className="text-gray-500 text-sm">No turns for this candidate.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// HISTORY TAB
// ===========================================================================

function winnerSummary(run: BenchmarkRun): string {
  const sc = run.scorecard;
  if (!sc) return "—";
  if (run.runType === "ears") {
    const rows: EarsScorecardRow[] = Array.isArray(sc) ? sc : [];
    const best = [...rows].filter((r) => r.wer != null).sort((a, b) => (a.wer as number) - (b.wer as number))[0];
    return best ? `best WER: ${best.label ?? best.candidateId}` : "—";
  }
  if (run.runType === "brain") {
    const rows: BrainScorecardEntry[] = (sc as BrainScorecard)?.candidates ?? [];
    const scored = rows.filter((r) => r.judgeAverages?.overall_live_copilot_quality != null);
    const best = [...scored].sort((a, b) =>
      (b.judgeAverages!.overall_live_copilot_quality) - (a.judgeAverages!.overall_live_copilot_quality))[0];
    return best ? `top: ${best.model ?? best.candidateId}` : "—";
  }
  return "—";
}

function HistoryTab() {
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const { token } = useAuth();
  const detailQ = useAuthedQuery<BenchmarkRun>([BASE, "runs", selected ?? undefined], !!selected && !!token);
  const detail = detailQ.data;

  return (
    <div className="space-y-4">
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader><CardTitle className="text-base">All runs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800">
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Corpus hash</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead>Winner</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} className="border-gray-800 cursor-pointer hover:bg-gray-800/30"
                  onClick={() => setSelected(r.id)} data-testid={`row-run-${r.id}`}>
                  <TableCell className="text-xs">{fmtTime(r.startedAt)}</TableCell>
                  <TableCell>{r.runType}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-xs font-mono">{r.corpusHash?.slice(0, 12) || "—"}</TableCell>
                  <TableCell className="text-xs">{r.promptVersion ?? "—"}</TableCell>
                  <TableCell className="text-xs text-gray-400">{winnerSummary(r)}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-6 px-2 text-xs">details</Button></TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-gray-500 py-6">No runs yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run details</DialogTitle>
            <DialogDescription className="text-gray-400">
              {detail ? `${detail.runType} · ${fmtTime(detail.startedAt)} · ${detail.status}` : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-500">Corpus:</span> {detail.corpusHash || "—"}</div>
                <div><span className="text-gray-500">Prompt:</span> {detail.promptVersion || "—"}</div>
                <div><span className="text-gray-500">Finished:</span> {fmtTime(detail.finishedAt)}</div>
                <div><span className="text-gray-500">Judge:</span> {detail.results?.judgeModel ?? "—"}</div>
              </div>

              {detail.error && (
                <div className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-red-300 text-xs whitespace-pre-wrap" data-testid="detail-error">
                  {detail.error}
                </div>
              )}

              <div>
                <p className="font-medium text-gray-300 mb-1">Scorecard (raw)</p>
                <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-[11px] overflow-x-auto max-h-64" data-testid="detail-scorecard">
                  {JSON.stringify(detail.scorecard ?? {}, null, 2)}
                </pre>
              </div>

              <div>
                <p className="font-medium text-gray-300 mb-1">Availability</p>
                <div className="space-y-1">
                  {[...(detail.availability?.ears ?? []), ...(detail.availability?.brain ?? [])].map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <AvailabilityBadge status={a.status} />
                      <span className="font-mono">{a.candidateId}</span>
                      <span className="text-gray-500 truncate">{a.detail}</span>
                    </div>
                  ))}
                  {![...(detail.availability?.ears ?? []), ...(detail.availability?.brain ?? [])].length && (
                    <p className="text-gray-500 text-xs">No availability data.</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// RECORDED CALLS TAB
// ===========================================================================

interface RecordedCall {
  id: string;
  callSid: string;
  userEmail: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  direction: string | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  hasTranscript: boolean;
  recordingUrl?: string | null;
  recordingSid?: string | null;
  recordingStatus?: string | null;
  recordingChannels?: number | string | null;
  recordingDurationSecs?: number | null;
  recordingCompletedAt?: string | null;
  recordingPolicyVersion?: string | null;
  diagnosticRecording: boolean;
  fixtureId: string | null;
  isGoldCall: boolean;
  benchmarkStatus: string | null;
}

function fmtDuration(secs?: number | null): string {
  if (secs === null || secs === undefined || Number.isNaN(secs)) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface DiagnosticUser {
  id: string;
  email: string;
  diagnosticRecordingEnabled: boolean;
}

function DiagnosticUsersBlock() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(true);
  const [search, setSearch] = useState("");

  const key = [BASE, "diagnostic-users"];
  const usersQ = useAuthedQuery<DiagnosticUser[]>(key, !!token);
  const users = usersQ.data ?? [];

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`${BASE}/diagnostic-users/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DiagnosticUser[]>(key);
      qc.setQueryData<DiagnosticUser[]>(key, (old) =>
        (old ?? []).map((u) => (u.id === id ? { ...u, diagnosticRecordingEnabled: enabled } : u)));
      return { prev };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const filtered = search.trim()
    ? users.filter((u) => u.email?.toLowerCase().includes(search.trim().toLowerCase()))
    : users;

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)}>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Участники диагностической записи</span>
          <span className="text-xs text-gray-500">{collapsed ? "▸" : "▾"}</span>
        </CardTitle>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email…"
            className="bg-gray-950 border-gray-700 max-w-sm"
            data-testid="input-diag-user-search"
          />
          {usersQ.isLoading ? (
            <p className="text-sm text-gray-500">Загрузка…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500">Участники не найдены.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-800 rounded border border-gray-800">
              {filtered.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2" data-testid={`row-diag-user-${u.id}`}>
                  <span className="text-sm text-gray-200 truncate mr-3">{u.email}</span>
                  <label className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
                    <span>{u.diagnosticRecordingEnabled ? "Запись включена" : "Запись выключена"}</span>
                    <Switch
                      checked={u.diagnosticRecordingEnabled}
                      onCheckedChange={(enabled) => toggle.mutate({ id: u.id, enabled })}
                      data-testid={`switch-diag-user-${u.id}`}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function RecordedCallsTab({ active, onOpenReplay }: { active: boolean; onOpenReplay: () => void }) {
  const listQ = useAuthedQuery<RecordedCall[]>([BASE, "recorded-calls"], true, active ? 10000 : false);
  const calls = listQ.data ?? [];

  const [transcriptFor, setTranscriptFor] = useState<RecordedCall | null>(null);
  const [goldFor, setGoldFor] = useState<RecordedCall | null>(null);
  const [deleteFor, setDeleteFor] = useState<RecordedCall | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <DiagnosticUsersBlock />

      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader><CardTitle className="text-base">Записанные звонки</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {calls.length === 0 ? (
            <div className="text-sm text-gray-400 py-8 text-center" data-testid="recorded-empty">
              Звонки пользователей с включённой диагностикой записываются автоматически и появляются здесь
              после завершения звонка. Пока записей нет.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead>Date/time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Call SID</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Recording</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Transcript</TableHead>
                  <TableHead>Gold</TableHead>
                  <TableHead>Benchmark</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => (
                  <RecordedCallRow
                    key={c.id}
                    call={c}
                    playing={playingId === c.id}
                    onPlayToggle={() => setPlayingId((p) => (p === c.id ? null : c.id))}
                    onTranscript={() => setTranscriptFor(c)}
                    onGold={() => setGoldFor(c)}
                    onDelete={() => setDeleteFor(c)}
                    onOpenReplay={onOpenReplay}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {transcriptFor && (
        <TranscriptDialog call={transcriptFor} onClose={() => setTranscriptFor(null)} />
      )}
      {goldFor && (
        <GoldCallDialog call={goldFor} onClose={() => setGoldFor(null)} />
      )}
      {deleteFor && (
        <DeleteRecordingDialog call={deleteFor} onClose={() => setDeleteFor(null)} />
      )}
    </div>
  );
}

function RecordedCallRow({
  call, playing, onPlayToggle, onTranscript, onGold, onDelete, onOpenReplay,
}: {
  call: RecordedCall;
  playing: boolean;
  onPlayToggle: () => void;
  onTranscript: () => void;
  onGold: () => void;
  onDelete: () => void;
  onOpenReplay: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const runBench = useMutation({
    mutationFn: async (kind: "ears" | "brain") => {
      const url = kind === "ears" ? "/ears/run" : "/brain/run";
      const body = kind === "ears" ? { fixtureIds: [call.fixtureId] } : { fixtureId: call.fixtureId };
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: (_d, kind) => {
      qc.invalidateQueries({ queryKey: [BASE, "runs"] });
      toast({ title: `${kind.toUpperCase()} benchmark запущен` });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const hasFixture = !!call.fixtureId;
  const hasRecording = !!call.recordingSid || !!call.recordingUrl || call.recordingStatus === "completed";

  return (
    <>
      <TableRow className="border-gray-800" data-testid={`row-recorded-${call.id}`}>
        <TableCell className="text-xs">{fmtTime(call.startedAt)}</TableCell>
        <TableCell className="text-xs">{fmtDuration(call.recordingDurationSecs)}</TableCell>
        <TableCell className="text-xs font-mono" title={call.callSid}>{call.callSid?.slice(0, 10) ?? "—"}…</TableCell>
        <TableCell className="text-xs">{call.direction ?? "—"}</TableCell>
        <TableCell className="text-xs">{call.recordingStatus ?? "—"}</TableCell>
        <TableCell className="text-xs">{call.recordingChannels ?? "—"}</TableCell>
        <TableCell>
          {call.hasTranscript
            ? <Badge className="bg-green-600 hover:bg-green-600">yes</Badge>
            : <Badge variant="outline" className="text-gray-500 border-gray-700">no</Badge>}
        </TableCell>
        <TableCell>
          {call.isGoldCall && <Badge className="bg-amber-500 hover:bg-amber-500">Gold</Badge>}
        </TableCell>
        <TableCell className="text-xs">{call.benchmarkStatus ?? "—"}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!hasRecording}
              onClick={onPlayToggle} data-testid={`button-play-${call.id}`}>
              {playing ? "Стоп" : "Играть"}
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!call.hasTranscript}
              onClick={onTranscript} data-testid={`button-transcript-${call.id}`}>
              Транскрипт
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
              onClick={onGold} data-testid={`button-gold-${call.id}`}>
              Сделать Gold Call
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!hasFixture || runBench.isPending}
              onClick={() => runBench.mutate("ears")} data-testid={`button-ears-${call.id}`}>
              EARS
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!hasFixture || runBench.isPending}
              onClick={() => runBench.mutate("brain")} data-testid={`button-brain-${call.id}`}>
              BRAIN
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
              onClick={onOpenReplay} data-testid={`button-replay-${call.id}`}>
              Replay
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-400 hover:text-red-300" disabled={!hasRecording}
              onClick={onDelete} data-testid={`button-delete-${call.id}`}>
              Удалить
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {playing && (
        <TableRow className="border-gray-800 bg-gray-950/50">
          <TableCell colSpan={10}>
            <InlineAudioPlayer callId={call.id} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function InlineAudioPlayer({ callId }: { callId: string }) {
  const { token } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/recorded-calls/${callId}/audio`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [callId, token]);

  if (loading) return <span className="text-xs text-gray-500">Загрузка аудио…</span>;
  if (error) return <span className="text-xs text-red-400">Не удалось загрузить аудио: {error}</span>;
  if (!url) return null;
  return <audio controls src={url} className="w-full max-w-xl" data-testid={`audio-${callId}`} />;
}

function TranscriptDialog({ call, onClose }: { call: RecordedCall; onClose: () => void }) {
  const { token } = useAuth();
  const q = useAuthedQuery<{ callSid: string; transcript: string; turns: { idx?: number; role?: string; text?: string }[] }>(
    [BASE, "recorded-calls", call.id, "transcript"], !!token,
  );
  const data = q.data;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Транскрипт</DialogTitle>
          <DialogDescription className="text-gray-400 font-mono text-xs">{call.callSid}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-gray-500 text-sm">Загрузка…</p>
        ) : q.error ? (
          <p className="text-red-400 text-sm">{String((q.error as any)?.message ?? q.error)}</p>
        ) : data?.turns?.length ? (
          <div className="space-y-2">
            {data.turns.map((t, i) => (
              <div key={i} className="text-sm">
                <Badge variant={t.role === "guest" ? "secondary" : "outline"} className="mr-2">{t.role ?? "?"}</Badge>
                <span className="text-gray-200">{t.text}</span>
              </div>
            ))}
          </div>
        ) : data?.transcript ? (
          <pre className="text-xs text-gray-300 whitespace-pre-wrap">{data.transcript}</pre>
        ) : (
          <p className="text-gray-500 text-sm">Транскрипт пуст.</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoldCallDialog({ call, onClose }: { call: RecordedCall; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [needTurns, setNeedTurns] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const body: any = {
        title: title.trim() || undefined,
        goal: goal.trim() || undefined,
      };
      if (transcript.trim()) {
        try {
          body.referenceTurns = parseTranscript(transcript);
        } catch (e: any) {
          toast({ title: "Проверьте транскрипт", description: String(e?.message ?? e), variant: "destructive" });
          setSubmitting(false);
          return;
        }
      }
      const res = await fetch(`${BASE}/recorded-calls/${call.id}/gold`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 400) {
        const txt = await res.text();
        if (/transcript/i.test(txt)) {
          setNeedTurns(true);
          toast({
            title: "Нужен транскрипт",
            description: "У звонка нет транскрипта — укажите turns вручную в поле ниже.",
            variant: "destructive",
          });
          setSubmitting(false);
          return;
        }
        throw new Error(txt);
      }
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      toast({ title: "Gold Call создан", description: "Fixture зафиксирован." });
      qc.invalidateQueries({ queryKey: [BASE, "recorded-calls"] });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>Сделать Gold Call</DialogTitle>
          <DialogDescription className="text-gray-400">
            Замораживает фикстуру из этого звонка для повторяемых бенчмарков.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title <span className="text-gray-500 text-xs">(optional)</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                className="bg-gray-950 border-gray-700" data-testid="input-gold-title" />
            </div>
            <div className="space-y-1">
              <Label>Goal <span className="text-gray-500 text-xs">(optional)</span></Label>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)}
                className="bg-gray-950 border-gray-700" data-testid="input-gold-goal" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>
              Transcript override {needTurns ? <span className="text-red-400">*</span> : <span className="text-gray-500 text-xs">(optional)</span>}
            </Label>
            <p className="text-xs text-gray-500">
              JSON-массив {`{idx, role, text}`} или строки «guest: …» / «owner: …». Нужен, если у звонка нет транскрипта.
            </p>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
              rows={5} className="bg-gray-950 border-gray-700 font-mono text-xs" data-testid="input-gold-transcript" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-amber-600 hover:bg-amber-700" data-testid="button-submit-gold">
            {submitting ? "…" : "Сделать Gold Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRecordingDialog({ call, onClose }: { call: RecordedCall; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [includeFixture, setIncludeFixture] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const url = `${BASE}/recorded-calls/${call.id}/recording${includeFixture ? "?includeFixture=1" : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      toast({ title: "Запись удалена" });
      qc.invalidateQueries({ queryKey: [BASE, "recorded-calls"] });
      qc.invalidateQueries({ queryKey: [BASE, "fixtures"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить запись</DialogTitle>
          <DialogDescription className="text-gray-400">
            Запись будет удалена из Twilio <span className="text-red-400 font-medium">навсегда</span>. Это действие необратимо.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includeFixture} onCheckedChange={setIncludeFixture} data-testid="switch-include-fixture" />
          Также удалить связанную фикстуру
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} variant="destructive" data-testid="button-confirm-delete">
            {submitting ? "Удаление…" : "Удалить навсегда"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Candidate Pipeline v1 (Task #207): per-user experimental live pipeline
// (alternate STT / Brain model) + latency verdict vs baseline calls.
// ===========================================================================

interface PipelineConfig {
  enabled: boolean;
  stt: string | null;
  brainModel: string | null;
  allowedStt?: string[];
  allowedBrainModels?: string[];
}

interface VerdictCall {
  callSid: string;
  startedAt: string;
  toNumber: string;
  direction: string;
  status: string;
  isCandidate: boolean;
  sttCandidate?: boolean;
  brainCandidate?: boolean;
  sttSwapFailed?: boolean;
  pipeline: { stt: string | null; brainModel: string | null; sttEffective?: string | null; sttSwapDelayMs?: number | null } | null;
  latencySummary: {
    hintsSent: number;
    hintsDropped: number;
    totalP50Ms: number | null;
    totalP95Ms: number | null;
    brainP50Ms: number | null;
    brainP95Ms: number | null;
    withinSlaPct: number | null;
    // Per-stage breakdown (Task #206). Absent on calls recorded before it shipped.
    sttToTriggerP50Ms?: number | null;
    sttToTriggerP95Ms?: number | null;
    readyToSentP50Ms?: number | null;
    readyToSentP95Ms?: number | null;
    deliveryP50Ms?: number | null;
    deliveryP95Ms?: number | null;
    deliveredCount?: number;
    e2eP50Ms?: number | null;
    e2eP95Ms?: number | null;
    stageNotes?: string[];
  } | null;
  slaMs: number | null;
  entries?: {
    utteranceId: number;
    sttFinalAt: number;
    triggerAt?: number;
    readyAt?: number;
    sentAt?: number;
    deliveredAt?: number;
    source?: string;
    outcome: "sent" | "dropped";
    dropReason?: string;
    text?: string;
  }[] | null;
  // Hint usage (Task #226): which delivered hints the owner actually spoke.
  hintUsage?: {
    delivered: number;
    usedFull: number;
    usedPartial: number;
    ignored: number;
    unknown: number;
    usageRatePct: number | null;
    entries: { utteranceId: number; verdict: "full" | "partial" | "ignored" | "unknown"; score: number; matchedOwnerText?: string }[];
  } | null;
}

const PROD_SENTINEL = "__production__";

function CandidatePipelineTab({ active }: { active: boolean }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const cfgQ = useAuthedQuery<PipelineConfig>([BASE, "candidate-pipeline"], active);
  const verdictQ = useAuthedQuery<{ calls: VerdictCall[] }>(
    [BASE, "candidate-pipeline", "verdict"], active, active ? 15000 : false,
  );

  const [enabled, setEnabled] = useState(false);
  const [stt, setStt] = useState<string>(PROD_SENTINEL);
  const [brain, setBrain] = useState<string>(PROD_SENTINEL);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (cfgQ.data && loadedFor !== "loaded") {
      setEnabled(cfgQ.data.enabled);
      setStt(cfgQ.data.stt ?? PROD_SENTINEL);
      setBrain(cfgQ.data.brainModel ?? PROD_SENTINEL);
      setLoadedFor("loaded");
    }
  }, [cfgQ.data, loadedFor]);

  const saveM = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/candidate-pipeline`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enabled,
          stt: stt === PROD_SENTINEL ? null : stt,
          brainModel: brain === PROD_SENTINEL ? null : brain,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Сохранено", description: "Настройки candidate pipeline применяются к следующему звонку." });
      qc.invalidateQueries({ queryKey: [BASE, "candidate-pipeline"] });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const fmt = (v: number | null | undefined) => (v == null ? "—" : `${v} мс`);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const callsList = verdictQ.data?.calls ?? [];
  const withLatency = callsList.filter((c) => c.latencySummary && c.latencySummary.hintsSent + c.latencySummary.hintsDropped > 0);

  return (
    <div className="space-y-4">
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader><CardTitle className="text-base">Candidate Pipeline v1 — настройка (только мой аккаунт)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-400">
            Экспериментальный live-pipeline для СЛЕДУЮЩЕГО звонка: альтернативный realtime STT и/или Brain-модель.
            Production-конфиг не меняется; выключено — звонок идёт как обычно (Flux + текущая модель).
            При включении нужно выбрать хотя бы одного кандидата.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-pipeline-enabled" />
            <Label>Включить candidate pipeline для моих звонков</Label>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-gray-400">STT (Ears)</Label>
              <Select value={stt} onValueChange={setStt}>
                <SelectTrigger className="bg-gray-950 border-gray-700" data-testid="select-pipeline-stt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROD_SENTINEL}>Production (Deepgram Flux)</SelectItem>
                  {(cfgQ.data?.allowedStt ?? []).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-gray-400">Brain (модель подсказок)</Label>
              <Select value={brain} onValueChange={setBrain}>
                <SelectTrigger className="bg-gray-950 border-gray-700" data-testid="select-pipeline-brain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROD_SENTINEL}>Production (текущая модель)</SelectItem>
                  {(cfgQ.data?.allowedBrainModels ?? []).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || (enabled && stt === PROD_SENTINEL && brain === PROD_SENTINEL)}
            data-testid="button-pipeline-save"
          >
            {saveM.isPending ? "Сохраняю..." : "Сохранить"}
          </Button>
          {enabled && stt === PROD_SENTINEL && brain === PROD_SENTINEL && (
            <p className="text-xs text-amber-400">Выберите хотя бы одного кандидата (STT или Brain), иначе включать нечего.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader><CardTitle className="text-base">Вердикт: latency подсказок по последним звонкам</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400 mb-3">
            Каждый звонок пишет этапы задержки подсказок (usable final STT → триггер Brain → готовый текст → отправка в UI →
            подтверждение устройства, вкл. iPhone) в метаданные. SLA цель: ≤ 1000 мс end-to-end. Отсутствующие этапы показаны
            честно как «—»: момент конца речи гостя STT не отдаёт (usable final уже включает задержку end-of-turn детекции),
            а «доставлено» есть только если клиент прислал подтверждение. Кликните строку — раскроется разбивка по каждой подсказке.
          </p>
          {verdictQ.isLoading ? (
            <p className="text-gray-500 text-sm">Загрузка...</p>
          ) : withLatency.length === 0 ? (
            <p className="text-gray-500 text-sm" data-testid="text-pipeline-no-calls">
              Пока нет звонков с latency-метриками. Сделайте звонок — метрики появятся после его завершения.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Звонок</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Подсказки</TableHead>
                  <TableHead>p50 total</TableHead>
                  <TableHead>p95 total</TableHead>
                  <TableHead>p50 brain</TableHead>
                  <TableHead>p50 доставка</TableHead>
                  <TableHead>p50 / p95 e2e (устройство)</TableHead>
                  <TableHead>≤ SLA (до отправки)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withLatency.map((c) => (
                  <React.Fragment key={c.callSid}>
                  <TableRow
                    data-testid={`row-pipeline-call-${c.callSid}`}
                    className="cursor-pointer"
                    onClick={() => setExpandedCall(expandedCall === c.callSid ? null : c.callSid)}
                  >
                    <TableCell className="text-xs">
                      <div>{new Date(c.startedAt).toLocaleString()}</div>
                      <div className="text-gray-500">{c.direction} → {c.toNumber}</div>
                    </TableCell>
                    <TableCell>
                      {c.isCandidate ? (
                        <div className="space-y-1">
                          <div className="flex gap-1 flex-wrap">
                            {c.sttCandidate && <Badge className="bg-purple-600 hover:bg-purple-600">candidate STT</Badge>}
                            {c.brainCandidate && <Badge className="bg-blue-600 hover:bg-blue-600">candidate Brain</Badge>}
                            {c.sttSwapFailed && <Badge variant="destructive">STT swap failed</Badge>}
                          </div>
                          <div className="text-xs text-gray-400">
                            {c.sttCandidate ? c.pipeline?.stt : "prod STT"} / {c.brainCandidate ? c.pipeline?.brainModel : "prod brain"}
                            {c.pipeline?.sttSwapDelayMs != null && (
                              <span className="text-gray-500"> (Flux lead-in {c.pipeline.sttSwapDelayMs} мс)</span>
                            )}
                          </div>
                        </div>
                      ) : c.sttSwapFailed ? (
                        <div className="space-y-1">
                          <Badge variant="destructive">swap failed</Badge>
                          <div className="text-xs text-gray-500">кандидатный STT не поднялся — звонок шёл на production, не считается candidate</div>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-gray-400 border-gray-600">baseline</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.latencySummary!.hintsSent} отправлено / {c.latencySummary!.hintsDropped} без подсказки
                      {c.hintUsage && (
                        <div className="text-gray-400" data-testid={`text-usage-${c.callSid}`}>
                          использовано: {c.hintUsage.usageRatePct == null ? "—" : `${c.hintUsage.usageRatePct}%`}
                          {c.hintUsage.delivered > 0 && (
                            <span className="text-gray-500"> ({c.hintUsage.usedFull} полн. / {c.hintUsage.usedPartial} част. / {c.hintUsage.ignored} игнор.{c.hintUsage.unknown > 0 ? ` / ${c.hintUsage.unknown} без текста` : ""})</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{fmt(c.latencySummary!.totalP50Ms)}</TableCell>
                    <TableCell>{fmt(c.latencySummary!.totalP95Ms)}</TableCell>
                    <TableCell>{fmt(c.latencySummary!.brainP50Ms)}</TableCell>
                    <TableCell>
                      {fmt(c.latencySummary!.deliveryP50Ms)}
                      {c.latencySummary!.deliveredCount != null && c.latencySummary!.hintsSent > 0 && (
                        <div className="text-xs text-gray-500">{c.latencySummary!.deliveredCount}/{c.latencySummary!.hintsSent} подтв.</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.latencySummary!.e2eP50Ms == null ? "—" : `${c.latencySummary!.e2eP50Ms} / ${fmt(c.latencySummary!.e2eP95Ms)}`}
                    </TableCell>
                    <TableCell>
                      {c.latencySummary!.withinSlaPct == null ? "—" : `${c.latencySummary!.withinSlaPct}%`}
                    </TableCell>
                  </TableRow>
                  {expandedCall === c.callSid && (
                    <TableRow data-testid={`row-pipeline-detail-${c.callSid}`}>
                      <TableCell colSpan={9} className="bg-gray-950">
                        {c.latencySummary && (
                          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs text-gray-300 mb-2" data-testid={`stage-summary-${c.callSid}`}>
                            {([
                              ["STT→триггер", c.latencySummary.sttToTriggerP50Ms, c.latencySummary.sttToTriggerP95Ms],
                              ["Brain", c.latencySummary.brainP50Ms, c.latencySummary.brainP95Ms],
                              ["текст→отправка", c.latencySummary.readyToSentP50Ms, c.latencySummary.readyToSentP95Ms],
                              ["total (до отправки)", c.latencySummary.totalP50Ms, c.latencySummary.totalP95Ms],
                              ["доставка", c.latencySummary.deliveryP50Ms, c.latencySummary.deliveryP95Ms],
                              ["e2e (устройство)", c.latencySummary.e2eP50Ms, c.latencySummary.e2eP95Ms],
                            ] as const).map(([label, p50, p95]) => (
                              <div key={label} className="bg-gray-900 rounded p-2">
                                <div className="text-gray-500">{label}</div>
                                <div>p50 {p50 == null ? "—" : `${p50} мс`} / p95 {p95 == null ? "—" : `${p95} мс`}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {c.hintUsage && c.hintUsage.delivered > 0 && (
                          <div className="text-xs text-gray-300 mb-2" data-testid={`usage-summary-${c.callSid}`}>
                            <span className="text-gray-500">Использование подсказок: </span>
                            {c.hintUsage.usageRatePct == null ? "не измеримо (нет текста подсказок)" : `${c.hintUsage.usageRatePct}% произнесено`}
                            {" — "}{c.hintUsage.usedFull} полностью, {c.hintUsage.usedPartial} частично, {c.hintUsage.ignored} игнорировано
                            {c.hintUsage.unknown > 0 && `, ${c.hintUsage.unknown} без текста (старый звонок)`}
                          </div>
                        )}
                        {(c.latencySummary?.stageNotes?.length ?? 0) > 0 && (
                          <ul className="text-xs text-amber-400/80 list-disc ml-4 mb-2">
                            {c.latencySummary!.stageNotes!.map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                        )}
                        {!c.entries || c.entries.length === 0 ? (
                          <p className="text-xs text-gray-500">Разбивка по подсказкам недоступна для этого звонка.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">#</TableHead>
                                <TableHead className="text-xs">STT→триггер</TableHead>
                                <TableHead className="text-xs">Brain (триггер→текст)</TableHead>
                                <TableHead className="text-xs">текст→отправка</TableHead>
                                <TableHead className="text-xs">отправка→устройство</TableHead>
                                <TableHead className="text-xs">e2e</TableHead>
                                <TableHead className="text-xs">Источник / исход</TableHead>
                                <TableHead className="text-xs">Подсказка / использование</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {c.entries.map((e) => {
                                const d = (a?: number, b?: number) => (a != null && b != null ? `${b - a} мс` : "—");
                                const usage = c.hintUsage?.entries?.find((u) => u.utteranceId === e.utteranceId);
                                const verdictLabel = usage
                                  ? { full: "произнесена", partial: "частично", ignored: "игнорирована", unknown: "нет текста" }[usage.verdict]
                                  : null;
                                const verdictColor = usage
                                  ? { full: "text-green-400", partial: "text-yellow-400", ignored: "text-gray-500", unknown: "text-gray-600" }[usage.verdict]
                                  : "";
                                return (
                                  <TableRow key={e.utteranceId} className="text-xs">
                                    <TableCell>{e.utteranceId}</TableCell>
                                    <TableCell>{d(e.sttFinalAt, e.triggerAt)}</TableCell>
                                    <TableCell>{d(e.triggerAt, e.readyAt)}</TableCell>
                                    <TableCell>{d(e.readyAt, e.sentAt)}</TableCell>
                                    <TableCell>{d(e.sentAt, e.deliveredAt)}</TableCell>
                                    <TableCell>{d(e.sttFinalAt, e.deliveredAt)}</TableCell>
                                    <TableCell className="text-gray-400">
                                      {e.outcome === "sent" ? (e.source ?? "—") : `drop: ${e.dropReason ?? "?"}`}
                                    </TableCell>
                                    <TableCell className="max-w-[280px]">
                                      {e.outcome !== "sent" ? (
                                        <span className="text-gray-600">—</span>
                                      ) : (
                                        <div>
                                          {e.text && <div className="text-gray-300 truncate" title={e.text}>«{e.text}»</div>}
                                          {usage && (
                                            <div className={verdictColor}>
                                              {verdictLabel}{usage.verdict !== "unknown" && ` (${Math.round(usage.score * 100)}%)`}
                                              {usage.matchedOwnerText && (
                                                <span className="text-gray-500 block truncate" title={usage.matchedOwnerText}>→ {usage.matchedOwnerText}</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// GOAL-RETURN TAB
// ===========================================================================

// ---------------------------------------------------------------------------
// GoalReturnTab — queue-based batch analysis (2–10 calls per run)
// ---------------------------------------------------------------------------

const GR_MIN_QUEUE = 2;
const GR_MAX_QUEUE = 10;

interface GrQueueEntry {
  /** Stable local key for React list rendering */
  key: string;
  sourceType: "recorded_call" | "fixture";
  /** id in callsWithTranscript (recorded_call) or fixture.id (fixture) */
  sourceId: string;
  /** Display label derived from the source */
  sourceLabel: string;
  goal: string;
  goalSource: string;
  callTitle: string;
}

function grEntryKey() {
  return `gr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function GoalReturnTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ---- form state for the "add entry" panel ----
  const [sourceType, setSourceType] = useState<"recorded_call" | "fixture">("recorded_call");
  const [selectedCallId, setSelectedCallId] = useState<string>("");
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [goalSource, setGoalSource] = useState("operator-supplied");
  const [callTitle, setCallTitle] = useState("");

  // ---- queued entries ----
  const [queue, setQueue] = useState<GrQueueEntry[]>([]);

  // Report viewer: id of the goal_return run whose report is displayed
  const [viewRunId, setViewRunId] = useState<string | null>(null);

  // Recorded calls (only those with a transcript are useful)
  const recordedCallsQ = useAuthedQuery<RecordedCall[]>([BASE, "recorded-calls"], !!token);
  const callsWithTranscript = (recordedCallsQ.data ?? []).filter((c) => c.hasTranscript);

  // Fixtures (pre-existing goal + reference transcript)
  const fixturesQ = useAuthedQuery<Fixture[]>([BASE, "fixtures"], !!token);
  const fixtures = fixturesQ.data ?? [];

  // Runs list — poll while something is running
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const goalReturnRuns = runs.filter((r) => r.runType === "goal_return");
  const anyRunning = goalReturnRuns.some((r) => r.status === "running");

  // Full run detail for the viewer
  const detailQ = useAuthedQuery<BenchmarkRun>(
    [BASE, "runs", viewRunId ?? undefined],
    !!viewRunId && !!token,
    anyRunning ? 3000 : false,
  );
  const detailRun = detailQ.data;

  // When fixture selection changes, pre-fill goal and source
  const selectedFixture = fixtures.find((f) => f.id === selectedFixtureId);
  useEffect(() => {
    if (sourceType === "fixture" && selectedFixture) {
      setGoal(selectedFixture.goal || "");
      setGoalSource(`frozen fixture: ${selectedFixture.title}`);
      setCallTitle(selectedFixture.title);
    }
  }, [sourceType, selectedFixtureId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When recorded call changes, update default title / source
  const selectedCall = callsWithTranscript.find((c) => c.id === selectedCallId);
  useEffect(() => {
    if (sourceType === "recorded_call" && selectedCall) {
      setCallTitle(selectedCall.callSid ?? selectedCall.id);
      setGoalSource("operator-supplied");
    }
  }, [sourceType, selectedCallId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open latest completed run when it arrives
  const latestGoalReturnRun = goalReturnRuns[0];
  useEffect(() => {
    if (latestGoalReturnRun?.status === "completed" && !viewRunId) {
      setViewRunId(latestGoalReturnRun.id);
    }
  }, [latestGoalReturnRun?.id, latestGoalReturnRun?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- add current form state as a queued entry ----
  function handleAddToQueue() {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      toast({ title: "Укажите цель звонка", variant: "destructive" });
      return;
    }
    if (sourceType === "recorded_call" && !selectedCallId) {
      toast({ title: "Выберите звонок", variant: "destructive" });
      return;
    }
    if (sourceType === "fixture" && !selectedFixtureId) {
      toast({ title: "Выберите фикстуру", variant: "destructive" });
      return;
    }
    if (queue.length >= GR_MAX_QUEUE) {
      toast({ title: `Максимум ${GR_MAX_QUEUE} звонков в одном запуске`, variant: "destructive" });
      return;
    }

    let sourceLabel = "";
    let derivedTitle = callTitle;
    if (sourceType === "recorded_call") {
      const c = callsWithTranscript.find((x) => x.id === selectedCallId);
      sourceLabel = c ? `${fmtTime(c.startedAt)} · ${c.callSid?.slice(0, 14) ?? c.id}` : selectedCallId;
      derivedTitle = derivedTitle || (c?.callSid ?? c?.id ?? selectedCallId);
    } else {
      const f = fixtures.find((x) => x.id === selectedFixtureId);
      sourceLabel = f ? f.title : selectedFixtureId;
      derivedTitle = derivedTitle || sourceLabel;
    }

    setQueue((prev) => [
      ...prev,
      {
        key: grEntryKey(),
        sourceType,
        sourceId: sourceType === "recorded_call" ? selectedCallId : selectedFixtureId,
        sourceLabel,
        goal: trimmedGoal,
        goalSource: goalSource.trim() || "operator-supplied",
        callTitle: derivedTitle,
      },
    ]);

    // Reset form for the next entry
    setSelectedCallId("");
    setSelectedFixtureId("");
    setGoal("");
    setGoalSource("operator-supplied");
    setCallTitle("");
  }

  // ---- run the queued batch ----
  const runMutation = useMutation({
    mutationFn: async () => {
      if (queue.length === 0) throw new Error("Очередь пуста — добавьте хотя бы один звонок.");

      const callsPayload: Record<string, unknown>[] = [];
      for (const entry of queue) {
        if (entry.sourceType === "recorded_call") {
          const call = callsWithTranscript.find((c) => c.id === entry.sourceId);
          if (!call) throw new Error(`Звонок ${entry.sourceId} не найден.`);
          callsPayload.push({
            callSid: call.callSid,
            title: entry.callTitle || call.callSid || call.id,
            goal: entry.goal,
            goalSource: entry.goalSource,
          });
        } else {
          const fixture = fixtures.find((f) => f.id === entry.sourceId);
          if (!fixture) throw new Error(`Фикстура ${entry.sourceId} не найдена.`);
          const turns = (fixture.referenceTurns ?? []) as { role: string; text: string }[];
          if (turns.length === 0) throw new Error(`Фикстура «${fixture.title}» не содержит реплик.`);
          const transcript = turns.map((t) => `${t.role}: ${t.text}`).join("\n");
          callsPayload.push({
            title: entry.callTitle || fixture.title,
            goal: entry.goal,
            goalSource: entry.goalSource,
            transcript,
          });
        }
      }

      const res = await fetch(`${BASE}/goal-return/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ calls: callsPayload }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<{ runId: string }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [BASE, "runs"] });
      setViewRunId(data.runId);
      setQueue([]);
      toast({
        title: "Goal-Return анализ запущен",
        description: "Результат появится после завершения.",
      });
    },
    onError: (e: any) => toast({ title: "Ошибка", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      {/* ---- Launch card ---- */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader>
          <CardTitle className="text-base">Goal-Return Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-gray-400">
            Офлайн-анализ: насколько разговор придерживается цели звонка, когда отклоняется и возвращается ли обратно.
            Добавьте от {GR_MIN_QUEUE} до {GR_MAX_QUEUE} звонков/фикстур в очередь, затем нажмите «Запустить».
            Цели на продакшн-звонках не сохраняются — источник цели отображается явно в отчёте.
          </p>

          {/* Source type */}
          <div className="space-y-2">
            <Label className="text-sm text-gray-300">Источник транскрипта</Label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="gr-source"
                  value="recorded_call"
                  checked={sourceType === "recorded_call"}
                  onChange={() => {
                    setSourceType("recorded_call");
                    setGoal("");
                    setGoalSource("operator-supplied");
                  }}
                  className="accent-cyan-500"
                  data-testid="radio-source-recorded"
                />
                Записанный звонок (транскрипт из БД)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="gr-source"
                  value="fixture"
                  checked={sourceType === "fixture"}
                  onChange={() => {
                    setSourceType("fixture");
                    setSelectedFixtureId("");
                    setGoal("");
                  }}
                  className="accent-cyan-500"
                  data-testid="radio-source-fixture"
                />
                Фикстура (reference transcript)
              </label>
            </div>
          </div>

          {/* Call / Fixture picker */}
          {sourceType === "recorded_call" ? (
            <div className="space-y-2">
              <Label className="text-sm text-gray-300">Звонок</Label>
              {recordedCallsQ.isLoading ? (
                <p className="text-xs text-gray-500">Загрузка звонков…</p>
              ) : callsWithTranscript.length === 0 ? (
                <p className="text-xs text-amber-400">
                  Нет записанных звонков с транскриптом. Перейдите во вкладку «Записанные звонки».
                </p>
              ) : (
                <Select value={selectedCallId} onValueChange={setSelectedCallId}>
                  <SelectTrigger className="bg-gray-950 border-gray-700 max-w-lg" data-testid="select-call">
                    <SelectValue placeholder="Выберите звонок…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    {callsWithTranscript.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {fmtTime(c.startedAt)} · {c.callSid?.slice(0, 14) ?? c.id}
                        {c.userEmail ? ` · ${c.userEmail}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm text-gray-300">Фикстура</Label>
              {fixturesQ.isLoading ? (
                <p className="text-xs text-gray-500">Загрузка фикстур…</p>
              ) : fixtures.length === 0 ? (
                <p className="text-xs text-amber-400">Фикстуры не найдены.</p>
              ) : (
                <Select value={selectedFixtureId} onValueChange={setSelectedFixtureId}>
                  <SelectTrigger className="bg-gray-950 border-gray-700 max-w-lg" data-testid="select-fixture">
                    <SelectValue placeholder="Выберите фикстуру…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    {fixtures.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.title}{f.goal ? ` — ${f.goal.slice(0, 50)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Goal field */}
          <div className="space-y-2">
            <Label className="text-sm text-gray-300">
              Цель звонка
              <span className="text-gray-500 font-normal ml-2 text-xs">
                (обязательно — цели не хранятся на продакшн-звонках)
              </span>
            </Label>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Например: продать подписку Pro, сохранить клиента, закрыть возражение по цене…"
              className="bg-gray-950 border-gray-700 min-h-[80px] max-w-lg"
              data-testid="input-goal"
            />
          </div>

          {/* Goal source label */}
          <div className="space-y-2">
            <Label className="text-sm text-gray-300">
              Источник цели
              <span className="text-gray-500 font-normal ml-2 text-xs">(будет явно показан в отчёте)</span>
            </Label>
            <Input
              value={goalSource}
              onChange={(e) => setGoalSource(e.target.value)}
              placeholder="operator-supplied"
              className="bg-gray-950 border-gray-700 max-w-lg"
              data-testid="input-goal-source"
            />
          </div>

          {/* Title override */}
          <div className="space-y-2">
            <Label className="text-sm text-gray-300">Название звонка в отчёте</Label>
            <Input
              value={callTitle}
              onChange={(e) => setCallTitle(e.target.value)}
              placeholder="Автозаполнение из выбранного источника"
              className="bg-gray-950 border-gray-700 max-w-lg"
              data-testid="input-call-title"
            />
          </div>

          <Button
            onClick={handleAddToQueue}
            disabled={queue.length >= GR_MAX_QUEUE}
            variant="outline"
            className="border-cyan-700 text-cyan-300 hover:bg-cyan-900/30"
            data-testid="button-add-to-queue"
          >
            + Добавить в очередь
            {queue.length > 0 && (
              <span className="ml-2 text-xs bg-cyan-700/50 text-cyan-200 rounded-full px-1.5 py-0.5">
                {queue.length}/{GR_MAX_QUEUE}
              </span>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ---- Queue card ---- */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>
              Очередь анализа
              {queue.length > 0 && (
                <Badge className="ml-2 bg-cyan-700 hover:bg-cyan-700 text-xs">{queue.length}</Badge>
              )}
            </span>
            {queue.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-gray-500"
                onClick={() => setQueue([])}
                data-testid="button-clear-queue"
              >
                Очистить
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-gray-500">
              Очередь пуста. Заполните форму выше и нажмите «Добавить в очередь».
            </p>
          ) : (
            <div className="space-y-2 mb-4">
              {queue.map((entry, idx) => (
                <div
                  key={entry.key}
                  className="flex items-start gap-3 rounded border border-gray-700 bg-gray-950 px-3 py-2"
                  data-testid={`gr-queue-entry-${idx}`}
                >
                  <span className="text-gray-600 text-xs pt-0.5 w-4 shrink-0">{idx + 1}.</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-200 truncate max-w-xs" title={entry.callTitle}>
                        {entry.callTitle}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs border-gray-600 text-gray-400 shrink-0"
                      >
                        {entry.sourceType === "recorded_call" ? "📞 звонок" : "📄 фикстура"}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500 truncate" title={entry.sourceLabel}>
                      {entry.sourceLabel}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                      <span>
                        <span className="text-gray-500">цель: </span>
                        <span className="text-cyan-300">{entry.goal.length > 80 ? entry.goal.slice(0, 80) + "…" : entry.goal}</span>
                      </span>
                      <span>
                        <span className="text-gray-500">источник: </span>
                        <span className="text-gray-400">{entry.goalSource}</span>
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-gray-500 hover:text-red-400 shrink-0"
                    onClick={() => setQueue((prev) => prev.filter((e) => e.key !== entry.key))}
                    data-testid={`button-remove-queue-entry-${idx}`}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}

          {queue.length > 0 && queue.length < GR_MIN_QUEUE && (
            <p className="text-xs text-amber-400" data-testid="gr-min-queue-hint">
              Добавьте ещё {GR_MIN_QUEUE - queue.length} звонок, чтобы запустить пакетный анализ (минимум {GR_MIN_QUEUE}).
            </p>
          )}

          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || anyRunning || queue.length < GR_MIN_QUEUE}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="button-run-goal-return"
          >
            {runMutation.isPending
              ? "Запуск…"
              : anyRunning
              ? "Идёт анализ…"
              : queue.length < GR_MIN_QUEUE
              ? `Нужно минимум ${GR_MIN_QUEUE} звонка`
              : `Запустить Goal-Return анализ (${queue.length} ${queue.length < 5 ? "звонка" : "звонков"})`}
          </Button>
        </CardContent>
      </Card>

      {/* ---- Run history for goal_return ---- */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader><CardTitle className="text-base">История Goal-Return runs</CardTitle></CardHeader>
        <CardContent>
          {goalReturnRuns.length === 0 ? (
            <p className="text-sm text-gray-500">Runs ещё не запускались.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead>Время</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Звонков</TableHead>
                  <TableHead>Judge</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goalReturnRuns.map((r) => {
                  const callCount = (r.config as any)?.calls?.length ?? "—";
                  const judgeModel = (r as any).results?.judgeModel ?? "—";
                  const isViewing = r.id === viewRunId;
                  return (
                    <TableRow
                      key={r.id}
                      className="border-gray-800 cursor-pointer hover:bg-gray-800/30"
                      onClick={() => setViewRunId(isViewing ? null : r.id)}
                      data-testid={`row-gr-run-${r.id}`}
                    >
                      <TableCell className="text-xs">{fmtTime(r.startedAt)}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs">{callCount}</TableCell>
                      <TableCell className="text-xs text-gray-400 font-mono">{judgeModel}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                          {isViewing ? "скрыть" : "отчёт"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Report viewer ---- */}
      {viewRunId && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Отчёт Goal-Return run</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setViewRunId(null)}
              >
                ✕ Закрыть
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detailQ.isLoading && (
              <p className="text-sm text-gray-500">Загрузка…</p>
            )}
            {!detailQ.isLoading && detailRun && (
              <div className="space-y-4">
                {/* Run meta */}
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
                  <span>
                    <span className="text-gray-500">Статус:</span>{" "}
                    <StatusBadge status={detailRun.status} />
                  </span>
                  <span>
                    <span className="text-gray-500">Завершён:</span> {fmtTime(detailRun.finishedAt)}
                  </span>
                  {(detailRun as any).results?.judgeModel && (
                    <span>
                      <span className="text-gray-500">Judge:</span>{" "}
                      <span className="font-mono">{(detailRun as any).results.judgeModel}</span>
                    </span>
                  )}
                </div>

                {/* Error */}
                {detailRun.error && (
                  <div
                    className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-red-300 text-xs whitespace-pre-wrap"
                    data-testid="gr-error"
                  >
                    {detailRun.error}
                  </div>
                )}

                {/* Per-call scorecard */}
                {Array.isArray((detailRun.scorecard as any)?.calls) && (
                  <div>
                    <p className="text-sm font-medium text-gray-300 mb-2">Scorecard</p>
                    <div className="space-y-1">
                      {((detailRun.scorecard as any).calls as any[]).map((c: any, i: number) => (
                        <div
                          key={i}
                          className="flex flex-wrap gap-x-4 gap-y-1 text-xs bg-gray-950 rounded px-3 py-2 border border-gray-800"
                          data-testid={`gr-scorecard-row-${i}`}
                        >
                          <span className="font-medium text-gray-200 truncate max-w-xs" title={c.title}>
                            {c.title}
                          </span>
                          {c.unscored ? (
                            <span className="text-gray-500">unscored</span>
                          ) : (
                            <>
                              {c.onGoalPct != null && (
                                <span>
                                  <span className="text-gray-500">on-goal:</span>{" "}
                                  {(c.onGoalPct * 100).toFixed(0)}%
                                </span>
                              )}
                              {c.digressionCount != null && (
                                <span>
                                  <span className="text-gray-500">digressions:</span> {c.digressionCount}
                                </span>
                              )}
                              {c.returnRate != null && (
                                <span>
                                  <span className="text-gray-500">return rate:</span>{" "}
                                  {(c.returnRate * 100).toFixed(0)}%
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-call goal source provenance — makes it explicit in the UI */}
                {Array.isArray((detailRun as any).results?.calls) && (
                  <div>
                    <p className="text-sm font-medium text-gray-300 mb-2">Звонки и источники целей</p>
                    <div className="space-y-1">
                      {((detailRun as any).results.calls as any[]).map((c: any, i: number) => (
                        <div key={i} className="text-xs text-gray-400 flex flex-wrap gap-x-3">
                          <span className="text-gray-200 font-medium">{c.title}</span>
                          <span>
                            <span className="text-gray-500">цель:</span>{" "}
                            <span className="text-cyan-300">{c.goal}</span>
                          </span>
                          <span>
                            <span className="text-gray-500">источник:</span>{" "}
                            <Badge variant="outline" className="text-xs border-gray-600 text-gray-300">
                              {c.goalSource}
                            </Badge>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Turn-by-turn alignment table — per call */}
                {Array.isArray((detailRun as any).results?.calls) &&
                  ((detailRun as any).results.calls as any[]).some(
                    (c: any) => Array.isArray(c.labels) && c.labels.length > 0,
                  ) && (
                    <div>
                      <p className="text-sm font-medium text-gray-300 mb-2">Поворот за поворотом</p>
                      <div className="space-y-4">
                        {((detailRun as any).results.calls as any[]).map((c: any, ci: number) => {
                          if (!Array.isArray(c.labels) || c.labels.length === 0) return null;
                          // Build a lookup: idx → turn text
                          const turnText = new Map<number, { role: string; text: string }>();
                          if (Array.isArray(c.turns)) {
                            for (const t of c.turns as { idx: number; role: string; text: string }[]) {
                              turnText.set(t.idx, { role: t.role, text: t.text });
                            }
                          }
                          return (
                            <div key={ci} className="border border-gray-800 rounded overflow-hidden">
                              <div className="bg-gray-900 px-3 py-2 text-xs font-medium text-gray-300">
                                {c.title}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-800 bg-gray-950">
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal w-8">#</th>
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal w-16">Роль</th>
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal">Реплика</th>
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal w-36">Метка</th>
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal w-32">Owner move</th>
                                      <th className="px-3 py-2 text-left text-gray-500 font-normal">Примечание судьи</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(c.labels as any[]).map((lbl: any) => {
                                      const turn = turnText.get(lbl.idx);
                                      // Row colour: off_goal → amber, justified_digression → amber/muted,
                                      // on_goal with returns_to_goal owner move → green, otherwise default
                                      const rowClass =
                                        lbl.segment === "off_goal"
                                          ? "bg-amber-950/40 border-amber-800/40"
                                          : lbl.segment === "justified_digression"
                                          ? "bg-yellow-950/30 border-yellow-800/30"
                                          : lbl.ownerMove === "returns_to_goal"
                                          ? "bg-green-950/30 border-green-800/30"
                                          : "border-gray-800/40";
                                      // Segment badge colour
                                      const segClass =
                                        lbl.segment === "off_goal"
                                          ? "text-amber-400"
                                          : lbl.segment === "justified_digression"
                                          ? "text-yellow-400/80"
                                          : "text-green-400";
                                      // Owner move badge colour
                                      const moveClass =
                                        lbl.ownerMove === "drifts"
                                          ? "text-amber-400"
                                          : lbl.ownerMove === "returns_to_goal"
                                          ? "text-green-400"
                                          : lbl.ownerMove === "supports_branch"
                                          ? "text-cyan-400/80"
                                          : "text-gray-500";
                                      return (
                                        <tr
                                          key={lbl.idx}
                                          className={`border-b last:border-0 ${rowClass}`}
                                          data-testid={`gr-turn-row-${ci}-${lbl.idx}`}
                                        >
                                          <td className="px-3 py-1.5 text-gray-500">{lbl.idx}</td>
                                          <td className="px-3 py-1.5 text-gray-400 capitalize">
                                            {turn?.role ?? "—"}
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-200 max-w-xs">
                                            {turn?.text
                                              ? <span title={turn.text}>{turn.text.length > 120 ? turn.text.slice(0, 120) + "…" : turn.text}</span>
                                              : <span className="text-gray-600 italic">текст недоступен</span>}
                                          </td>
                                          <td className={`px-3 py-1.5 font-mono ${segClass}`}>
                                            {lbl.segment}
                                          </td>
                                          <td className={`px-3 py-1.5 font-mono ${moveClass}`}>
                                            {lbl.ownerMove ?? <span className="text-gray-600">—</span>}
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-400">{lbl.note}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {/* Markdown report */}
                {typeof detailRun.report === "string" && detailRun.report && (
                  <div>
                    <p className="text-sm font-medium text-gray-300 mb-2">Отчёт</p>
                    <pre
                      className="whitespace-pre-wrap text-xs text-gray-300 font-mono bg-gray-950 border border-gray-800 rounded p-4 max-h-[60vh] overflow-y-auto"
                      data-testid="gr-report"
                    >
                      {detailRun.report}
                    </pre>
                  </div>
                )}

                {/* Per-call analysis notes */}
                {Array.isArray((detailRun as any).results?.calls) &&
                  (detailRun as any).results.calls.some((c: any) => c.notes?.length > 0) && (
                    <div>
                      <p className="text-sm font-medium text-gray-300 mb-2">Примечания</p>
                      {((detailRun as any).results.calls as any[]).map((c: any, i: number) =>
                        c.notes?.length > 0 ? (
                          <div key={i} className="mb-2">
                            <p className="text-xs text-gray-400 font-medium">{c.title}</p>
                            <ul className="list-disc ml-4 text-xs text-amber-400/80">
                              {c.notes.map((n: string, j: number) => (
                                <li key={j}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}

                {detailRun.status === "running" && (
                  <p className="text-sm text-amber-400 flex items-center gap-2">
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
                    Анализ выполняется, подождите…
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
