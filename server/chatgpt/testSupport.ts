import type { Marker, MarkerStore } from "./security";

/** In-memory substitute used only by explicitly isolated test fixtures. */
export function testMarkerStore(): MarkerStore {
  const rows = new Map<string, Marker>();
  return {
    async put(row) { if (!rows.has(row.id)) rows.set(row.id, row); },
    async get(id) {
      const row = rows.get(id);
      return row && row.expiresAt.getTime() > Date.now() ? row : undefined;
    },
    async consume(id) {
      const row = rows.get(id);
      if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
      rows.set(id, { ...row, expiresAt: new Date(0) });
      return row;
    },
    async list(userId) {
      return Array.from(rows.values()).filter(row => row.userId === userId &&
        row.id.startsWith("chatgpt:grant:") && row.expiresAt.getTime() > Date.now());
    },
    async expire(id, userId) {
      const row = rows.get(id);
      if (row?.userId === userId) rows.set(id, { ...row, expiresAt: new Date(0) });
    },
  };
}
