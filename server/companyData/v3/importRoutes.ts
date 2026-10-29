import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import type { Pool } from "pg";
import { requireBenchmarkAdmin } from "../../benchmark/adminGate";
import { adminActionOrigin } from "../../adminWeb";
import { semanticHash } from "../valueTree";
import { OwnerImportService, type TransferManifest, type TransferRecord } from "./transport";
import { reviewedAccountBinding, reviewedImportApproval, type ImportApproval } from "./importApproval";
import { reviewedPackage, type ReviewedPackage } from "./reviewedPackage";
import { storedTransfer } from "./packageStorage";
import { importWorkerCapacity, runImportWorker } from "./importWorkerProcess";
export { importLines } from "./ndjson";

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
  package?: ReviewedPackage | null;
  openRecords?: (pin: ReviewedPackage) => AsyncIterable<TransferRecord>;
} = {}) {
  const environment = options.environment ??
    (process.env.NODE_ENV === "production" ? "production" : "development");
  const approval = options.approval === undefined ? reviewedImportApproval : options.approval;
  const pin = options.package === undefined ? reviewedPackage : options.package;
  const binding = approval ?? reviewedAccountBinding;
  const operations = new Map<string, "running" | "uncertain">();
  const base = "/api/admin/company-import";
  app.all(`${base}/*`, requireBenchmarkAdmin, adminActionOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    // Bearer/MCP credentials and a body's claimed owner do NOT grant import.
    if (!req.isAuthenticated?.() || !req.session || !req.user?.id)
      return res.status(401).json({ error: "Owner browser session required" });
    const owner = String(req.user.id);
    if (!binding.confirmed || owner !== binding.targetOwner || environment !== binding.targetEnvironment)
      return res.status(403).json({ error: "Owner/environment binding mismatch" });
    const auth = { ownerKey: owner, isOwner: true, csrfVerified: false };
    try {
      const service = async () => options.service ??
        new OwnerImportService(await getPool(), environment, true);
      const importApproved = !!approval?.confirmed && approval.importApproved && !!pin &&
        approval.sourceOwner === reviewedAccountBinding.sourceOwner &&
        approval.sourceEnvironment === "development" &&
        approval.revision === pin.manifest.revision &&
        approval.sourceWorkspace === pin.manifest.sourceWorkspace &&
        pin.manifest.scope === "new-country" &&
        pin.manifest.sourceBWorkspace === reviewedAccountBinding.sourceBWorkspace &&
        approval.manifestHash === pin.manifestHash &&
        semanticHash(pin.manifest) === pin.manifestHash;
      if (req.method === "GET" && req.path === `${base}/status`) {
        const session = req.session as any;
        session.companyImportCsrf ??= randomBytes(32).toString("hex");
        const durable = importApproved ? await (await service()).status(auth, pin!.manifest) : null;
        const local = operations.get(owner);
        const capacity = !importApproved || !!options.service || await importWorkerCapacity();
        const readiness = !importApproved ? "awaiting_owner_approval" :
          durable?.state === "imported_shadow" ? "imported_shadow" :
          local ?? (durable?.state === "empty" ? capacity ? "ready" : "blocked" : "uncertain");
        return res.json({ csrfToken: session.companyImportCsrf, activated: false,
          bindingConfirmed: true, scope: "new-country", importApproved, readiness,
          operation: durable, package: pin ? {
            revision: pin.manifest.revision, semanticHash: pin.manifest.semanticHash,
            manifestHash: pin.manifestHash, recordCount: pin.manifest.recordCount,
            documentCount: pin.documentCount, archiveCount: pin.archiveCount,
            ndjsonBytes: pin.ndjsonBytes,
          } : undefined, error: capacity ? undefined : "Недостаточно свободной памяти для отдельного процесса переноса." });
      }
      // No upload/grant/consume endpoint: the browser sends no file or locator.
      if (req.path !== `${base}/start`) return res.status(404).json({ error: "Unknown import operation" });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!importApproved || !pin) return res.status(423).json({ error: "Import not authorized", activated: false });
      if (!csrf(req)) return res.status(403).json({ error: "CSRF verification required" });
      auth.csrfVerified = true;
      if (req.body?.confirm !== true || req.body?.manifestHash !== pin.manifestHash ||
          Object.keys(req.body).some(k => !["confirm", "manifestHash"].includes(k)) ||
          !validManifest(pin.manifest)) throw new Error("Reviewed confirmation required");
      if (operations.has(owner)) throw new Error("Previous operation requires reconciliation");
      if (!options.service && !await importWorkerCapacity())
        throw new Error("Import worker memory reserve unavailable");
      const importer = await service();
      if ((await importer.status(auth, pin.manifest)).state !== "empty")
        throw new Error("Previous durable operation requires reconciliation");
      operations.set(owner, "running");
      try {
        const token = await importer.grant(auth, pin.manifest, owner, 600_000);
        // Persisted grant + transactional candidate give a read-only recovery
        // signal after disconnect/restart. Never automatically resume/retry.
        void (async () => {
          try {
            if (options.service) await importer.consume(auth, token, pin.manifest,
              (options.openRecords ?? storedTransfer)(pin), false);
            else await runImportWorker(pin, auth, token, environment);
            operations.delete(owner);
          } catch {
            operations.set(owner, "uncertain");
            console.warn("[CompanyImport] Import did not confirm; reconcile durable status; no retry.");
          }
        })();
        return res.status(202).json({ state: "running", activated: false });
      } catch (error) {
        operations.set(owner, "uncertain");
        throw error;
      }
    } catch {
      // Never disclose SQL, token, account identifiers or package contents.
      return res.status(409).json({ error: "Import refused; candidate not confirmed. Inspect private audit before retry." });
    }
  });
}
