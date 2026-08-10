import { X } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

export function ExitConfirm() {
  return <div className="relative min-h-[100dvh]">
    <TutorScreen messages={[
      { who: "emma", text: "That sounds fun. What did you do next?", actions: true },
      { who: "user", text: "We had dinner together." },
    ]}/>
    <div className="absolute inset-0 bg-[#29252f]/25"/>
    <section className="absolute bottom-0 left-0 right-0 mx-auto max-w-[430px] rounded-t-[30px] bg-[#fbfafc] px-5 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-3 shadow-[0_-12px_40px_rgba(50,35,60,.16)]">
      <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-[#d8d4da]"/>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-[20px] font-bold tracking-[-.02em]">Завершить практику?</h2><button aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full bg-[#efedf0]"><X size={16}/></button></div>
      <p className="mb-6 text-[14px] leading-[1.45] text-[#77717d]">Если вы ещё недостаточно попрактиковались, память разговора может не сохраниться.</p>
      <button className="w-full rounded-[17px] bg-[#7c3aed] py-3.5 text-[14px] font-bold text-white shadow-[0_8px_18px_rgba(124,58,237,.22)]">Продолжить практику</button>
      <button className="mt-2 w-full rounded-[17px] border border-[#f0d8dc] bg-[#fff8f8] py-3.5 text-[14px] font-bold text-[#c24f5b]">Завершить</button>
    </section>
  </div>;
}
export default ExitConfirm;