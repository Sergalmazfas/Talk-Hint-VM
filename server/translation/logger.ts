// Minimal local logger for the translation spike modules.
//
// Deliberately NOT importing log from server/index.ts: that module has heavy
// startup side effects (DB, alerters, workers) and pulling it into these
// files makes any test that touches routes transitively load the whole app —
// which breaks test files that mock index's dependencies.
export function tlog(message: string, tag = "translator"): void {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${t} [${tag}] ${message}`);
}
