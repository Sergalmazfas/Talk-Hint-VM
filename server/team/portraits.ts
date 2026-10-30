import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
const files = [
  ["maria", "d2e57045bcda985dd244d633cff2211648eb7cca8e48f337293e2c35f85269c2", 2131213],
  ["tikhon", "191f5852af8b75e131d12046da307eabf7537b9081ece37f95bc9ca8ce387b8e", 2367419],
  ["zamir", "cc39047d3679388f9e33ce82d8d542fe532def2021f6f11fef1d51a8368ad706", 3341242],
  ["foma", "73932d75f08a5f62281779f0bd20610567c990d1b71d7b56ba8de021750ef74d", 3171451],
  ["katya", "de6ed02ad39cd93d390744dd0f2322a34a7509d08ba81b5b26939b0c3a71b5df", 3501150],
] as const;
export const portraitManifest = Object.fromEntries(files.map(([name, sha256, bytes]) => [name, {
  object: `team/${name}/${sha256}.png`, sha256, bytes,
  url: `/api/admin/team/portraits/${name}/${sha256}`,
}]));
// Separate from the immutable first-package manifest/recipe.
export const teamPortraitManifest = { ...portraitManifest, ...Object.fromEntries([
  ["klavdiy", "63b929857883e0e1c15019c63d6ad3c4839ad699cc8b127114570302d7d9b52e", 3065723],
  ["efim", "505502d0cb76bea5c4ac232438902cc1986cf8806a0b4fb4155030d8c0e90a15", 2279197],
].map(([name, sha256, bytes]) => [String(name), {
  object: `team/${name}/${sha256}.png`, sha256: String(sha256), bytes: Number(bytes),
  url: `/api/admin/team/portraits/${name}/${sha256}`,
}])) };
export async function verifiedPortrait(name: string, digest: string, client = new Client()) {
  const pin = teamPortraitManifest[name];
  if (!pin || pin.sha256 !== digest) throw Error("Unknown portrait");
  const result = await client.downloadAsBytes(pin.object);
  if (!result.ok) throw Error("Portrait unavailable");
  const bytes = result.value[0];
  if (bytes.length !== pin.bytes || createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw Error("Portrait digest mismatch");
  return bytes;
}
