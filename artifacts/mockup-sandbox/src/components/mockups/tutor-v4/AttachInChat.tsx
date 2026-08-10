import { Image as ImageIcon } from "lucide-react";
import { TutorScreen } from "./_shared/TutorScreen";

export function AttachInChat() {
  return <div className="relative"><TutorScreen image="emma-wide.png" messages={[
    { who: "emma", text: "Hi, Sergey! 👋 Ready for another conversation practice?", actions: true },
    { who: "user", text: "This is a photo from my trip." },
    { who: "emma", text: "What a lovely place! Tell me about it — when did you go?", actions: true },
  ]} /><div className="pointer-events-none absolute bottom-[190px] right-6 max-w-[210px] rounded-[18px] rounded-br-[5px] bg-[#7c3aed] p-2 text-white shadow-[0_5px_14px_rgba(124,58,237,.18)]"><div className="relative h-24 overflow-hidden rounded-[12px] bg-[#d8d6d9]"><img src="/__mockup/images/emma-wide.png" alt="" className="h-full w-full object-cover opacity-80"/><ImageIcon className="absolute inset-0 m-auto text-white" size={23}/></div><p className="px-1 pt-2 text-[13px]">This is a photo from my trip.</p><p className="px-1 pt-1 text-[9px] text-white/65">Временное вложение — не сохраняется</p></div></div>;
}
export default AttachInChat;