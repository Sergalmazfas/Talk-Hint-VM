import { useState, type ReactNode } from "react";
import { Copy, Keyboard, Languages, Lightbulb, Mic, Paperclip, Settings, Volume2, X } from "lucide-react";
import "./_group.css";

type ChatMessage = {
  who: "emma" | "user";
  text: string;
  translation?: string;
};

const imageBase = "/__mockup/images/";
const initialMessages: ChatMessage[] = [
  { who: "emma", text: "Hi, Sergey! 👋 Ready for another conversation practice?" },
  { who: "user", text: "Yes, let's talk about weekend plans." },
  { who: "emma", text: "Lovely. What are you hoping to do this weekend?" },
];

function RoundButton({ label, children, className = "", onClick }: { label: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <button aria-label={label} onClick={onClick} className={`grid place-items-center rounded-full transition-transform active:scale-90 ${className}`}>
      {children}
    </button>
  );
}

export function CompactReady() {
  const [messages, setMessages] = useState(initialMessages);
  const [hintOpen, setHintOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [translated, setTranslated] = useState<number | null>(null);

  const addReply = () => {
    if (listening) {
      setListening(false);
      setMessages((current) => [...current, { who: "user", text: "I think I would like to visit a quiet seaside town." }]);
      return;
    }
    setListening(true);
  };

  return (
    <main className="min-h-[100dvh] w-full overflow-hidden bg-[#fbfafc] text-[#29252f]" style={{ fontFamily: "ui-rounded, 'Avenir Next', system-ui, sans-serif" }}>
      <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col px-5 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <header className="flex h-10 shrink-0 items-center justify-between">
          <RoundButton label="Закрыть" className="h-9 w-9 border border-[#e8e5eb] bg-white text-[#554f5c]"><X size={18} /></RoundButton>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border-2 border-white shadow-sm">
              <img src={`${imageBase}emma-half.png`} alt="" className="h-full w-full object-cover object-[center_20%]" />
            </span>
            <h1 className="text-[17px] font-bold tracking-[-.02em]">Emma</h1>
            <span className="h-1.5 w-1.5 rounded-full bg-[#6cc79a]" />
          </div>
          <RoundButton label="Настройки" className="h-9 w-9 border border-[#e8e5eb] bg-white text-[#554f5c]"><Settings size={17} /></RoundButton>
        </header>

        <section className="relative mt-3 flex h-[112px] shrink-0 items-center gap-4 overflow-hidden rounded-[26px] bg-[#e4ddd8] px-4 shadow-[0_10px_24px_rgba(72,55,44,.10)]">
          <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-full border-4 border-white/70 shadow-md">
            <img src={`${imageBase}emma-half.png`} alt="Emma" className="h-full w-full object-cover object-[center_20%]" />
          </div>
          <div className="relative z-10">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#786e69]">Conversation practice</p>
            <p className="mt-1 text-[19px] font-bold leading-tight text-[#393039]">Weekend plans</p>
            <p className="mt-1 text-[12px] text-[#736a71]">Take your time — I’m listening.</p>
          </div>
          <div className="absolute -right-5 -top-12 h-36 w-36 rounded-full bg-white/20" />
          <RoundButton label="Громкость" className="absolute bottom-3 right-3 h-8 w-8 border border-white/40 bg-black/15 text-white backdrop-blur-md"><Volume2 size={15} /></RoundButton>
        </section>

        <section className="min-h-0 flex-1 overflow-y-auto pr-1 pt-5">
          <div className="space-y-4 pb-3">
            {messages.map((message, index) => (
              <div key={`${message.who}-${index}`} className={`flex ${message.who === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[88%] flex-col ${message.who === "user" ? "items-end" : "items-start"}`}>
                  <div className={`rounded-[20px] px-4 py-3 text-[14px] leading-[1.38] ${message.who === "user" ? "rounded-br-[6px] bg-[#7c3aed] text-white shadow-[0_5px_14px_rgba(124,58,237,.18)]" : "rounded-bl-[6px] bg-[#efedf0] text-[#39343e]"}`}>
                    {message.text}
                    {translated === index && <><div className="my-2 h-px bg-[#d9d5db]" /><p className="text-[12px] leading-[1.35] text-[#77717d]">Перевод: Я думаю, что хочу посетить тихий приморский город.</p></>}
                  </div>
                  {message.who === "emma" && (
                    <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-[#8a8792]">
                      <button className="flex items-center gap-1.5 hover:text-[#7c3aed]"><Volume2 size={14} />Повторить</button>
                      <button onClick={() => setTranslated(translated === index ? null : index)} className={`flex items-center gap-1.5 ${translated === index ? "text-[#7c3aed]" : "hover:text-[#7c3aed]"}`}><Languages size={14} />Перевод</button>
                      <button className="flex items-center gap-1 opacity-55"><Copy size={13} />Копировать</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {listening && <div className="flex justify-end"><div className="rounded-[20px] rounded-br-[6px] bg-[#7c3aed]/55 px-4 py-3 text-[14px] italic text-white/90">I’m thinking…</div></div>}
          </div>
        </section>

        <div className="flex shrink-0 items-end justify-between pt-2">
          <div>
            {hintOpen && <div className="mb-2 max-w-[225px] rounded-2xl border border-[#eadffc] bg-white px-3 py-2 text-[12px] leading-snug text-[#665b70] shadow-sm">Try: “I’m hoping to…” or “I’d love to…”</div>}
            <button onClick={() => setHintOpen(!hintOpen)} className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-bold transition-colors ${hintOpen ? "border-[#ddd0f8] bg-[#f5efff] text-[#7131d6]" : "border-transparent text-[#9b96a3]"}`}><Lightbulb size={15} />{hintOpen ? "Скрыть подсказку" : "Что сказать?"}</button>
          </div>
          <span className="mr-1 pb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#aaa5af]">{listening ? "Слушаю…" : "Готова слушать"}</span>
        </div>
        <footer className="relative flex shrink-0 items-center justify-between pt-3 pb-[calc(env(safe-area-inset-bottom)+4px)]">
          <RoundButton label="Клавиатура" className="h-12 w-12 bg-[#f0edf2] text-[#6f6875]"><Keyboard size={20} /></RoundButton>
          <RoundButton label={listening ? "Остановить запись" : "Говорить"} onClick={addReply} className={`h-[70px] w-[70px] shadow-[0_9px_24px_rgba(124,58,237,.3)] ${listening ? "bg-[#e64d5a]" : "bg-[#7c3aed]"} text-white`}><Mic size={27} fill="currentColor" /></RoundButton>
          <RoundButton label="Прикрепить" className="h-12 w-12 bg-[#f0edf2] text-[#6f6875]"><Paperclip size={20} /></RoundButton>
        </footer>
        <div className="mx-auto mt-1 h-1 w-28 shrink-0 rounded-full bg-[#d8d4da]" />
      </div>
    </main>
  );
}

export default CompactReady;