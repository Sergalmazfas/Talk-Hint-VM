import { useCallback, useEffect, useState } from "react";
import type { ProjectModelState } from "@shared/projectModel";
import { useAuth } from "@/lib/auth";
import { modelRequest } from "@/lib/project-model-api";
import CompanyBrowser from "@/components/company-preview/CompanyBrowser";

/** Reversible, read-only Dev view. Authentication and canonical storage stay unchanged. */
export default function CompanyPreview() {
  const { token } = useAuth();
  const [model, setModel] = useState<ProjectModelState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setModel(await modelRequest(token, undefined, undefined, "new-country"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать структуру компании.");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (!import.meta.env.DEV) return <main><h1>Образец доступен только в Dev</h1></main>;
  if (loading) return <main style={{ padding: 28, fontFamily: "system-ui" }} aria-busy="true" role="status">Открываю структуру TalkHint…</main>;
  if (error || !model) return <main style={{ padding: 28, fontFamily: "system-ui" }}>
    <h1>Не удалось открыть компанию</h1>
    <p role="alert">{error || "Нет сохранённых данных."}</p>
    <button onClick={() => void load()} style={{ minHeight: 44, padding: "10px 18px" }}>Повторить чтение</button>
    <p>Данные и доступы не изменены.</p>
  </main>;
  return <CompanyBrowser model={model} />;
}
