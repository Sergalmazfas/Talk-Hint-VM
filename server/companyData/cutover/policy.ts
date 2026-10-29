import { reviewedAccountBinding } from "../v3/importApproval";
import { reviewedPackage } from "../v3/reviewedPackage";

export type CutoverAction = "activate" | "probe" | "open_writes" | "rollback" | "reactivate";
export const cutoverActions: CutoverAction[] = ["activate", "probe", "open_writes", "rollback", "reactivate"];
export interface CutoverPolicy {
  owner: string; environment: "development" | "production"; workspace: string;
  revision: number; rootHash: string; semanticHash: string; manifestHash: string;
  probeDocumentId: string;
}
/** Candidate pin is NOT permission. Based on the independently checked post-import report. */
export const cutoverCandidate: CutoverPolicy = {
  owner: reviewedAccountBinding.targetOwner, environment: "production",
  workspace: "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a",
  revision: reviewedPackage!.manifest.revision, rootHash: reviewedPackage!.manifest.rootHash,
  semanticHash: reviewedPackage!.manifest.semanticHash, manifestHash: reviewedPackage!.manifestHash,
  // A non-journal document; temporary text is restored in a new revision.
  probeDocumentId: "DOC-43ae2ce8-382c-4588-a481-58cd213ba404",
};
/** Only after Claude review and a separate owner decision. Publish alone enables nothing. */
export const reviewedCutoverApproval: CutoverPolicy | null = null;
