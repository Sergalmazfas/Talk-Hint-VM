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
