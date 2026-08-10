import { LoaderCircle } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

export function MemoryPending() {
  return <div className="relative min-h-[100dvh]">
    <TutorScreen status="SESSION_ENDING · CALL_MEMORY_PENDING" messages={[{who:"emma",text:"It was lovely talking with you today.",actions:false}]}/>
    <div className="absolute inset-x-0 bottom-0 top-[300px] bg-[#fbfafc]/95 px-5 pt-14">
      <div className="mx-auto max-w-[350px] rounded-[26px] border border-[#ece8ef] bg-white px-5 py-8 text-center shadow-[0_12px_30px_rgba(68,46,78,.08)]">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#f5efff] text-[#7c3aed]"><LoaderCircle size={24} className="animate-spin"/></div>
        <h2 className="text-[18px] font-bold">Готовлю память разговора…</h2>
        <p className="mt-2 text-[13px] text-[#8a8490]">Это займёт несколько секунд</p>
      </div>
    </div>
  </div>;
}
export default MemoryPending;