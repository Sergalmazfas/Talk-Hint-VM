import { isBenchmarkAdmin } from "./benchmark/adminGate";

/** The authenticated OIDC identity must match the existing stored owner. */
export function mayEnterAdminWeb(account: { id: string; email: string }, claims: any): boolean {
  return claims?.sub === account.id && typeof claims?.email === "string" &&
    claims.email.trim().toLowerCase() === account.email.trim().toLowerCase() &&
    isBenchmarkAdmin(account.email);
}
