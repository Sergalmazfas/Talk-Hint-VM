import { Mic, PhoneOff, Grid3X3, Target } from "lucide-react";
import { Screen, StatusBar, T } from "./_shared/Phone";

export function InCall() {
  return (
    <Screen dark>
      <StatusBar dark />
      <div className="flex flex-col items-center pt-10 px-6">
        <p className="text-[24px] font-bold text-white">+1 (800) 683 7392</p>
        <p className="text-[15px] text-white/60 mt-1">Mint Mobile</p>
        <p className="text-[15px] font-semibold mt-2 tabular-nums" style={{ color: "#4ADE80" }}>00:05</p>
      </div>
      <div className="mx-5 mt-8 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4" style={{ color: "#4ADE80" }} />
          <span className="text-[13px] font-semibold" style={{ color: "#4ADE80" }}>Ваша цель</span>
        </div>
        <p className="text-[14px] leading-relaxed text-white/85">
          Перенести существующий номер на новый телефон, сохранив номер и тариф.
        </p>
      </div>
      <div className="mx-5 mt-4 rounded-2xl p-4 border border-dashed" style={{ borderColor: "rgba(124,92,252,0.5)", background: "rgba(124,92,252,0.08)" }}>
        <p className="text-[13px] leading-relaxed" style={{ color: "#B7A6FF" }}>
          Подсказки появятся здесь во время разговора
        </p>
      </div>
      <div className="mt-auto mb-12 flex items-end justify-center gap-9">
        {[
          { icon: Mic, label: "Mute", bg: "rgba(255,255,255,0.1)", color: "#fff" },
          { icon: PhoneOff, label: "End", bg: "#EF4444", color: "#fff", big: true },
          { icon: Grid3X3, label: "Keypad", bg: "rgba(255,255,255,0.1)", color: "#fff" },
        ].map(({ icon: I, label, bg, color, big }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <div className={`${big ? "w-[72px] h-[72px]" : "w-14 h-14"} rounded-full flex items-center justify-center`} style={{ background: bg }}>
              <I className={big ? "w-8 h-8" : "w-6 h-6"} style={{ color }} />
            </div>
            <span className="text-[12px] text-white/60">{label}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
