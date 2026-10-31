/** Progressive enhancement only: the server remains the one-use authority. */
export const consentSubmitScript = `
(() => {
  const form = document.getElementById("product-consent");
  const button = document.getElementById("product-consent-submit");
  const status = document.getElementById("product-consent-status");
  let submitted = false;
  form.addEventListener("submit", event => {
    if (submitted) {
      event.preventDefault();
      return;
    }
    submitted = true;
    button.disabled = true;
    button.textContent = "Подключаем…";
    status.textContent = "Подтверждение отправлено. Не отправляйте его повторно. Если переход не завершится, начните новое подключение в Replit.";
  });
})();
`;

/** Includes only the callback origins/endpoint already allowed by OAuth. */
export function consentPolicy(nonce: string) {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self' https://replit.com/connectors/oauth/callback https://chatgpt.com https://chat.openai.com; frame-ancestors 'none'; base-uri 'none'`;
}
