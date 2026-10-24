import { useEffect, useState } from "react";
import { labRequest } from "@/lib/secretary-lab";

export type RetellReadiness = {
  mode?: string;
  ready?: boolean;
  reason?: string;
  stage?: string;
  model?: string;
  voice?: string;
  engine?: {
    provider?: string;
    model?: string;
    stage?: string;
    tools?: string[];
    context?: Record<string, unknown>;
    testOnly?: boolean;
  };
};
export type ElevenEngineReadiness = {
  ready: boolean;
  reason?: string;
  model: string;
  ttsModel: string;
  asr: string;
  voices: {
    clone: { ready: boolean; voiceId?: string; reason?: string };
    catalog: { ready: boolean; voiceId?: string; name: string; reason?: string };
  };
  settings?: Record<string, unknown>;
  context?: Record<string, unknown>;
  history?: Array<{ id: string; status: string; createdAt: string; [key: string]: unknown }>;
};

export function useStandReadiness(token: string | null | undefined) {
  const [retell, setRetell] = useState<RetellReadiness | null>(null);
  const [engine, setEngine] = useState<RetellReadiness | null>(null);
  const [retellError, setRetellError] = useState("");
  const [engineError, setEngineError] = useState("");
  const [elevenEngine, setElevenEngine] = useState<ElevenEngineReadiness | null>(null);
  const [elevenEngineError, setElevenEngineError] = useState("");

  useEffect(() => {
    let current = true;
    if (!token) return () => { current = false; };
    void labRequest<RetellReadiness>("/api/admin/secretary-lab/retell", token)
      .then((result) => { if (current) { setRetell(result); setRetellError(""); } })
      .catch((cause: unknown) => { if (current) setRetellError(cause instanceof Error ? cause.message : "Readiness check failed."); });
    void labRequest<RetellReadiness>("/api/admin/secretary-lab/retell-engine", token)
      .then((result) => { if (current) { setEngine(result); setEngineError(""); } })
      .catch((cause: unknown) => { if (current) setEngineError(cause instanceof Error ? cause.message : "Readiness check failed."); });
    void labRequest<ElevenEngineReadiness>("/api/admin/secretary-lab/eleven-engine", token)
      .then((result) => { if (current) { setElevenEngine(result); setElevenEngineError(""); } })
      .catch((cause: unknown) => { if (current) setElevenEngineError(cause instanceof Error ? cause.message : "Readiness check failed."); });
    return () => { current = false; };
  }, [token]);

  return { retell, engine, elevenEngine, retellError, engineError, elevenEngineError };
}

