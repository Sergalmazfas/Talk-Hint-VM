// Restrict only obviously foreign-script public captions. Do not guess a
// replacement for speech that the recognizer did not understand.
export function hasUnexpectedCopilotCaptionScript(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text);
}

// Long digit strings (such as phone numbers) must not be reformatted by the
// translation model. Only touch a single sequence on each side; ordinary
// dates, amounts, and spoken number words remain the model's responsibility.
const longNumber = /\d(?:[\d \u00a0-]*\d)?/g;
function numberCandidates(text: string) {
  const candidates: { text: string; index: number; digits: string }[] = [];
  longNumber.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = longNumber.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 7) candidates.push({ text: match[0], index: match.index, digits });
  }
  return candidates;
}

/** null means a long number changed and the reply is unsafe to offer as speech. */
export function preserveCopilotLongNumber(source: string, translated: string): string | null {
  const originals = numberCandidates(source);
  if (originals.length === 0) return translated;
  const outputs = numberCandidates(translated);
  if (originals.length !== 1 || outputs.length !== 1 ||
      originals[0].digits !== outputs[0].digits) return null;
  const original = originals[0], output = outputs[0];
  return translated.slice(0, output.index) + original.text +
    translated.slice(output.index + output.text.length);
}