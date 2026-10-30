/**
 * Explicit owner-authorized asset upload only. No app imports, DB access,
 * model writes, deployment, public ACL changes or first-package changes.
 */
import { Client } from "@replit/object-storage";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";

type Portrait = {
  name: string; displayName: string; source: string; object: string;
  sha256: string; bytes: number; width: number; height: number;
};
let stage = "explicit authorization flag";
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--upload")
    throw Error("Explicit --upload required");
  stage = "manifest";
  const manifest = JSON.parse(await readFile("docs/team-package-two-portraits.json", "utf8"));
  const portraits = manifest.portraits as Portrait[];
  if (portraits.length !== 2 || portraits.map(p => p.name).join(",") !== "klavdiy,efim")
    throw Error("Unexpected portraits");
  const client = new Client();
  const results = [];
  for (const pin of portraits) {
    stage = `${pin.name}: input verification`;
    if (!/^[a-f0-9]{64}$/.test(pin.sha256) ||
        pin.object !== `team/${pin.name}/${pin.sha256}.png`)
      throw Error("Unpinned key");
    const bytes = await readFile(pin.source);
    if (bytes.length !== pin.bytes || sha(bytes) !== pin.sha256 ||
        !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
        bytes.readUInt32BE(16) !== pin.width || bytes.readUInt32BE(20) !== pin.height)
      throw Error("Source mismatch");
    stage = `${pin.name}: existence check`;
    const exists = await client.exists(pin.object);
    if (!exists.ok) throw Error("Storage existence check failed");
    if (!exists.value) {
      stage = `${pin.name}: upload`;
      const uploaded = await client.uploadFromBytes(pin.object, bytes, { compress: false });
      if (!uploaded.ok) throw Error("Storage upload failed");
    }
    stage = `${pin.name}: independent readback`;
    const readback = await client.downloadAsBytes(pin.object, { decompress: false });
    if (!readback.ok) throw Error("Storage readback failed");
    const received = readback.value[0];
    if (received.length !== pin.bytes || sha(received) !== pin.sha256 || !received.equals(bytes))
      throw Error("Stored bytes mismatch; existing object was not overwritten");
    results.push({
      name: pin.name, displayName: pin.displayName, object: pin.object,
      sha256: pin.sha256, bytes: received.length, width: pin.width, height: pin.height,
      action: exists.value ? "verified_existing" : "uploaded_and_verified",
      overwriteRequested: false, shaVerified: true, byteForByteVerified: true,
    });
  }
  stage = "receipt";
  const output = "generated-artifacts/team-package-two-assets";
  await mkdir(output, { recursive: true });
  const receipt = {
    verifiedAt: new Date().toISOString(), storage: manifest.storage,
    modelChanged: false, firstPackageChanged: false, allVerified: true, portraits: results,
  };
  await writeFile(`${output}/PORTRAITS_VERIFIED.json`, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(() => {
  console.error(`Portrait operation failed at ${stage}; no model data was changed.`);
  process.exitCode = 1;
});
