import { Check } from "lucide-react";
import { Screen, Header, TabBar, T } from "./_shared/Phone";

export function GoalReady() {
  return (
    <Screen>
      <Header />
      <div className="px-5">
        <div className="rounded-3xl border p-6 flex flex-col items-center text-center" style={{ borderColor: T.line, background: "#fff" }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: T.greenBg }}>
            <Check className="w-7 h-7" style={{ color: T.green }} />
          </div>
          <p className="text-[19px] font-bold mb-3" style={{ color: T.ink }}>Цель готова</p>
          <div className="w-full rounded-2xl px-4 py-3 text-[14px] leading-relaxed text-left mb-5" style={{ background: T.greenBg, color: T.greenDark }}>
            Перенести существующий номер на новый телефон, сохранив номер и тариф.
          </div>
          <div className="flex gap-3 w-full">
            <button className="flex-1 rounded-full border py-2.5 text-[15px] font-semibold" style={{ borderColor: T.line, color: T.ink }}>Изменить</button>
            <button className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white" style={{ background: T.green }}>Всё верно</button>
          </div>
          <p className="text-[12px] mt-3" style={{ color: T.sub }}>Можно сказать или нажать</p>
        </div>
      </div>
      <TabBar />
    </Screen>
  );
}
