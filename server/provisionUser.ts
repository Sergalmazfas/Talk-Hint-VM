import { storage } from "./storage";
import { registerUser } from "./auth";

/**
 * One-time user provisioning bootstrap.
 *
 * The production database is managed by Replit and cannot be written to directly
 * from the agent tooling. To create a brand-new account AND attach a phone number
 * to it (which the normal API blocks for free accounts), the running production
 * server must do the work. This runs on startup when `ADMIN_PROVISION_USER` is
 * set, then becomes a safe no-op once the account is fully set up.
 *
 * Secret format (JSON):
 *   {"email":"leo@talkhint.app","password":"...","name":"Leo"}
 *   - email/password are required (the login credentials)
 *   - name is the phone number's display name (defaults to the email's local part)
 *
 * Steps (each idempotent):
 *   1. Create the user if it doesn't exist.
 *   2. Ensure the plan allows a phone number (free/none -> "basic").
 *   3. Assign the first free pool number if the user has none.
 *
 * Operational flow:
 *   1. Set ADMIN_PROVISION_USER to the JSON above.
 *   2. Publish. Startup logs confirm each step.
 *   3. REMOVE the ADMIN_PROVISION_USER secret and re-publish (so credentials are
 *      not stored in plaintext as a secret).
 *
 * Plaintext password is never logged. Failures never block startup.
 */
export async function provisionUserOnStartup(): Promise<void> {
  const raw = process.env.ADMIN_PROVISION_USER;
  if (!raw) return;

  let spec: { email?: string; password?: string; name?: string };
  try {
    spec = JSON.parse(raw);
  } catch {
    console.warn(
      '[Provision] ADMIN_PROVISION_USER is set but is not valid JSON — expected {"email","password","name"}. Skipping.',
    );
    return;
  }

  const email = (spec.email || "").trim().toLowerCase();
  const password = spec.password || "";
  const name = (spec.name || email.split("@")[0] || "User").trim();

  if (!email || !password) {
    console.warn(
      "[Provision] ADMIN_PROVISION_USER missing email or password — skipping.",
    );
    return;
  }

  try {
    // 1) Create the user if missing.
    let user = await storage.getUserByEmail(email);
    if (!user) {
      user = await registerUser(email, password);
      console.log(`[Provision] Created user ${email} (${user.id}).`);
    } else {
      console.log(`[Provision] User ${email} already exists (${user.id}).`);
    }

    // 2) Ensure the plan allows a phone number.
    if (!user.plan || user.plan === "free" || user.plan === "none") {
      const updated = await storage.updateUser(user.id, { plan: "basic" });
      if (updated) user = updated;
      console.log(`[Provision] Set plan=basic for ${email}.`);
    }

    // 3) Assign a free pool number if the user has none.
    const existing = await storage.getUserPhoneNumbers(user.id);
    if (existing.length > 0) {
      console.log(
        `[Provision] ${email} already has ${existing.length} number(s) — skipping assignment.`,
      );
    } else {
      const available = await storage.getAvailableNumbers();
      if (available.length === 0) {
        console.warn(
          `[Provision] No free numbers in the pool — could not assign one to ${email}.`,
        );
      } else {
        // Numbers can race (another assignment may take the locked row), so try
        // each candidate until one is claimed.
        let assigned = false;
        for (const candidate of available) {
          try {
            const pn = await storage.assignNumber(
              candidate.id,
              user.id,
              name,
              "personal",
            );
            console.log(
              `[Provision] Assigned number ${pn.twilioNumber} to ${email} (name "${name}").`,
            );
            assigned = true;
            break;
          } catch (err: any) {
            console.warn(
              `[Provision] Could not claim ${candidate.twilioNumber} (${err?.message ?? err}) — trying next.`,
            );
          }
        }
        if (!assigned) {
          console.error(
            `[Provision] Failed to assign any number to ${email} — all candidates were taken.`,
          );
        }
      }
    }

    console.log(
      `[Provision] Done for ${email}. REMOVE the ADMIN_PROVISION_USER secret and re-publish so credentials are not stored in plaintext.`,
    );
  } catch (e: any) {
    console.error(`[Provision] Failed for ${email}:`, e?.message ?? e);
  }
}
