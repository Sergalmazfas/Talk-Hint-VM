import { Sparkles } from "lucide-react";
import { Screen, CallsBase, Sheet, Waveform, T } from "./_shared/Phone";

export function PrepareConfirm() {
  return (
    <Screen dim>
      <CallsBase />
      <Sheet title="Prepare call">
        <div className="px-6 pt-3 pb-2">
          <div className="flex gap-3 mb-5">
            <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center" style={{ background: T.purpleBg }}>
              <Sparkles className="w-4 h-4" style={{ color: T.purple }} />
            </div>
            <div className="rounded-2xl rounded-tl-md px-4 py-3 text-[14px] leading-relaxed" style={{ background: T.bg, color: T.ink }}>
              <span className="font-semibold">Правильно понимаю:</span><br />
              вам нужно перенести существующий номер на новый телефон, сохранив номер и тариф.<br />
              <span className="font-semibold">Верно?</span>
            </div>
          </div>
          <div className="flex gap-3 mb-5">
            <button className="flex-1 rounded-full border py-2.5 text-[15px] font-semibold" style={{ borderColor: T.line, color: T.ink }}>Нет, уточнить</button>
            <button className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white" style={{ background: T.purple }}>Да, верно</button>
          </div>
          <div className="flex flex-col items-center">
            <Waveform n={28} />
            <p className="text-[12px] mt-2" style={{ color: T.sub }}>Или скажите ответ голосом</p>
          </div>
        </div>
      </Sheet>
    </Screen>
  );
}
