import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isBenchmarkAdmin } from "./benchmark/adminGate";

const tickets = new Map<string, { email: string; expires: number }>();
export function issueAdminWebTicket(email: string) {
  for (const [key, value] of Array.from(tickets)) if (value.expires <= Date.now()) tickets.delete(key);
  if (!isBenchmarkAdmin(email) || tickets.size >= 100) return undefined;
  const ticket = randomBytes(32).toString("hex");
  tickets.set(ticket, { email, expires: Date.now() + 30_000 });
  return ticket;
}
/** Technical WS upgrades bypass Express; require the authenticated admin's
 * single-use ticket as well as the stand's original token. Never for PSTN/iOS. */
export function consumeAdminWebTicket(request: IncomingMessage, ticket: string | null) {
  if (!ticket) return false;
  const item = tickets.get(ticket);
  tickets.delete(ticket);
  if (!item || item.expires <= Date.now() || !isBenchmarkAdmin(item.email)) return false;
  try {
    const origin = new URL(request.headers.origin ?? "");
    return ["http:", "https:"].includes(origin.protocol) && origin.host === request.headers.host;
  } catch { return false; }
}
