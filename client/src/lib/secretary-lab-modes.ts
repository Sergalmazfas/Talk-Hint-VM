export type SecretaryStand = "gpt" | "retell" | "retell-engine";
export function secretaryStand(search: string): SecretaryStand {
  const value = new URLSearchParams(search).get("stand");
  return value === "retell" || value === "retell-engine" ? value : "gpt";
}
export function secretaryStandPath(stand: SecretaryStand) { return `/secretary-lab?stand=${stand}`; }
export function retellStandApi(stand: Exclude<SecretaryStand, "gpt">) {
  return `/api/admin/secretary-lab/${stand}`;
}
export function chooseSecretaryStand(current: SecretaryStand, next: SecretaryStand, busy: boolean) {
  return busy ? current : next;
}
