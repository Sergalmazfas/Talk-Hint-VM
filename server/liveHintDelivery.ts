/** A native-language completion must never resurrect a replaced English card. */
export function canUpdateEnglishFirst(a: {
  closed: boolean; utterance: number; latestUtterance: number;
  deliveredEpoch: symbol | undefined; currentEpoch: symbol | undefined;
  mode: string; revision: number; startedRevision: number;
  liveHints: boolean; translation: boolean; originalEnglish: string; updatedEnglish: string;
}): boolean {
  return !a.closed && a.utterance === a.latestUtterance && !!a.deliveredEpoch &&
    a.deliveredEpoch === a.currentEpoch && a.mode === "english-first" &&
    a.revision === a.startedRevision && a.liveHints && a.translation &&
    a.originalEnglish === a.updatedEnglish;
}
