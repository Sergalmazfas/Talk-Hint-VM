import { useState, type ReactNode } from "react";
import { Copy, Expand, Keyboard, Languages, Lightbulb, Mic, Paperclip, Settings, Volume2, X } from "lucide-react";
import "../_group.css";

type Message = { who:"emma"|"user"; text:string; translation?:string; actions?:boolean };
type Props = { image?:string; messages?:Message[]; status?:string; mode?:"ready"|"recording"|"thinking"|"speaking"; translate?:boolean; long?:boolean };

const imgBase="/__mockup/images/";
function IconButton({children, label, className=""}:{children:ReactNode;label:string;className?:string}) {
  return <button aria-label={label} className={`grid place-items-center rounded-full transition-transform active:scale-90 ${className}`}>{children}</button>;
}
function ActionRow({active=false}:{active?:boolean}) {
  return <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-[#8a8792]">
    <button className={`flex items-center gap-1.5 ${active?"text-[#7c3aed]":"hover:text-[#7c3aed]"}`}><Volume2 size={14}/>Повторить</button>
    <button className={`flex items-center gap-1.5 ${active?"text-[#7c3aed]":"hover:text-[#7c3aed]"}`}><Languages size={14}/>Перевод</button>
    <button className="flex items-center gap-1 opacity-55"><Copy size={13}/>Копировать</button>
  </div>
}

export function TutorScreen({image="emma-half.png", messages=[{who:"emma",text:"Hi, Sergey! 👋 Ready for another conversation practice?",actions:true}], status="Удерживайте и говорите", mode="ready", translate=false, long=false}:Props){
  const [hint,setHint]=useState(true);
  const recording=mode==="recording";
  const disabled=mode==="thinking"||mode==="speaking";
  return <main className="min-h-[100dvh] w-full overflow-hidden bg-[#fbfafc] text-[#29252f]" style={{fontFamily:"ui-rounded, 'Avenir Next', system-ui, sans-serif"}}>
    <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]">
      <header className="flex h-10 shrink-0 items-center justify-between">
        <IconButton label="Закрыть" className="h-9 w-9 border border-[#e8e5eb] bg-white text-[#554f5c]"><X size={18}/></IconButton>
        <h1 className="text-[17px] font-bold tracking-[-.02em]">Emma</h1>
        <IconButton label="Настройки" className="h-9 w-9 border border-[#e8e5eb] bg-white text-[#554f5c]"><Settings size={17}/></IconButton>
      </header>
      <section className={`relative mt-3 shrink-0 overflow-hidden rounded-[28px] bg-[#dfd8d2] shadow-[0_12px_32px_rgba(72,55,44,.13)] ${long?"h-[190px]":"h-[260px]"}`}>
        <img src={`${imgBase}${image}`} alt="Emma" className="h-full w-full object-cover" style={{objectPosition:image.includes("close")?"center 18%":image.includes("wide")?"center 38%":"center 24%"}}/>
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent"/>
        {mode==="speaking"&&<div className="absolute bottom-4 left-4 flex items-end gap-[3px] rounded-full bg-white/70 px-3 py-2 backdrop-blur-md">
          {[1,2,3,4].map((_,i)=><i key={i} className="tutor-eq block h-3 w-[3px] rounded-full bg-[#7c3aed]" />)}
        </div>}
        <div className="absolute bottom-4 right-4 flex gap-2">
          <IconButton label="Громкость" className="h-9 w-9 border border-white/30 bg-black/20 text-white backdrop-blur-md"><Volume2 size={16}/></IconButton>
          <IconButton label="Развернуть" className="h-9 w-9 border border-white/30 bg-black/20 text-white backdrop-blur-md"><Expand size={16}/></IconButton>
        </div>
      </section>
      <section className={`mt-4 min-h-0 flex-1 overflow-y-auto pr-1 ${long?"[mask-image:linear-gradient(to_bottom,transparent,black_9%,black_100%)]":""}`}>
        <div className="space-y-4 pb-3">
          {messages.map((m,i)=><div key={i} className={`flex ${m.who==="user"?"justify-end":"justify-start"}`}>
            <div className={`max-w-[86%] ${m.who==="user"?"items-end":"items-start"} flex flex-col`}>
              <div className={`rounded-[20px] px-4 py-3 text-[14px] leading-[1.38] ${m.who==="user"?"rounded-br-[6px] bg-[#7c3aed] text-white shadow-[0_5px_14px_rgba(124,58,237,.18)]":"rounded-bl-[6px] bg-[#efedf0] text-[#39343e]"}`}>
                {m.text}
                {m.translation&&<><div className="my-2 h-px bg-[#d9d5db]"/><p className="text-[12px] leading-[1.35] text-[#77717d]">{m.translation}</p></>}
              </div>
              {m.who==="emma"&&m.actions&&<ActionRow active={!!m.translation||translate}/>}
            </div>
          </div>)}
          {mode==="thinking"&&<div className="flex"><div className="flex items-center gap-1 rounded-[18px] rounded-bl-[6px] bg-[#efedf0] px-4 py-3"><i className="tutor-dot h-1.5 w-1.5 rounded-full bg-[#7c3aed]"/><i className="tutor-dot h-1.5 w-1.5 rounded-full bg-[#7c3aed]"/><i className="tutor-dot h-1.5 w-1.5 rounded-full bg-[#7c3aed]"/></div></div>}
          {recording&&<div className="flex justify-end"><div className="rounded-[20px] rounded-br-[6px] bg-[#7c3aed]/55 px-4 py-3 text-[14px] italic text-white/90">{messages[messages.length-1]?.text||"I think I would like to…"}</div></div>}
        </div>
      </section>
      <div className="flex shrink-0 items-center justify-between pt-2">
        <button onClick={()=>setHint(!hint)} className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-bold transition-colors ${hint?"border-[#ddd0f8] bg-[#f5efff] text-[#7131d6]":"border-transparent text-[#9b96a3]"}`}><Lightbulb size={15}/>{hint?"Что сказать?":"Подсказка"}</button>
        <span className="mr-1 text-[9px] font-bold uppercase tracking-[.14em] text-[#aaa5af]">{status}</span>
      </div>
      <footer className="relative flex shrink-0 items-center justify-between pt-3 pb-[calc(env(safe-area-inset-bottom)+4px)]">
        <IconButton label="Клавиатура" className="h-12 w-12 bg-[#f0edf2] text-[#6f6875]"><Keyboard size={20}/></IconButton>
        <div className="relative">
          {recording&&<><span className="tutor-pulse absolute -inset-3 rounded-full border-2 border-[#ef5361]/35"/><span className="tutor-pulse absolute -inset-6 rounded-full border border-[#ef5361]/20" style={{animationDelay:".3s"}}/></>}
          <IconButton label={recording?"Остановить запись":"Говорить"} className={`relative h-[70px] w-[70px] shadow-[0_9px_24px_rgba(124,58,237,.3)] ${recording?"bg-[#e64d5a]":"bg-[#7c3aed]"} ${disabled?"!bg-[#d8d5dc] text-[#aaa6ae] shadow-none":""}`}><Mic size={27} fill="currentColor"/></IconButton>
        </div>
        <IconButton label="Прикрепить" className="h-12 w-12 bg-[#f0edf2] text-[#6f6875]"><Paperclip size={20}/></IconButton>
      </footer>
      <div className="mx-auto mt-1 h-1 w-28 shrink-0 rounded-full bg-[#d8d4da]"/>
    </div>
  </main>
}