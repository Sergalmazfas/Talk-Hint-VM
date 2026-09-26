const REPLY_TTL_MS = 30 * 60_000;
const MAX_REGISTERED_REPLIES = 512;
const MAX_TEXT_LENGTH = 1_000;

type VerifiedReply = {
  userId: string;
  callSid: string;
  holdId: string;
  responseId: string;
  text: string;
  expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout>;
};

const verifiedReplies = new Map<string, VerifiedReply>();

export function isLatinCopilotReply(text: string) {
  let hasLatinLetter = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      hasLatinLetter = true;
      continue;
    }
    // Keep ASCII punctuation/digits/spacing and common Latin-script extensions,
    // but fail closed on all other scripts (including Cyrillic) and surrogates.
    if ((code >= 0x20 && code <= 0x7e) ||
        (code >= 0x00c0 && code <= 0x02af) ||
        (code >= 0x1e00 && code <= 0x1eff) ||
        (code >= 0x2c60 && code <= 0x2c7f) ||
        (code >= 0xa720 && code <= 0xa7ff) ||
        (code >= 0xab30 && code <= 0xab6f) ||
        (code >= 0xff21 && code <= 0xff5a) ||
        (code >= 0x2000 && code <= 0x200a) ||
        (code >= 0x2010 && code <= 0x2015) ||
        (code >= 0x2018 && code <= 0x201f) ||
        code === 0x00a0 || code === 0x2022 || code === 0x2026 ||
        code === 0x09 || code === 0x0a || code === 0x0d) continue;
    return false;
  }
  return hasLatinLetter;
}

function replyKey(userId: string, callSid: string, holdId: string, responseId: string) {
  return `${userId}\u0000${callSid}\u0000${holdId}\u0000${responseId}`;
}

function pruneReplies(now = Date.now()) {
  verifiedReplies.forEach((reply, key) => {
    if (reply.expiresAt <= now) {
      clearTimeout(reply.expiryTimer);
      verifiedReplies.delete(key);
    }
  });
}

/** Keep only completed, source-attributed replies in volatile memory. */
export function registerVerifiedCopilotReply(
  userId: string, callSid: string, holdId: string, responseId: string, text: string,
) {
  if (!userId || !/^CA[0-9a-f]{32}$/i.test(callSid) ||
      !holdId || holdId.length > 128 || !responseId || responseId.length > 256 ||
      !text.trim() || text.length > MAX_TEXT_LENGTH || !isLatinCopilotReply(text)) return;
  pruneReplies();
  if (verifiedReplies.size >= MAX_REGISTERED_REPLIES) {
    const oldest = verifiedReplies.keys().next().value;
    if (oldest) {
      const evicted = verifiedReplies.get(oldest);
      if (evicted) clearTimeout(evicted.expiryTimer);
      verifiedReplies.delete(oldest);
    }
  }
  const key = replyKey(userId, callSid, holdId, responseId);
  const old = verifiedReplies.get(key);
  if (old) clearTimeout(old.expiryTimer);
  const expiresAt = Date.now() + REPLY_TTL_MS;
  const expiryTimer = setTimeout(() => {
    if (verifiedReplies.get(key)?.expiresAt === expiresAt) verifiedReplies.delete(key);
  }, REPLY_TTL_MS);
  expiryTimer.unref?.();
  verifiedReplies.set(key, { userId, callSid, holdId, responseId, text, expiresAt, expiryTimer });
}

export function consumeVerifiedCopilotReply(
  userId: string, callSid: string, holdId: string, responseId: string, text: string,
) {
  pruneReplies();
  const key = replyKey(userId, callSid, holdId, responseId);
  const reply = verifiedReplies.get(key);
  if (!reply || reply.text !== text) return false;
  // Make each verified response usable once, even if the provider subsequently fails.
  clearTimeout(reply.expiryTimer);
  verifiedReplies.delete(key);
  return true;
}

export function clearVerifiedCopilotRepliesForTests() {
  verifiedReplies.forEach(reply => clearTimeout(reply.expiryTimer));
  verifiedReplies.clear();
}