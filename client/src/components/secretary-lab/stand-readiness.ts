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

export function useStandReadiness(token: string | null | undefined) {
  const [retell, setRetell] = useState<RetellReadiness | null>(null);
  const [engine, setEngine] = useState<RetellReadiness | null>(null);
  const [retellError, setRetellError] = useState("");
  const [engineError, setEngineError] = useState("");

  useEffect(() => {
    let current = true;
    if (!token) return () => { current = false; };
    void labRequest<RetellReadiness>("/api/admin/secretary-lab/retell", token)
      .then((result) => { if (current) { setRetell(result); setRetellError(""); } })
      .catch((cause: unknown) => { if (current) setRetellError(cause instanceof Error ? cause.message : "Readiness check failed."); });
    void labRequest<RetellReadiness>("/api/admin/secretary-lab/retell-engine", token)
      .then((result) => { if (current) { setEngine(result); setEngineError(""); } })
      .catch((cause: unknown) => { if (current) setEngineError(cause instanceof Error ? cause.message : "Readiness check failed."); });
    return () => { current = false; };
  }, [token]);

  return { retell, engine, retellError, engineError };
}

