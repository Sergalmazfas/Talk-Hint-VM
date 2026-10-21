export const PROFILE_KEYS = ["personal", "work"] as const;
export type CallProfile = typeof PROFILE_KEYS[number];
export type CardScope = CallProfile | "shared";
export const WORK_NUMBER_CANDIDATE = { id: "f23589ca-5da1-465b-86a4-f5ac4616f9f8", phoneNumber: "+19548592875" } as const;
// This is an owner-approved setup plan, not a new entitlement for every account.
export const WORK_NUMBER_OWNER = "47704265";

export function validCardScope(value: unknown): value is CardScope {
  return value === "personal" || value === "work" || value === "shared";
}
export function numberProfile(type: string): CallProfile { return type === "work" ? "work" : "personal"; }

/** Legacy callers keep the personal line, regardless of database row order. */
export function defaultCallingNumber<T extends { id: string; type: string; createdAt?: Date | string }>(numbers: T[]): T | undefined {
  return [...numbers].sort((a, b) =>
    Number(a.type === "work") - Number(b.type === "work") ||
    new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime() ||
    a.id.localeCompare(b.id))[0];
}

/** No call identity => no private knowledge. Legacy cards remain personal. */
export function cardsForCall<T extends { userId: string; profileScope?: string | null }>(
  cards: T[], ownerId: string, profile?: CallProfile,
): T[] {
  if (!profile) return [];
  return cards.filter(c => c.userId === ownerId &&
    ((c.profileScope ?? "personal") === profile || c.profileScope === "shared"));
}

export function profileForCall(
  ownerId: string, call: { userId: string | null; direction: string; fromNumber: string | null; toNumber: string | null } | undefined,
  numbers: Array<{ userId: string; twilioNumber: string; type: string }>,
): CallProfile | undefined {
  if (!call || call.userId !== ownerId) return undefined;
  const ownNumber = call.direction === "incoming" ? call.toNumber :
    call.direction === "outgoing" ? call.fromNumber : undefined;
  const assigned = numbers.find(n => n.userId === ownerId && n.twilioNumber === ownNumber);
  return assigned ? numberProfile(assigned.type) : undefined;
}

export function verifyNumberRouting(number: {
  foundOnMain: boolean; voiceEnabled: boolean; voiceUrl: string; statusCallback: string;
  voiceMethod: string; usesVoiceApplication: boolean;
}): boolean {
  const expected = (raw: string, path: string) => {
    try {
      const u = new URL(raw);
      return ["https://talkhint.app", "https://talk-hint-vm.replit.app"].includes(u.origin) &&
        u.pathname === path && !u.search && !u.hash && !u.username && !u.password;
    } catch { return false; }
  };
  return number.foundOnMain && number.voiceEnabled && !number.usesVoiceApplication &&
    number.voiceMethod === "POST" && expected(number.voiceUrl, "/twilio/voice") &&
    expected(number.statusCallback, "/twilio/status");
}
