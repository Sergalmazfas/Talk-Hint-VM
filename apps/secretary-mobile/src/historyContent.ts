export type SavedHistoryContent = {
  callSummary: string;
  callTranscript: string;
  taskSummary: string;
  taskTranscript: string;
};
const text = (value: unknown) => typeof value === 'string' ? value : '';

/**
 * Call history is authoritative even without a linked task. A richer task
 * report is supplemental, never a prerequisite to reading the saved call.
 * Equal copies are shown once under the call, different copies stay accessible.
 */
export function savedHistoryContent(call: Record<string, unknown> | null, task: Record<string, unknown> | null): SavedHistoryContent {
  const callSummary = text(call?.summary);
  const callTranscript = text(call?.transcript);
  const taskSummary = text(task?.summary);
  const taskTranscript = text(task?.transcript);
  return {
    callSummary, callTranscript,
    taskSummary: taskSummary === callSummary ? '' : taskSummary,
    taskTranscript: taskTranscript === callTranscript ? '' : taskTranscript,
  };
}
