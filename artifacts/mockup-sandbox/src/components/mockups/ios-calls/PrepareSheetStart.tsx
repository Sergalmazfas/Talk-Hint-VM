import { Mic } from "lucide-react";
import { Screen, CallsBase, Sheet, Waveform, T } from "./_shared/Phone";

export function PrepareSheetStart() {
  return (
    <Screen dim>
      <CallsBase />
      <Sheet title="Prepare call">
        <div className="flex flex-col items-center px-8 pt-4 pb-2 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5" style={{ background: T.purpleBg }}>
            <Mic className="w-9 h-9" style={{ color: T.purple }} />
          </div>
          <p className="text-[18px] font-bold leading-snug mb-1" style={{ color: T.ink }}>
            Скажите, чего хотите<br />добиться звонком
          </p>
          <p className="text-[13px] mb-6" style={{ color: T.sub }}>Говорите свободно</p>
          <Waveform />
        </div>
      </Sheet>
    </Screen>
  );
}
