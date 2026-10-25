// External Tutor Engine retired at the owner's request. This is independent of
// TalkHint's Secretary Engine. Existing keys must not reactivate the integration.
export function externalTutorConnectionEnabled(): boolean {
  return false;
}

export const TUTOR_DISCONNECTED_MESSAGE = "Подключение к внешнему Tutor Engine отключено.";
