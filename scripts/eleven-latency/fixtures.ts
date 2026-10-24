import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ELEVEN_CATALOG } from "../../server/secretaryLab/elevenApi";

const content = {
  en: { text: "Hello. Please say briefly what you can help with in this test.",
    number: ["My number is three zero five.", "Two one seven. No, correction, two one eight. Nine zero zero zero."],
    address: ["The test address is twenty.", "Ocean Drive. No, correction, thirty Ocean Drive, apartment four."] },
  ru: { text: "Теперь отвечай по-русски. Скажи коротко, чем ты можешь помочь в этом тесте.",
    number: ["Мой номер три ноль пять.", "Два один семь. Нет, поправка, два один восемь. Девять ноль ноль ноль."],
    address: ["Тестовый адрес: дом двадцать.", "Оушен Драйв. Нет, поправка, дом тридцать, квартира четыре."] },
  es: { text: "Ahora responde en español. Dime brevemente qué puedes hacer en esta prueba.",
    number: ["Mi número es tres cero cinco.", "Dos uno siete. No, corrijo, dos uno ocho. Nueve cero cero cero."],
    address: ["La dirección de prueba es veinte.", "Ocean Drive. No, corrijo, treinta Ocean Drive, apartamento cuatro."] },
};
export const fixtureDefinitions = Object.entries(content).flatMap(([language, c]) =>
  (["number", "address"] as const).flatMap(kind => c[kind].map((text, part) => ({
    key: `${language}-${kind}-${part}`, text,
  }))));
const model = "eleven_multilingual_v2";
const key = (text: string) => createHash("sha256").update(JSON.stringify({ text, model, voice: ELEVEN_CATALOG.voiceId, format: "pcm_16000" })).digest("hex");
export const fixtureManifest = fixtureDefinitions.map(f => ({ ...f, cacheKey: key(f.text), model,
  voice: ELEVEN_CATALOG.voiceId, format: "pcm_16000", generatedPcmIsNotHumanSpeech: true }));
export async function loadFixtures(out: string, maxCharacters: number, beforePaid: (text: string) => void,
  signal?: AbortSignal, onFixture?: (key: string, sha256: string, bytes: number) => void) {
  const audio = new Map<string, Buffer>(), missing = [];
  for (const f of fixtureDefinitions) {
    try {
      const b = await readFile(`${out}/${key(f.text)}.pcm`);
      if (!b.length || b.length % 2) throw Error("Invalid cached PCM");
      audio.set(f.key, b);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      missing.push(f);
    }
  }
  const needed = missing.reduce((n, f) => n + f.text.length, 0);
  if (needed > maxCharacters) throw Error(`Fixture budget requires ${needed} characters; --max-fixture-characters=${maxCharacters}`);
  for (const f of missing) {
    beforePaid(f.text);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_CATALOG.voiceId}?output_format=pcm_16000`, {
      method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text: f.text, model_id: model }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!r.ok) throw Error(`Fixture synthesis HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (!b.length || b.length % 2) throw Error("Invalid synthesized PCM");
    await writeFile(`${out}/${key(f.text)}.pcm`, b); audio.set(f.key, b);
  }
  for (const [name, b] of audio) onFixture?.(name, createHash("sha256").update(b).digest("hex"), b.length);
  const result = new Map<string, { text?: string; before?: Buffer; after?: Buffer }>();
  for (const [language, c] of Object.entries(content)) {
    result.set(`${language}-text`, { text: c.text });
    for (const kind of ["number", "address"]) result.set(`${language}-${kind}`, {
      before: audio.get(`${language}-${kind}-0`), after: audio.get(`${language}-${kind}-1`),
    });
  }
  return result;
}
