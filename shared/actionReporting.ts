import type { WorkNode } from "./operatingModel";
export const reportingStatusLabels = {
  required: "Требуется разработать", draft: "Черновик · не утверждён",
  discussion: "На согласовании", approved: "Утверждён по указанному основанию",
};
export function emptyReporting(): NonNullable<WorkNode["reporting"]> {
  return { required: true, formName: "", templateDocumentId: null, templateVersion: "", storage: "",
    formStatus: "required", approvalEvidence: "" };
}
export const templateDownloadPath = (id: string) => `/api/product-crew/documents/${encodeURIComponent(id)}/download`;
