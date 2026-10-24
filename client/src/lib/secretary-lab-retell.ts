/** SDK control is deliberately NOT a generic API proxy. Never send a server key to the browser. */
export function savedRetellAdmission(admission: Record<string, unknown>): typeof fetch {
  let used = false;
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (used || method !== "POST" || url.origin !== "https://api.retellai.com" ||
        url.pathname !== "/v3/create-web-call" || url.search || url.hash) {
      throw new Error("Запрос SDK заблокирован: разрешён один ответ уже созданной web-сессии.");
    }
    used = true;
    return new Response(JSON.stringify(admission), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}
export function retellEnded(status?: string) { return status === "ended" || status === "failed"; }
export function retellError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Неизвестная ошибка");
  const lower = raw.toLowerCase();
  if (lower.includes("microphone") || lower.includes("notallowederror") ||
      lower.includes("getusermedia") || lower.includes("permission denied")) {
    return `Разрешите доступ к микрофону в браузере. ${raw}`;
  }
  if (/\b40[13]\b/.test(lower) || lower.includes("api key") || lower.includes("permissions")) {
    return `Проверьте серверный ключ и права Retell. ${raw}`;
  }
  if (lower.includes("402") || lower.includes("balance") || lower.includes("credit") || lower.includes("payment")) {
    return `Проверьте баланс аккаунта Retell. ${raw}`;
  }
  return raw;
}
