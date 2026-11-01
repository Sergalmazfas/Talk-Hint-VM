import { randomUUID } from "node:crypto";

export const CREW_TEST_ENDPOINT = "https://talkhint.app/api/crew-test/mcp";
export function crewTestDeadline(method: string, params?: any) {
  // Large, read-only production audit was taking 35–37s. Writes keep the old
  // deadline and STOP semantics; no retries or extra authority are introduced.
  return method === "tools/call" && params?.name === "crew_structure_check" ? 90_000 : 20_000;
}
export async function crewTestRpc(method: string, params: unknown, key: string, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await fetcher(CREW_TEST_ENDPOINT, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(crewTestDeadline(method, params)),
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }) });
  const b = await r.json() as any;
  if (!r.ok || b.error || b.result?.isError) throw Error("MCP_UNCONFIRMED_STOP_NO_RETRY");
  return method === "tools/call" ? JSON.parse(b.result.content[0].text) : b.result;
}
