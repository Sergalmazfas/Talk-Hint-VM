import { Square } from "lucide-react";
import { Screen, CallsBase, Sheet, Waveform, T } from "./_shared/Phone";

export function PrepareListening() {
  return (
    <Screen dim>
      <CallsBase />
      <Sheet title="Prepare call">
        <div className="flex flex-col items-center px-8 pt-4 pb-2 text-center">
          <p className="text-[18px] font-bold mb-6" style={{ color: T.ink }}>Я слушаю…</p>
          <Waveform n={40} />
          <p className="text-[13px] mt-3 mb-6 tabular-nums" style={{ color: T.sub }}>0:08</p>
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: T.purpleBg }}>
            <Square className="w-6 h-6 fill-current" style={{ color: T.purple }} />
          </div>
        </div>
      </Sheet>
    </Screen>
  );
}
