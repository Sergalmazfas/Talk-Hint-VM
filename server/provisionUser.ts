import { storage } from "./storage";
import { registerUser } from "./auth";
import { validateUserWebhookUrl } from "./airatomaWebhook";

/**
 * One-time user provisioning bootstrap.
 *
 * The production database is managed by Replit and cannot be written to directly
 * from the agent tooling, and the public POST /api/numbers endpoint blocks
 * free-plan users from getting a number. To onboard internal employee accounts
 * (login + a phone number + optional AirAtoma CRM hookup), the running production
 * server does it on startup when `ADMIN_PROVISION_USER` is set, then becomes a
 * safe no-op once each account is fully set up.
 *
 * Secret format (JSON) — a single object OR an array of objects:
 *   {"email":"...","password":"...","name":"Leo","number":"+17867331025",
 *    "airatoma":"https://.../api/talkhint/webhook/<token>"}
 *   - email / password  : required (login credentials)
 *   - name              : phone number display name (default = email local part)
 *   - plan              : optional, default "employee" (see below)
 *   - number            : optional specific free pool number to assign. If omitted,
 *                         the first free number is used. If the requested number is
 *                         missing or already taken, the user gets NO number (no
 *                         fallback) so it is obvious in the logs.
 *   - airatoma          : optional per-user AirAtoma webhook URL. Validated exactly
 *                         like POST /api/settings/airatoma (SSRF-guarded).
 *
 * These are internal employee accounts, NOT paying subscribers. The app's only
 * access gate is `plan !== "free"/"none"`, so we mark them "employee" — full
 * access, no Stripe billing.
 *
 * Each step is idempotent: an existing user is reused, the plan is only set when
 * free/none/empty, the AirAtoma URL is only written when it differs, and a number
 * is only assigned when the user has none.
 *
 * Operational flow:
 *   1. Set ADMIN_PROVISION_USER to the JSON above.
 *   2. Publish. Startup logs confirm each step.
 *   3. REMOVE the ADMIN_PROVISION_USER secret and re-publish (so credentials are
 *      not stored in plaintext as a secret).
 *
 * Plaintext passwords are never logged. Failures never block startup.
 */

interface ProvisionSpec {
  email?: string;
  password?: string;
  name?: string;
  plan?: string;
  number?: string;
  airatoma?: string;
}

/**
 * Normalize a phone string to E.164-ish "+<digits>" (strips spaces, dashes,
 * parens and any pre-existing "+"). Returns "" when there are no digits, so an
 * empty/garbage value can never accidentally match a pool number.
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? "+" + digits : "";
}

export async function provisionUserOnStartup(): Promise<void> {
  const raw = process.env.ADMIN_PROVISION_USER;
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[Provision] ADMIN_PROVISION_USER is not valid JSON — expected an object or array of {email,password,name,number?,airatoma?}. Skipping.",
    );
    return;
  }

  const specs: ProvisionSpec[] = Array.isArray(parsed)
    ? (parsed as ProvisionSpec[])
    : [parsed as ProvisionSpec];

  for (const spec of specs) {
    await provisionOne(spec);
  }
}

async function provisionOne(spec: ProvisionSpec): Promise<void> {
  const email = (spec.email || "").trim().toLowerCase();
  const password = spec.password || "";
  const name = (spec.name || email.split("@")[0] || "User").trim();

  if (!email || !password) {
    console.warn("[Provision] Entry missing email or password — skipping.");
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

    // 2) Employee access marker (not a paid subscription).
    const accessPlan = (spec.plan || "employee").trim() || "employee";
    if (!user.plan || user.plan === "free" || user.plan === "none") {
      const updated = await storage.updateUser(user.id, { plan: accessPlan });
      if (updated) user = updated;
      console.log(`[Provision] Set plan=${accessPlan} for ${email}.`);
    }

    // 3) Optional AirAtoma webhook URL (same validation as the settings route).
    const airatoma = (spec.airatoma || "").trim();
    if (airatoma) {
      const err = validateUserWebhookUrl(airatoma);
      if (err) {
        console.warn(
          `[Provision] AirAtoma URL for ${email} rejected (${err}) — not set. Fix the URL and re-publish.`,
        );
      } else if (user.airatomaWebhookUrl === airatoma) {
        console.log(`[Provision] AirAtoma URL already set for ${email}.`);
      } else {
        const updated = await storage.updateUser(user.id, {
          airatomaWebhookUrl: airatoma,
        });
        if (updated) user = updated;
        console.log(`[Provision] Set AirAtoma webhook URL for ${email}.`);
      }
    }

    // 4) Assign a number if the user has none.
    const existing = await storage.getUserPhoneNumbers(user.id);
    if (existing.length > 0) {
      console.log(
        `[Provision] ${email} already has ${existing.length} number(s) — skipping assignment.`,
      );
    } else if (spec.number) {
      // Assign the specific requested number — no fallback if it's unavailable.
      const requested = normalizePhone(spec.number);
      const all = await storage.getAllAvailableNumbers();
      const match = all.find((n) => n.twilioNumber === requested);
      if (!match) {
        console.error(
          `[Provision] Requested number ${requested} for ${email} is not in the pool — skipping (no fallback).`,
        );
      } else if (match.isAssigned) {
        console.error(
          `[Provision] Requested number ${requested} for ${email} is already assigned — skipping (no fallback).`,
        );
      } else {
        try {
          const pn = await storage.assignNumber(match.id, user.id, name, "personal");
          console.log(
            `[Provision] Assigned requested number ${pn.twilioNumber} to ${email} (name "${name}").`,
          );
        } catch (err: any) {
          console.error(
            `[Provision] Failed to assign requested number ${requested} to ${email}: ${err?.message ?? err}`,
          );
        }
      }
    } else {
      // Assign the first claimable free number.
      const available = await storage.getAvailableNumbers();
      if (available.length === 0) {
        console.warn(
          `[Provision] No free numbers in the pool — could not assign one to ${email}.`,
        );
      } else {
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
