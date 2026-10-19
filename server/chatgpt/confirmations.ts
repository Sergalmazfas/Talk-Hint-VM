import { activeGrant, Credentials, fail, markerId, type MarkerStore } from "./security";

/** Shared by the owner API, browser approval and MCP start; none may self-approve. */
export class CallConfirmations {
  constructor(private readonly credentials: Credentials, private readonly store: MarkerStore,
    private readonly enabled: () => boolean, private readonly clientId: string) {}
  private deniedId(token: string) { return markerId(`denied:${token}`); }
  async inspect(token: string, owner?: string) {
    if (!this.enabled()) return fail(403, "Outbound integration is disabled");
    const claims = this.credentials.read(token, "confirmation");
    if (claims.client !== this.clientId || (owner && claims.sub !== owner)) return fail(404, "Confirmation not found");
    await activeGrant(this.store, claims);
    if (!claims.call || !claims.scopes.includes("secretary:start")) return fail(400, "Invalid confirmation");
    if (await this.store.get(this.deniedId(token))) return fail(409, "Confirmation was declined");
    const approved = await this.store.get(markerId(token));
    return { claims, approved: approved?.userId === claims.sub };
  }
  async approve(token: string, owner: string) {
    const result = await this.inspect(token, owner);
    await this.store.put({ id: markerId(token), userId: owner, expiresAt: new Date(result.claims.exp) });
    return result.claims;
  }
  async deny(token: string, owner: string) {
    const { claims, approved } = await this.inspect(token, owner);
    if (approved) return fail(409, "Already approved; revoking a connection is not a call cancellation");
    await this.store.put({ id: this.deniedId(token), userId: owner, expiresAt: new Date(claims.exp) });
  }
}
