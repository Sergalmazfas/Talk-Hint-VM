import { ReactNode } from "react";
import { Phone as PhoneIcon, GraduationCap, Clock, Settings, Sparkles } from "lucide-react";

// ─── TalkHint design tokens ───
export const T = {
  green: "#16A34A",
  greenDark: "#15803D",
  greenBg: "#EAF7EF",
  purple: "#7C5CFC",
  purpleBg: "#F2EEFF",
  ink: "#111827",
  sub: "#6B7280",
  line: "#E5E7EB",
  bg: "#F9FAFB",
};

export function StatusBar({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-6 pt-3 pb-1 text-[13px] font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
      <span>9:41</span>
      <div className="flex items-center gap-1.5">
        <div className="flex items-end gap-[2px]">{[4, 6, 8, 10].map((h) => <div key={h} style={{ height: h }} className={`w-[3px] rounded-sm ${dark ? "bg-white" : "bg-gray-900"}`} />)}</div>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M8 9.5a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zM2.5 6.2a7.8 7.8 0 0111 0l-1.4 1.4a5.8 5.8 0 00-8.2 0L2.5 6.2zM0 3.6a11.4 11.4 0 0116 0l-1.4 1.4a9.4 9.4 0 00-13.2 0L0 3.6z" fill={dark ? "#fff" : "#111827"} /></svg>
        <div className={`w-6 h-3 rounded-[3px] border ${dark ? "border-white/70" : "border-gray-500"} relative`}><div className={`absolute inset-[1.5px] right-1 rounded-[1px] ${dark ? "bg-white" : "bg-gray-900"}`} /></div>
      </div>
    </div>
  );
}

export function Header() {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3">
      <h1 className="text-[32px] font-bold tracking-tight" style={{ color: T.ink }}>Calls</h1>
      <Settings className="w-6 h-6" style={{ color: T.sub }} />
    </div>
  );
}

export function NumberField({ value, goalReady }: { value?: string; goalReady?: boolean }) {
  return (
    <div className="mx-5 mb-4 flex items-center gap-2 rounded-2xl border px-4 py-3" style={{ borderColor: T.line, background: "#fff" }}>
      <PhoneIcon className="w-4 h-4 shrink-0" style={{ color: T.sub }} />
      {value
        ? <span className="flex-1 text-[17px] font-semibold" style={{ color: T.ink }}>{value}</span>
        : <span className="flex-1 text-[15px]" style={{ color: "#9CA3AF" }}>Enter number</span>}
      {goalReady
        ? <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: T.greenBg, color: T.greenDark }}>Goal ready ✓</span>
        : <Sparkles className="w-4 h-4" style={{ color: T.purple }} />}
    </div>
  );
}

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];

export function Keypad({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid grid-cols-3 ${compact ? "gap-y-2" : "gap-y-3"} px-10 justify-items-center`}>
      {KEYS.map(([d, l]) => (
        <div key={d} className={`${compact ? "w-[60px] h-[60px]" : "w-[68px] h-[68px]"} rounded-full flex flex-col items-center justify-center`} style={{ background: T.bg }}>
          <span className="text-[26px] font-medium leading-none" style={{ color: T.ink }}>{d}</span>
          {l && <span className="text-[9px] tracking-widest mt-0.5" style={{ color: T.sub }}>{l}</span>}
        </div>
      ))}
    </div>
  );
}

export function CallButton() {
  return (
    <div className="flex justify-center mt-3 mb-2">
      <button className="flex items-center gap-2 rounded-full px-9 py-3 text-white text-[16px] font-semibold shadow-sm" style={{ background: T.green }}>
        <PhoneIcon className="w-4 h-4 fill-white" /> Call
      </button>
    </div>
  );
}

const RECENTS = [
  { init: "M", color: T.green, num: "+1 (800) 683-7392", name: "Mint Mobile", when: "Yesterday" },
  { init: "B", color: "#3B82F6", num: "+1 (212) 555-0199", name: "Bank of America", when: "Aug 15" },
];

export function RecentCalls() {
  return (
    <div className="px-5 mt-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: T.sub }}>Recent calls</span>
        <span className="text-[13px] font-medium" style={{ color: T.green }}>See all</span>
      </div>
      {RECENTS.map((r) => (
        <div key={r.num} className="flex items-center gap-3 py-2.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[15px] font-bold" style={{ background: r.color }}>{r.init}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold" style={{ color: T.ink }}>{r.num}</div>
            <div className="text-[12px]" style={{ color: T.sub }}>{r.name}</div>
          </div>
          <span className="text-[12px]" style={{ color: T.sub }}>{r.when}</span>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: T.greenBg }}>
            <PhoneIcon className="w-4 h-4" style={{ color: T.green }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TabBar() {
  const tabs = [
    { icon: PhoneIcon, label: "Calls", active: true },
    { icon: GraduationCap, label: "Tutor", active: false },
    { icon: Clock, label: "History", active: false },
  ];
  return (
    <div className="mt-auto border-t px-8 pt-2 pb-5 flex justify-between" style={{ borderColor: T.line, background: "#fff" }}>
      {tabs.map(({ icon: I, label, active }) => (
        <div key={label} className="flex flex-col items-center gap-0.5">
          <I className="w-6 h-6" style={{ color: active ? T.green : "#9CA3AF" }} />
          <span className="text-[11px] font-medium" style={{ color: active ? T.green : "#9CA3AF" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function Screen({ children, dark = false, dim = false }: { children: ReactNode; dark?: boolean; dim?: boolean }) {
  return (
    <div className="h-screen w-full flex flex-col font-['Inter'] relative overflow-hidden" style={{ background: dark ? "#0B0F14" : "#fff" }}>
      {children}
      {dim && <div className="absolute inset-0 bg-black/40" />}
    </div>
  );
}

export function CallsBase({ goalReady = false, number }: { goalReady?: boolean; number?: string }) {
  return (
    <>
      <Header />
      <NumberField value={number} goalReady={goalReady} />
      <Keypad />
      <CallButton />
      <RecentCalls />
      <TabBar />
    </>
  );
}

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.18)] pb-8">
      <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-gray-300" />
      <div className="flex items-center justify-between px-5 py-2">
        <span className="text-[17px] font-bold" style={{ color: T.ink }}>{title}</span>
        <span className="text-[20px] leading-none" style={{ color: T.sub }}>✕</span>
      </div>
      {children}
    </div>
  );
}

export function Waveform({ color = T.purple, n = 32 }: { color?: string; n?: number }) {
  const bars = Array.from({ length: n }, (_, i) => 6 + Math.round(18 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.33))));
  return (
    <div className="flex items-center justify-center gap-[3px]">
      {bars.map((h, i) => <div key={i} style={{ height: h, background: color }} className="w-[3px] rounded-full" />)}
    </div>
  );
}
