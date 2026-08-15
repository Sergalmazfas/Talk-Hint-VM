// Admin gate for the benchmark endpoints. TalkHint has no isAdmin column, so
// admin identity is derived from the ADMIN_PROVISION_USER secret (the same
// JSON used to provision the owner's account: {email, ...} or an array of
// such objects). Only those emails may access the benchmark bench.
// Fail-closed: no secret configured => nobody is admin.

import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../auth";

function adminEmails(): string[] {
  // Sole source of admin identity: BENCHMARK_ADMIN_EMAILS (comma-separated
  // email list). The ADMIN_PROVISION_USER secret is intentionally NOT used —
  // provisioned service accounts must not get admin automatically (owner's
  // decision 2026-08-15: only his personal account is admin).
  const raw = process.env.BENCHMARK_ADMIN_EMAILS;
  if (!raw) return [];
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
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
