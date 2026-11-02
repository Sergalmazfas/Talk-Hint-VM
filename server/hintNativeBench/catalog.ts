import { z } from "zod";
import type { Provider } from "./contracts";

export type Catalog = {
  provider: Provider; checkedAt: string; complete: true;
  pages: { httpStatus: number; requestId: string | null }[];
  models: { id: string; methods: string[] }[];
};
/** GET only; pagination is essential (the first default Gemini page has no Live IDs). */
export async function readCatalog(provider: Provider, fetcher: typeof fetch = fetch): Promise<Catalog> {
  const models: Catalog["models"] = [], pages: Catalog["pages"] = [];
  let pageToken = "";
  const tokens = new Set<string>();
  do {
    const url = new URL(provider === "openai"
      ? "https://api.openai.com/v1/models" : "https://generativelanguage.googleapis.com/v1beta/models");
    if (provider === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
    }
    const headers: Record<string, string> = provider === "openai"
      ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      : { "x-goog-api-key": process.env.GEMINI_API_KAY ?? "" };
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000), redirect: "error" });
    pages.push({ httpStatus: response.status, requestId: response.headers.get("x-request-id") });
    if (!response.ok) throw Error("CATALOG_HTTP_" + response.status);
    const raw = await response.json();
    if (provider === "openai") {
      const parsed = z.object({ data: z.array(z.object({ id: z.string().min(1) })) }).parse(raw);
      models.push(...parsed.data.map(m => ({ id: m.id, methods: [] })));
      pageToken = "";
    } else {
      const parsed = z.object({
        models: z.array(z.object({
          name: z.string().min(1), supportedGenerationMethods: z.array(z.string()).default([]),
        })),
        nextPageToken: z.string().optional(),
      }).parse(raw);
      models.push(...parsed.models.map(m => ({ id: m.name, methods: m.supportedGenerationMethods })));
      pageToken = parsed.nextPageToken ?? "";
      if (pageToken && (tokens.has(pageToken) || pages.length >= 20)) throw Error("INCOMPLETE_CATALOG");
      tokens.add(pageToken);
    }
  } while (pageToken);
  if (new Set(models.map(m => m.id)).size !== models.length) throw Error("DUPLICATE_CATALOG_ID");
  return { provider, checkedAt: new Date().toISOString(), complete: true, pages, models };
}
export function selectedModel(catalog: Catalog, model: string) {
  const found = catalog.models.find(m => m.id === model);
  if (!found) throw Error("MODEL_NOT_IN_VERIFIED_CATALOG");
  if (catalog.provider === "gemini" && !found.methods.includes("bidiGenerateContent"))
    throw Error("MODEL_HAS_NO_LIVE_METHOD");
  return found.id;
}
