import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import type { Pool } from "pg";
import { requireBenchmarkAdmin } from "../../benchmark/adminGate";
import { adminActionOrigin } from "../../adminWeb";
import { semanticHash } from "../valueTree";
import { OwnerImportService, type TransferManifest, type TransferRecord } from "./transport";
import { reviewedImportApproval, type ImportApproval } from "./importApproval";

/** Bounded NDJSON parser. No full transfer buffer, unzip, filesystem or URL fetch. */
export async function* importLines(input: AsyncIterable<Buffer | string>) {
  let pending = Buffer.alloc(0), bytes = 0;
  const maxLine = 20 * 1024 * 1024, maxTotal = 1024 * 1024 * 1024;
  for await (const chunk of input) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > maxTotal) throw new Error("Import byte limit exceeded");
    pending = Buffer.concat([pending, b]);
    let end: number;
    while ((end = pending.indexOf(10)) !== -1) {
      if (end > maxLine) throw new Error("Import line limit exceeded");
      const line = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      if (line.length) yield JSON.parse(line.toString("utf8"));
    }
    if (pending.length > maxLine) throw new Error("Import line limit exceeded");
  }
  if (pending.length) yield JSON.parse(pending.toString("utf8"));
}
function validManifest(m: any): m is TransferManifest {
  return !!m && m.schemaVersion === 3 &&
    ["schemaDigest", "rootHash", "semanticHash", "recordsDigest"].every(k =>
      typeof m[k] === "string" && /^[a-f0-9]{64}$/.test(m[k])) &&
    ["sourceOwner", "sourceWorkspace", "sourceEnvironment"].every(k =>
      typeof m[k] === "string" && m[k].length > 0 && m[k].length < 200) &&
    Number.isSafeInteger(m.revision) && m.revision >= 0 &&
    Number.isSafeInteger(m.recordCount) && m.recordCount > 0 && m.recordCount <= 2_000_000;
}
function csrf(req: Request) {
  const expected = (req.session as any)?.companyImportCsrf;
  const actual = req.get("x-company-csrf");
  return typeof actual === "string" && typeof expected === "string" &&
    actual.length === 64 && expected.length === 64 &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function registerCompanyImport(app: Express, getPool: () => Promise<Pool>, options: {
  environment?: "development" | "production";
  approval?: ImportApproval | null;
  service?: OwnerImportService;
} = {}) {
  const environment = options.environment ??
    (process.env.NODE_ENV === "production" ? "production" : "development");
  const approval = options.approval === undefined ? reviewedImportApproval : options.approval;
  const base = "/api/admin/company-import";
  app.all(`${base}/*`, requireBenchmarkAdmin, adminActionOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    // Bearer/MCP credentials and a body's claimed owner do NOT grant import.
    if (!req.isAuthenticated?.() || !req.session || !req.user?.id)
      return res.status(401).json({ error: "Owner browser session required" });
    const owner = String(req.user.id);
    if (!approval?.confirmed || !approval.importApproved)
      return res.status(423).json({ error: "Binding and import approval pending", activated: false });
    if (owner !== approval.targetOwner || environment !== approval.targetEnvironment)
      return res.status(403).json({ error: "Owner/environment binding mismatch" });
    const auth = { ownerKey: owner, isOwner: true, csrfVerified: false };
    try {
      if (req.method === "GET" && req.path === `${base}/status`) {
        const session = req.session as any;
        session.companyImportCsrf ??= randomBytes(32).toString("hex");
        return res.json({ csrfToken: session.companyImportCsrf, activated: false,
          source: "reviewed shadow B", revision: approval.revision });
      }
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!csrf(req)) return res.status(403).json({ error: "CSRF verification required" });
      auth.csrfVerified = true;
      const check = (m: unknown): TransferManifest => {
        if (!validManifest(m) || m.sourceOwner !== approval.sourceOwner ||
          m.sourceEnvironment !== approval.sourceEnvironment ||
          m.sourceWorkspace !== approval.sourceWorkspace || m.revision !== approval.revision ||
          semanticHash(m) !== approval.manifestHash) throw new Error("Unreviewed source/package");
        return m;
      };
      // No DB access before authentication, CSRF, policy and manifest checks.
      const service = () => options.service ??
        getPool().then(p => new OwnerImportService(p, environment, true));
      if (req.path === `${base}/grant`) {
        if (Object.keys(req.body ?? {}).some(k => k !== "manifest")) throw new Error("Unexpected grant field");
        const manifest = check(req.body?.manifest);
        const token = await (await service()).grant(auth, manifest, owner, 600_000);
        return res.status(201).json({ token, expiresInSeconds: 600, activated: false });
      }
      if (req.path === `${base}/consume`) {
        if (req.headers["content-type"]?.split(";")[0] !== "application/x-ndjson")
          return res.status(415).json({ error: "NDJSON stream required" });
        const token = req.get("x-company-import-grant");
        if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Import grant required");
        const lines = importLines(req);
        const first = await lines.next();
        if (first.done || Object.keys(first.value).some(k => k !== "manifest"))
          throw new Error("Manifest envelope required");
        const manifest = check(first.value.manifest);
        const records = async function* (): AsyncIterable<TransferRecord> {
          for await (const r of lines) {
            if (!r || typeof r.table !== "string" || !r.row || Array.isArray(r.row) ||
              typeof r.row !== "object" || Object.keys(r).some(k => !["table", "row"].includes(k)))
              throw new Error("Invalid transfer record");
            yield r;
          }
        };
        return res.json(await (await service()).consume(auth, token, manifest, records(), false));
      }
      return res.status(404).json({ error: "Unknown import operation" });
    } catch {
      // Never disclose SQL, token, account identifiers or package contents.
      return res.status(409).json({ error: "Import refused; candidate not confirmed. Inspect private audit before retry." });
    }
  });
}
