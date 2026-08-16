import { Mic, PhoneOff, Grid3X3, Target, Sparkles } from "lucide-react";
import { Screen, T } from "./_shared/Phone";

export function InCallChoiceHint() {
  return (
    <Screen>
      <div className="flex flex-col items-center pt-10 px-6">
        <p className="text-[22px] font-bold" style={{ color: T.ink }}>+1 (800) 683 7392</p>
        <p className="text-[14px] mt-0.5" style={{ color: T.sub }}>Mint Mobile</p>
        <p className="text-[14px] font-semibold mt-1.5 tabular-nums" style={{ color: T.green }}>03:42</p>
      </div>

      <div className="mx-5 mt-5 rounded-2xl border p-4" style={{ borderColor: T.line, background: "#fff" }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Target className="w-4 h-4" style={{ color: T.green }} />
          <span className="text-[13px] font-semibold" style={{ color: T.greenDark }}>Ваша цель</span>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: T.ink }}>
          Перенести существующий номер на новый телефон, сохранив номер и тариф.
        </p>
      </div>

      {/* Active live hint */}
      <div className="mx-5 mt-4 rounded-2xl p-4" style={{ background: T.purpleBg, border: "1px solid #C9BCFF", boxShadow: "0 4px 20px rgba(124,92,252,0.12)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" style={{ color: T.purple }} />
          <span className="text-[13px] font-semibold" style={{ color: T.purple }}>Подсказка</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: T.green }} />
            <span className="text-[11px] font-medium" style={{ color: T.sub }}>live</span>
          </span>
        </div>
        <p className="text-[14px] leading-relaxed" style={{ color: T.ink }}>
          Оператор спрашивает, хотите ли вы eSIM или физическую SIM-карту. Выберите вариант:
        </p>

        {/* CHOICE option buttons */}
        <div className="mt-3 flex flex-col gap-2">
          <button className="w-full text-left rounded-xl px-4 py-3" style={{ background: T.purple }}>
            <span className="text-[14px] font-semibold text-white">eSIM — активируется сразу</span>
            <span className="block text-[12px] mt-0.5 text-white/80">«I'd like an eSIM, please»</span>
          </button>
          <button className="w-full text-left rounded-xl px-4 py-3 border" style={{ background: "#fff", borderColor: T.line }}>
            <span className="text-[14px] font-semibold" style={{ color: T.ink }}>Физическая SIM — доставка 2–3 дня</span>
            <span className="block text-[12px] mt-0.5" style={{ color: T.sub }}>«A physical SIM card, please»</span>
          </button>
        </div>
      </div>

      <div className="mt-auto mb-10 flex items-end justify-center gap-9">
        {[
          { icon: Mic, label: "Mute", bg: T.bg, color: T.ink },
          { icon: PhoneOff, label: "End", bg: "#EF4444", color: "#fff", big: true },
          { icon: Grid3X3, label: "Keypad", bg: T.bg, color: T.ink },
        ].map(({ icon: I, label, bg, color, big }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <div className={`${big ? "w-[68px] h-[68px]" : "w-14 h-14"} rounded-full flex items-center justify-center border`} style={{ background: bg, borderColor: big ? "transparent" : T.line }}>
              <I className={big ? "w-7 h-7" : "w-6 h-6"} style={{ color }} />
            </div>
            <span className="text-[12px]" style={{ color: T.sub }}>{label}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
