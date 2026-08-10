import { ArrowLeft, Check } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

export function MemoryConfirmed() {
  return <div className="relative min-h-[100dvh]">
    <TutorScreen status="REAL_CALL_READY" messages={[{who:"emma",text:"I’ll remember this for your next real call.",actions:false}]}/>
    <div className="absolute inset-0 bg-[#fbfafc]/96 px-5 pt-[calc(env(safe-area-inset-top)+80px)]">
      <div className="mx-auto max-w-[350px] text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#e8f7ef] text-[#24945c]"><Check size={31}/></div>
        <h2 className="mt-5 text-[23px] font-bold tracking-[-.03em]">Память подтверждена</h2>
        <p className="mt-2 text-[14px] text-[#77717d]">Готово к реальному звонку</p>
        <div className="mt-8 rounded-[20px] border border-[#e8e3ec] bg-white px-4 py-4 text-left"><p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#aaa5af]">Сохранено фактов</p><p className="mt-1 text-[24px] font-bold text-[#6d32cf]">3</p><p className="text-[12px] text-[#88818d]">Emma учтёт их в следующем разговоре</p></div>
        <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-[17px] bg-[#7c3aed] py-3.5 text-[14px] font-bold text-white"><ArrowLeft size={16}/>Вернуться</button>
      </div>
    </div>
  </div>;
}
export default MemoryConfirmed;