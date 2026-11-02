/** One synthetic contract control, charged to the OLD lab series; never a call. */
import fs from "node:fs";
import { englishFirstHint } from "../server/liveHintEnglishFirst";
import { Ledger } from "../server/hintPolygon/ledger";
import { money, tokenCost, sha, SERIES } from "../server/hintPolygon/contracts";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../shared/prompts";
import { withActionResults } from "../server/hintActionResults";
async function main() {
  const root = "generated-artifacts/hint-polygon", prefix = `${SERIES}-live-v-structured-probe-v1`;
  const ledger = new Ledger(`${root}/series-ledger.json`, true);
  const receipts: unknown[] = [];
  let n = 0;
  try {
    if (ledger.snapshot().entries.some(e => e.id.startsWith(prefix))) throw Error("PROBE_ALREADY_STARTED_NO_RETRY");
    const before = ledger.held();
    const countedFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)), id = `${prefix}-${++n}`;
      const reserve = Math.ceil((Buffer.byteLength(String(init?.body)) + 2048) * 2.5 +
        (body.max_completion_tokens ?? body.max_tokens) * 12);
      await ledger.reserve(id, "brain", reserve, sha(String(init?.body)), "strict-rollout-probe");
      let httpStatus: number | undefined, requestId: string | null = null;
      try {
        const r = await fetch(url, init); httpStatus = r.status; requestId = r.headers.get("x-request-id");
        if (!r.ok) {
          if ([400, 401, 403, 404, 422].includes(r.status)) await ledger.finish(id, 0, { httpStatus, requestId });
          else await ledger.unknown(id, { httpStatus, requestId });
          return r;
        }
        const wire = await r.clone().text();
        let usage: any;
        if (body.stream) {
          for (const line of wire.split("\n")) {
            if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
            const e = JSON.parse(line.slice(5)); if (e.usage) usage = e.usage;
          }
        } else usage = JSON.parse(wire).usage;
        const cost = tokenCost(usage, money.brain);
        await ledger.finish(id, cost, { httpStatus, requestId });
        receipts.push({ httpStatus, requestId, usage, estimatedMicro: cost, stream: !!body.stream, strict: body.response_format.json_schema.strict });
        return r;
      } catch (e) { await ledger.unknown(id, { httpStatus, requestId }); throw e; }
    };
    const r = await englishFirstHint({
      model: "gpt-5.6-terra", guest: "What would you like to know?", language: "ru", translateEnabled: true,
      system: withActionResults(buildLiveSystemPrompt({
        goal: "Ask for opening hours", language: "ru", conversationContext: "",
        translateEnabled: true,
      })),
      user: buildLiveUserPrompt("What would you like to know?"),
    }, { fetch: countedFetch, diagnostic: () => {} });
    if (!r.suggestion?.en) throw Error("PROBE_NO_ENGLISH");
    const native = await r.finishTranslation();
    if (!native.translation || !native.suggestion?.translation || native.suggestion.en !== r.suggestion.en)
      throw Error("PROBE_TRANSLATION_MISMATCH");
    const report = { status: "passed", synthetic: true, noPhoneCall: true, noLiveFlagChanged: true,
      model: "gpt-5.6-terra", receipts, estimatedMicro: ledger.held() - before,
      seriesHeldMicro: ledger.held(), limitMicro: ledger.snapshot().limit };
    fs.mkdirSync("generated-artifacts/hint-live-rollout", { recursive: true });
    fs.writeFileSync("generated-artifacts/hint-live-rollout/strict-probe.json", JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await ledger.close(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "PROBE_FAILED_STOP"); process.exitCode = 1; });
