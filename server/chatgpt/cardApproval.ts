import { activeGrant, Credentials, digest, fail, markerId, type Claims, type MarkerStore } from "./security";
import { CallConfirmations } from "./confirmations";

/**
 * A short-lived, UI-only capability. It is returned only in MCP result _meta,
 * which ChatGPT delivers to the component, not to the model. An OAuth bearer,
 * guessed tool name, chat "yes" or public confirmation token cannot approve.
 * This is not a cryptographic attestation from ChatGPT of a spoken "yes".
 */
export class CardApproval {
  constructor(private credentials: Credentials, private store: MarkerStore,
    private confirmations: CallConfirmations) {}

  async issue(confirmation: string) {
    const { claims } = await this.confirmations.inspect(confirmation);
    const approvalToken = this.credentials.issue({
      type: "card-approval", sub: claims.sub, grant: claims.grant, client: claims.client,
      scopes: claims.scopes, exp: claims.exp, approvalFor: digest(confirmation),
    });
    await this.store.put({ id: markerId(approvalToken), userId: claims.sub, expiresAt: new Date(claims.exp) });
    return { confirmation, approvalToken };
  }

  async decide(owner: Claims, confirmation: string, approvalToken: string, decision: "approve" | "deny") {
    const capability = this.credentials.read(approvalToken, "card-approval");
    if (capability.sub !== owner.sub || capability.grant !== owner.grant ||
      capability.client !== owner.client || capability.approvalFor !== digest(confirmation))
      return fail(403, "Card approval does not belong to this connection and draft");
    await activeGrant(this.store, capability);
    const { claims, approved } = await this.confirmations.inspect(confirmation, owner.sub);
    if (claims.grant !== owner.grant || claims.client !== owner.client)
      return fail(403, "Confirmation does not belong to this connection");
    // Atomic claim prevents an approval and denial from both winning, even
    // across VM processes. A duplicate approval may only resume the SAME job.
    const won = await this.store.consume(markerId(approvalToken));
    if (!won) {
      if (decision === "approve" && approved) return { approved: true as const, call: claims.call! };
      return fail(409, "Card decision already submitted; check the existing task, do not redial");
    }
    if (decision === "deny") {
      await this.confirmations.deny(confirmation, owner.sub);
      return { approved: false as const };
    }
    await this.confirmations.approve(confirmation, owner.sub);
    return { approved: true as const, call: claims.call! };
  }
}
