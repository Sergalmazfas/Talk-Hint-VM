import { Mic, PhoneOff, Grid3X3, Target } from "lucide-react";
import { Screen, T } from "./_shared/Phone";

export function InCall() {
  return (
    <Screen>
      <div className="flex flex-col items-center pt-12 px-6">
        <p className="text-[24px] font-bold" style={{ color: T.ink }}>+1 (800) 683 7392</p>
        <p className="text-[15px] mt-1" style={{ color: T.sub }}>Mint Mobile</p>
        <p className="text-[15px] font-semibold mt-2 tabular-nums" style={{ color: T.green }}>00:05</p>
      </div>
      <div className="mx-5 mt-8 rounded-2xl border p-4" style={{ borderColor: T.line, background: "#fff" }}>
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4" style={{ color: T.green }} />
          <span className="text-[13px] font-semibold" style={{ color: T.greenDark }}>Ваша цель</span>
        </div>
        <p className="text-[14px] leading-relaxed" style={{ color: T.ink }}>
          Перенести существующий номер на новый телефон, сохранив номер и тариф.
        </p>
      </div>
      <div className="mx-5 mt-4 rounded-2xl p-4 border border-dashed" style={{ borderColor: "#C9BCFF", background: T.purpleBg }}>
        <p className="text-[13px] leading-relaxed" style={{ color: T.purple }}>
          Подсказки появятся здесь во время разговора
        </p>
      </div>
      <div className="mt-auto mb-12 flex items-end justify-center gap-9">
        {[
          { icon: Mic, label: "Mute", bg: T.bg, color: T.ink },
          { icon: PhoneOff, label: "End", bg: "#EF4444", color: "#fff", big: true },
          { icon: Grid3X3, label: "Keypad", bg: T.bg, color: T.ink },
        ].map(({ icon: I, label, bg, color, big }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <div className={`${big ? "w-[72px] h-[72px]" : "w-14 h-14"} rounded-full flex items-center justify-center border`} style={{ background: bg, borderColor: big ? "transparent" : T.line }}>
              <I className={big ? "w-8 h-8" : "w-6 h-6"} style={{ color }} />
            </div>
            <span className="text-[12px]" style={{ color: T.sub }}>{label}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
