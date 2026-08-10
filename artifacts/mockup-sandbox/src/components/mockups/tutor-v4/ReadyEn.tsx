import { TutorScreen } from "./_shared/TutorScreen";

export function ReadyEn() {
  return <div className="relative">
    <TutorScreen status="HOLD TO TALK" messages={[{who:"emma",text:"Hi, Sergey! 👋 Ready for another conversation practice?",actions:true}]}/>
    <div className="pointer-events-none absolute inset-0 bg-[#fbfafc]">
      <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]" style={{fontFamily:"ui-rounded, 'Avenir Next', system-ui, sans-serif"}}>
        <header className="flex h-10 shrink-0 items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-full border border-[#e8e5eb] bg-white text-[#554f5c]">×</span><h1 className="text-[17px] font-bold">Emma</h1><span className="grid h-9 w-9 place-items-center rounded-full border border-[#e8e5eb] bg-white text-[#554f5c]">⋯</span></header>
        <section className="relative mt-3 h-[260px] shrink-0 overflow-hidden rounded-[28px] bg-[#dfd8d2]"><img src="/__mockup/images/emma-half.png" alt="Emma" className="h-full w-full object-cover object-[center_24%]"/><div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent"/></section>
        <div className="mt-4 flex-1"/>
        <div className="flex shrink-0 items-center justify-between pt-2"><span className="flex items-center gap-2 rounded-full border border-[#ddd0f8] bg-[#f5efff] px-3.5 py-2 text-[12px] font-bold text-[#7131d6]">⌁ What to say?</span><span className="mr-1 text-[9px] font-bold uppercase tracking-[.14em] text-[#aaa5af]">HOLD TO TALK</span></div>
        <footer className="flex shrink-0 items-center justify-between pt-3 pb-[calc(env(safe-area-inset-bottom)+4px)]"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#f0edf2] text-[#6f6875]">⌨</span><span className="grid h-[70px] w-[70px] place-items-center rounded-full bg-[#7c3aed] text-[27px] text-white shadow-[0_9px_24px_rgba(124,58,237,.3)]">●</span><span className="grid h-12 w-12 place-items-center rounded-full bg-[#f0edf2] text-[#6f6875]">＋</span></footer>
      </div>
    </div>
  </div>;
}
export default ReadyEn;