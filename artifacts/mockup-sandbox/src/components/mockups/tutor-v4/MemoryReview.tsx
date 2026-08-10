import { Check, Pencil, Trash2 } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

const facts = ["Планирует поездку в Майами", "Уровень разговорного английского — средний", "Любит обсуждать путешествия"];
export function MemoryReview() {
  return <div className="relative min-h-[100dvh]">
    <TutorScreen status="CALL MEMORY · REVIEW" messages={[{who:"emma",text:"Here’s what I remember from our conversation.",actions:true}]}/>
    <div className="absolute inset-0 bg-[#29252f]/15"/>
    <section className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px] rounded-t-[30px] bg-[#fbfafc] px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-5 shadow-[0_-12px_40px_rgba(50,35,60,.16)]">
      <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#d8d4da]"/>
      <h2 className="text-[20px] font-bold">Проверьте память разговора</h2>
      <p className="mt-2 text-[12px] leading-[1.45] text-[#85808a]">Факты предложены Emma. Подтвердите их перед использованием в реальных звонках.</p>
      <div className="mt-5 space-y-2">{facts.map((fact)=><div key={fact} className="flex items-center gap-2 rounded-[16px] border border-[#ebe7ee] bg-white px-3 py-3"><Check size={15} className="shrink-0 text-[#6a39c9]"/><span className="min-w-0 flex-1 text-[13px] font-semibold">{fact}</span><button aria-label="Изменить факт" className="text-[#837b8c]"><Pencil size={15}/></button><button aria-label="Удалить факт" className="text-[#c26a73]"><Trash2 size={15}/></button></div>)}</div>
      <button className="mt-5 w-full rounded-[17px] bg-[#7c3aed] py-3.5 text-[14px] font-bold text-white">Подтвердить</button>
      <button className="mt-2 w-full rounded-[17px] bg-[#efedf0] py-3.5 text-[14px] font-bold text-[#625b68]">Изменить</button>
    </section>
  </div>;
}
export default MemoryReview;