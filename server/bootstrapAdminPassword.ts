import { storage } from "./storage";
import { hashPassword } from "./auth";

/**
 * One-time admin password bootstrap.
 *
 * The production database is managed by Replit and cannot be written to directly
 * from the agent tooling (only read-only access to a replica). To set / reset a
 * password for an account that was created via Google login (and therefore has
 * no password), the running production server itself must perform the write.
 *
 * On startup, if the `ADMIN_SET_PASSWORD` env secret is present, this sets the
 * given account's password. Format: `email:password` (the password may itself
 * contain ":" — only the FIRST ":" is treated as the separator).
 *
 * Operational flow:
 *   1. Set the `ADMIN_SET_PASSWORD` secret to `you@example.com:YourPassword`.
 *   2. Publish. On startup the password is set and a log line confirms it.
 *   3. Log in with email + password.
 *   4. REMOVE the `ADMIN_SET_PASSWORD` secret and re-publish (so the password is
 *      no longer stored in plaintext as a secret).
 *
 * The plaintext password is never logged. Failures never block startup.
 */
export async function bootstrapAdminPasswordOnStartup(): Promise<void> {
  const raw = process.env.ADMIN_SET_PASSWORD;
  if (!raw) return;

  const sep = raw.indexOf(":");
  if (sep <= 0 || sep === raw.length - 1) {
    console.warn(
      "[AdminBootstrap] ADMIN_SET_PASSWORD is set but malformed — expected `email:password`. Skipping.",
    );
    return;
  }

  const email = raw.slice(0, sep).trim().toLowerCase();
  const password = raw.slice(sep + 1);

  try {
    const user = await storage.getUserByEmail(email);
    if (!user) {
      console.warn(
        `[AdminBootstrap] No user found for ${email} — nothing to do. (Check the email matches an existing account.)`,
      );
      return;
    }

    // Safety: only set a password on accounts that don't already have one (i.e.
    // Google/OIDC-only accounts). This prevents an operator with the secret from
    // accidentally (or maliciously) resetting an existing email+password account,
    // and makes the bootstrap idempotent — once set, restarts are a no-op until
    // the secret is removed.
    if (user.password) {
      console.warn(
        `[AdminBootstrap] ${email} already has a password — skipping (no overwrite). ` +
          `Remove the ADMIN_SET_PASSWORD secret; it is now a no-op for this account.`,
      );
      return;
    }

    const hashed = await hashPassword(password);
    const updated = await storage.updateUser(user.id, { password: hashed });

    if (!updated || !updated.password) {
      console.error(
        `[AdminBootstrap] Password update for ${email} did NOT persist (DB write failed). ` +
          `Check write health / DB connectivity and try again.`,
      );
      return;
    }

    console.log(
      `[AdminBootstrap] Password set for ${email}. You can now log in with email + password. ` +
        `REMOVE the ADMIN_SET_PASSWORD secret and re-publish so it is not stored in plaintext.`,
    );
  } catch (e: any) {
    console.error(
      `[AdminBootstrap] Failed to set password for ${email}:`,
      e?.message ?? e,
    );
  }
}
