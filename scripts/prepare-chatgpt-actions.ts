import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { talkHintActionsSchema } from "../server/chatgpt/actionsSchema";

// Offline only: no server, environment, database, keys, OAuth exchange or network.
const args = process.argv.slice(2);
const draft = args[0] === "--draft";
const outbound = args.includes("--outbound");
if (!(draft ? args.length === (outbound ? 2 : 1) :
  args[0] === "--origin" && args.length === (outbound ? 3 : 2)) ||
  (outbound && args.at(-1) !== "--outbound")) {
  console.error("Use --draft [--outbound] or --origin https://PUBLIC-HOST [--outbound]");
  process.exit(2);
}
let schema: ReturnType<typeof talkHintActionsSchema>;
try {
  const origin = draft ? "https://talkhint-actions.invalid" : args[1];
  const url = new URL(origin);
  if (url.port || (!draft && (isIP(url.hostname) || !url.hostname.includes(".") ||
    /(^|\.)(localhost|local|internal|invalid|test|example|example\.com|example\.net|example\.org)$/.test(url.hostname))))
    throw new Error("Public HTTPS hostname on 443 required");
  schema = talkHintActionsSchema(origin, outbound);
} catch {
  console.error("Invalid Actions origin. Use an exact public HTTPS origin without path, credentials or non-443 port.");
  process.exit(2);
}
const out = resolve("generated-artifacts/talkhint-actions", draft ? "draft" : "candidate");
await mkdir(out, { recursive: true });
const file = resolve(out, draft ? "talkhint-actions-NOT-FOR-CONNECTION.json" : "talkhint-actions.openapi.json");
await writeFile(file, JSON.stringify(schema, null, 2) + "\n");
console.log(`Prepared ${file}. No settings changed; no connection or call made.`);
