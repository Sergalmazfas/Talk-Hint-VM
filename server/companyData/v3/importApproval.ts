/** Release record, NOT a user-supplied request or an environment auto-switch.
 * Populate only after Claude review + explicit owner approval of the fresh
 * source manifest and account pair. This release intentionally enables nothing.
 */
export interface ImportApproval {
  confirmed: boolean;
  importApproved: boolean;
  targetOwner: string;
  targetEnvironment: "development" | "production";
  sourceOwner: string;
  sourceEnvironment: "development";
  sourceWorkspace: string;
  revision: number;
  manifestHash: string;
}
export const reviewedImportApproval: ImportApproval | null = null;

/** Account pair confirmed by owner after Claude review. NOT import/cutover consent.
 * Only new-country is approved; original is retained as a technical archive.
 */
export const reviewedAccountBinding = Object.freeze({
  confirmed: true,
  scope: "new-country" as const,
  targetOwner: "47704265",
  targetEnvironment: "production" as const,
  sourceOwner: "47704265",
  sourceEnvironment: "development" as const,
  sourceBWorkspace: "company-dev-7a0f1ede7a1ba73d7195",
});

/** Prevent an ordinary GET/write from silently bootstrapping the import target.
 * Independent of importApproved. After explicit cutover the active repository
 * handles requests before legacy ensure(), so this never selects a source.
 */
export function blocksLegacySeed(owner: string, environment: string) {
  return reviewedAccountBinding.confirmed &&
    owner === reviewedAccountBinding.targetOwner &&
    environment === reviewedAccountBinding.targetEnvironment;
}
