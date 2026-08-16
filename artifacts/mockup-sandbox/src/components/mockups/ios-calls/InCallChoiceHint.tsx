import { Mic, PhoneOff, Grid3X3, Target, Sparkles } from "lucide-react";
import { Screen, StatusBar } from "./_shared/Phone";

export function InCallChoiceHint() {
  return (
    <Screen dark>
      <StatusBar dark />
      <div className="flex flex-col items-center pt-10 px-6">
        <p className="text-[24px] font-bold text-white">+1 (800) 683 7392</p>
        <p className="text-[15px] text-white/60 mt-1">Mint Mobile</p>
        <p className="text-[15px] font-semibold mt-2 tabular-nums" style={{ color: "#4ADE80" }}>03:42</p>
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

      {/* Active live hint */}
      <div className="mx-5 mt-4 rounded-2xl p-4" style={{ background: "rgba(124,92,252,0.14)", border: "1px solid rgba(124,92,252,0.55)", boxShadow: "0 0 24px rgba(124,92,252,0.18)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" style={{ color: "#B7A6FF" }} />
          <span className="text-[13px] font-semibold" style={{ color: "#B7A6FF" }}>Подсказка</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#4ADE80" }} />
            <span className="text-[11px] font-medium text-white/50">live</span>
          </span>
        </div>
        <p className="text-[15px] leading-relaxed text-white/95">
          Оператор спрашивает, хотите ли вы eSIM или физическую SIM-карту. Выберите вариант:
        </p>

        {/* CHOICE option buttons */}
        <div className="mt-3 flex flex-col gap-2">
          <button className="w-full text-left rounded-xl px-4 py-3" style={{ background: "rgba(124,92,252,0.28)", border: "1px solid rgba(183,166,255,0.6)" }}>
            <span className="text-[14px] font-semibold text-white">eSIM — активируется сразу</span>
            <span className="block text-[12px] mt-0.5" style={{ color: "#B7A6FF" }}>«I'd like an eSIM, please»</span>
          </button>
          <button className="w-full text-left rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)" }}>
            <span className="text-[14px] font-semibold text-white">Физическая SIM — доставка 2–3 дня</span>
            <span className="block text-[12px] mt-0.5 text-white/50">«A physical SIM card, please»</span>
          </button>
        </div>
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
