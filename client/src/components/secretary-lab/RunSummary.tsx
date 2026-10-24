import React, { type ReactNode } from "react";

export type SessionPersonality = {
  id?: string;
  name: string;
  version: number;
  mode: "personal" | "work";
};

export function PersonaSummary({ personality }: { personality?: SessionPersonality | null }) {
  const summary = personality === null
    ? "Без личности · legacy"
    : personality
      ? `${personality.name} · v${personality.version} · TEST role: ${personality.mode}`
      : "Не записана · legacy / неизвестно";
  return <span className="run-summary-persona">{summary}</span>;
}

export function RunSummary({
  voiceBundle, profile, personality, children,
}: {
  voiceBundle: string;
  profile: string;
  personality?: SessionPersonality | null;
  children?: ReactNode;
}) {
  return <div className="run-summary" aria-label="Снимок настроек тестовой сессии">
    <span><small>VOICE BUNDLE</small><b>{voiceBundle || "Не сообщён"}</b></span>
    <span><small>VOICE PERFORMANCE PROFILE</small><b>{profile || "Не записан"}</b></span>
    <span><small>PERSONA ИЗ ОТЧЁТА</small><b><PersonaSummary personality={personality} /></b></span>
    {children}
  </div>;
}
