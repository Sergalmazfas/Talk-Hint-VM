import type { TransferManifest } from "./transport";

export interface ReviewedPackage {
  manifest: TransferManifest;
  manifestHash: string;
  objectName: string;
  fileSha256: string;
  ndjsonBytes: number;
  maximumLineBytes: number;
  documentCount: number;
  archiveCount: number;
  compression?: "gzip";
}

/** Filled by the offline Dev exporter after all independent readbacks.
 * This is a locator + digests, never authorization or a downloadable capability.
 */
export const reviewedPackage: ReviewedPackage | null = {
  manifest: {
    schemaVersion: 3,
    schemaDigest: "fc4a3c0f6ebb1324308eee1e8f865816e13d19ff5f88616700fb511ab056a963",
    sourceOwner: "47704265",
    sourceEnvironment: "development",
    sourceWorkspace: "company-transfer-fresh-B-1c41902a-84c6-42e6-b00f-0afa355ff558",
    sourceBWorkspace: "company-dev-7a0f1ede7a1ba73d7195",
    scope: "new-country",
    revision: 912,
    rootHash: "0ff928175de87490aa7718c455ba207682659efe9581244266eaa31ec6cd88e7",
    semanticHash: "f1c11386e2dd5808baf88d7e0bfb679817992a76812bdcf43b0bba703b9069c8",
    recordCount: 129952,
    recordsDigest: "027aa2ab145aabf087b8383d4e45d7c51dd3a66ac819370aa18adaf2ddef67ab",
  },
  manifestHash: "98b397692f447e412f7039247c810ffb5500a73481b7c465ce503b730b7f0eca",
  objectName: "company-transfer/new-country/1b8c4ebcac01c85167fa3c23ff7c66e79cee432dc8860a96c4d5b5c4beb3eda4/transfer.ndjson.gz",
  compression: "gzip",
  fileSha256: "1b8c4ebcac01c85167fa3c23ff7c66e79cee432dc8860a96c4d5b5c4beb3eda4",
  ndjsonBytes: 1350443123,
  maximumLineBytes: 66211282,
  documentCount: 84,
  archiveCount: 242,
};
