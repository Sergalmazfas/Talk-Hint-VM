import { Screen, CallsBase } from "./_shared/Phone";

export function NumberEntered() {
  return (
    <Screen>
      <CallsBase goalReady number="+1 (800) 683 7392" />
    </Screen>
  );
}
