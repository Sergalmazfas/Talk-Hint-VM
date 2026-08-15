// Admin gate for the benchmark endpoints. TalkHint has no isAdmin column, so
// admin identity is derived from the ADMIN_PROVISION_USER secret (the same
// JSON used to provision the owner's account: {email, ...} or an array of
// such objects). Only those emails may access the benchmark bench.
// Fail-closed: no secret configured => nobody is admin.

import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../auth";

function adminEmails(): string[] {
  const emails: string[] = [];
  const raw = process.env.ADMIN_PROVISION_USER;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const u of list) {
        if (typeof (u as any)?.email === "string") emails.push((u as any).email.trim().toLowerCase());
      }
    } catch {
      // not JSON (e.g. "email:password" provisioning shorthand) — ignore here
    }
  }
  // Additional admins: plain comma-separated email list, no credentials —
  // lets the owner's real account get admin without touching the
  // provisioning secret (which also carries a password).
  const extra = process.env.BENCHMARK_ADMIN_EMAILS;
  if (extra) {
    for (const e of extra.split(",")) {
      const t = e.trim().toLowerCase();
      if (t) emails.push(t);
    }
  }
  return emails.filter(Boolean);
}

export function isBenchmarkAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export function requireBenchmarkAdmin(req: Request, res: Response, next: NextFunction) {
  // Reuse the standard auth middleware, then check the admin allowlist.
  authMiddleware(req, res, () => {
    const email = (req as any).user?.email as string | undefined;
    if (!isBenchmarkAdmin(email)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}
