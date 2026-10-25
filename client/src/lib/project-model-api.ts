import type { ModelCommand, ProjectModelState } from "@shared/projectModel";
export async function modelRequest(token: string | null, command?: ModelCommand, revision?: number, hypothesisId = "original"): Promise<ProjectModelState> {
  const params = new URLSearchParams({ hypothesis: hypothesisId });
  const response = await fetch(`/api/admin/project-model?${params.toString()}`, {
    method: command ? "POST" : "GET", credentials: "same-origin",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(command ? { "Content-Type": "application/json" } : {}) },
    ...(command ? { body: JSON.stringify({ revision, command }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}
