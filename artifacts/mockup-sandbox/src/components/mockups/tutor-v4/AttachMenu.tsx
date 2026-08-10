import { Camera, FileText, Image, X } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

export function AttachMenu() {
  return <div className="relative min-h-[100dvh]">
    <TutorScreen messages={[
      { who: "emma", text: "Hi, Sergey! 👋 Ready for another conversation practice?", actions: true },
      { who: "user", text: "Yes, let's practice talking about travel." },
    ]} />
    <div className="absolute inset-0 bg-[#29252f]/20" />
    <section className="absolute bottom-0 left-0 right-0 mx-auto max-w-[430px] rounded-t-[28px] bg-[#fbfafc] px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 shadow-[0_-12px_40px_rgba(50,35,60,.14)]">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#d8d4da]" />
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[17px] font-bold">Прикрепить</h2>
        <button aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full bg-[#f0edf2] text-[#716a77]"><X size={16}/></button>
      </div>
      <div className="overflow-hidden rounded-[20px] bg-white">
        {[
          [Camera, "Сделать фото"],
          [Image, "Медиатека"],
          [FileText, "Прикрепить файл"],
        ].map(([Icon, label], i) => <button key={label as string} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-[14px] font-semibold text-[#37313d] ${i ? "border-t border-[#f0edf2]" : ""}`}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f5efff] text-[#7131d6]"><Icon size={18}/></span>
          {label as string}
        </button>)}
      </div>
      <button className="mt-3 w-full rounded-[18px] bg-[#efedf0] py-3.5 text-[14px] font-bold text-[#625b68]">Отмена</button>
    </section>
  </div>;
}
export default AttachMenu;