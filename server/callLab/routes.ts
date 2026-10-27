import type { Express } from "express";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { pool } from "../db";
import { labConfiguration, abortHintLabProcessing } from "./service";
import { checkHintLabRuntime } from "./process";
import { GmailLabMail } from "./mail";
import { hintWatchdogStatus } from "./watchdog";

export function registerCallLabRoutes(app: Express) {
  // Only an explicit owner action after readiness checks can leave startup pause.
  // A new activation excludes calls made before it, including while paused.
  app.post("/api/admin/call-lab/enable", requireBenchmarkAdmin, async (req, res) => {
    const config = labConfiguration();
    if (!config.owner || String((req as any).user?.id) !== config.owner)
      return res.status(403).json({ error: "Owner only" });
    if (!pool || !config.allowed) return res.status(503).json({ error: "Lab runtime not configured" });
    if (req.body?.confirm !== "hint-owner-only")
      return res.status(400).json({ error: "Explicit Hint-owner-only confirmation required" });
    try {
      const key = `${config.environment}:${config.owner}`;
      const control = (await pool.query("SELECT * FROM call_lab_controls WHERE key=$1", [key])).rows[0];
      if (!control) return res.status(503).json({ error: "Owner control not ready" });
      await checkHintLabRuntime(); // imports/version only, never runs agents
      await new GmailLabMail().verify(control);
      await pool.query(`UPDATE call_lab_controls SET enabled=true,activated_at=now()
        WHERE key=$1 AND enabled=false`, [key]);
      res.json({ enabled: true, scope: "Hint / owner / new calls after activation",
        noHistoricalReplay: true, restartPausesAgain: process.env.LAB_START_PAUSED === "true" });
    } catch {
      res.status(503).json({ error: "Readiness check failed; activation not confirmed" });
    }
  });
  app.get("/api/admin/call-lab/status", requireBenchmarkAdmin, async (req, res) => {
    const config = labConfiguration();
    if (!config.owner) return res.status(503).json({ error: "Owner Gmail binding not ready", configured: false });
    if (String((req as any).user?.id) !== config.owner) return res.status(403).json({ error: "Owner only" });
    if (!pool) return res.status(503).json({ error: "Database unavailable" });
    try {
      const control = (await pool.query(`SELECT environment,enabled,activated_at,watchdog FROM call_lab_controls WHERE key=$1`,
        [`${config.environment}:${config.owner}`])).rows[0] ?? null;
      const jobs = (await pool.query(`SELECT status,coalesce(report->>'synthetic'='true',false) AS synthetic,count(*)::int AS count FROM call_lab_jobs
        WHERE environment=$1 AND owner_id=$2 GROUP BY status,synthetic`, [config.environment, config.owner])).rows;
      const outbox = (await pool.query(`SELECT o.status,coalesce(j.report->>'synthetic'='true',false) AS synthetic,count(*)::int AS count
        FROM call_lab_outbox o JOIN call_lab_jobs j ON j.key=o.key
        WHERE o.environment=$1 AND o.owner_id=$2 GROUP BY o.status,synthetic`, [config.environment, config.owner])).rows;
      const missingEnd = (await pool.query(`SELECT count(*)::int AS count FROM calls WHERE user_id=$1
        AND metadata#>>'{labHintSource,mode}'='hint' AND metadata#>>'{labHintSource,environment}'=$2
        AND ended_at IS NULL`, [config.owner, config.environment])).rows[0].count;
      const recent = (await pool.query(`SELECT key,status,created_at,updated_at,(report IS NOT NULL) AS has_report,
        coalesce(report->>'synthetic'='true',false) AS synthetic
        FROM call_lab_jobs WHERE environment=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 20`,
      [config.environment, config.owner])).rows.map(r => ({
        ...r, downloadPath: r.has_report ? `/api/admin/call-lab/reports/${r.key}` : null,
      }));
      res.json({ environment: config.environment, configured: config.allowed, control, jobs, outbox,
        watchdog: hintWatchdogStatus(),
        recent, awaitingConfirmedCallEnd: missingEnd, scope: "Hint / owner / existing text only",
        note: "SENT confirms Gmail submission, not the owner's reading or QA acceptance",
        private: true, publishedByAgent: false });
    } catch { res.status(503).json({ error: "Private lab schema is not ready" }); }
  });
  app.post("/api/admin/call-lab/disable", requireBenchmarkAdmin, async (req, res) => {
    const config = labConfiguration();
    if (String((req as any).user?.id) !== config.owner) return res.status(403).json({ error: "Owner only" });
    if (!pool) return res.status(503).json({ error: "Database unavailable" });
    try {
      await pool.query("UPDATE call_lab_controls SET enabled=false WHERE key=$1", [`${config.environment}:${config.owner}`]);
      abortHintLabProcessing();
      res.json({ disabled: true, noNewMail: true, note: "Already submitted Gmail requests cannot be recalled" });
    } catch { res.status(503).json({ error: "Disable failed; set LAB_ENABLED=false in protected settings" }); }
  });
  app.get("/api/admin/call-lab/reports/:key", requireBenchmarkAdmin, async (req, res) => {
    const config = labConfiguration();
    if (!config.owner || String((req as any).user?.id) !== config.owner) return res.status(403).json({ error: "Owner only" });
    if (!pool || !/^[a-f0-9]{64}$/.test(req.params.key)) return res.status(404).json({ error: "Not found" });
    try {
      const row = (await pool.query(`SELECT report FROM call_lab_jobs WHERE key=$1
        AND environment=$2 AND owner_id=$3 AND report IS NOT NULL`,
      [req.params.key, config.environment, config.owner])).rows[0];
      if (!row) return res.status(404).json({ error: "Not found" });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="hint-lab-${req.params.key}.json"`);
      res.json(row.report);
    } catch { res.status(503).json({ error: "Report temporarily unavailable" }); }
  });
}
