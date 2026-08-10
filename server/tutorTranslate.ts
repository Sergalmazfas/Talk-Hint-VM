// Server-side translation for Emma's tutor cards. The Tutor Engine does not
// send card translations (and cannot be changed), so TalkHint translates the
// EXACT card text via the already-connected OpenAI key. Auth-scoped route,
// in-memory cache keyed by normalized text so repeat taps are instant and
// never re-bill the model.
const MODEL = "gpt-4.1-mini"; // same fast fallback model used for live hints
const MAX_TEXT_LEN = 2000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 8000;

// Simple bounded LRU-ish cache (insertion order eviction is fine here).
const cache = new Map<string, string>();

function cacheKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getCachedTranslation(text: string): string | undefined {
  return cache.get(cacheKey(text));
}

export function putCachedTranslation(text: string, translation: string) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey(text), translation);
}

export function clearTranslationCache() {
  cache.clear();
}

/** Validates the request body. Returns an error string or null when valid. */
export function validateTranslateInput(body: any): string | null {
  const text = body?.text;
  if (typeof text !== "string" || !text.trim()) return "text_required";
  if (text.length > MAX_TEXT_LEN) return "text_too_long";
  return null;
}

async function callOpenAI(text: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              'You are a translator. Translate the user\'s message into Russian. Keep tone and meaning; do not add commentary. Respond with ONLY this JSON and nothing else: {"translation":"<the Russian translation>"}',
          },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        max_tokens: 600,
      }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI API error: ${response.status} ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    const raw: string = data.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const t = String(JSON.parse(m[0]).translation ?? "").trim();
        if (t) return t;
      } catch {
        /* fall through to plain text */
      }
    }
    return raw.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translates tutor card text into Russian. Cache hit returns instantly;
 * otherwise one OpenAI call. Throws on model/network failure (route maps it
 * to an explicit 502 — no silent fallback text).
 */
export async function translateTutorText(
  text: string,
  generate: (text: string) => Promise<string> = callOpenAI,
): Promise<{ translation: string; cached: boolean }> {
  const hit = getCachedTranslation(text);
  if (hit !== undefined) return { translation: hit, cached: true };
  const translation = await generate(text);
  if (!translation) throw new Error("empty translation from model");
  putCachedTranslation(text, translation);
  return { translation, cached: false };
}
