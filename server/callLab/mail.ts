import { ReplitConnectors } from "@replit/connectors-sdk";

export interface MailBinding { recipient: string; connection_id: string }
export class GmailLabMail {
  constructor(private sdk = new ReplitConnectors()) {}

  async profile(connectionId?: string): Promise<string> {
    const response = await this.sdk.proxy("google-mail", "/gmail/v1/users/me/profile",
      { method: "GET", connectionId });
    if (!response.ok) throw new Error(`LAB_GMAIL_PROFILE_${response.status}`);
    const value = await response.json();
    if (typeof value.emailAddress !== "string" || !/^[^\s<>@]+@[^\s<>@]+$/.test(value.emailAddress)) {
      throw new Error("LAB_GMAIL_PROFILE_INVALID");
    }
    return value.emailAddress.toLowerCase();
  }

  async bindingFor(email: string): Promise<MailBinding> {
    const connections = await this.sdk.listConnections({ connector_names: "google-mail" });
    for (const connection of connections) {
      if (await this.profile(connection.id) === email.toLowerCase()) {
        return { recipient: email.toLowerCase(), connection_id: connection.id };
      }
    }
    throw new Error("LAB_GMAIL_OWNER_MISMATCH");
  }

  async verify(binding: MailBinding) {
    if (await this.profile(binding.connection_id) !== binding.recipient.toLowerCase()) {
      throw new Error("LAB_GMAIL_ACCOUNT_CHANGED");
    }
  }

  async sent(binding: MailBinding, messageId: string, providerId?: string | null): Promise<string | null> {
    if (!/^[a-f0-9]+@talkhint-lab\.invalid$/.test(messageId)) throw new Error("LAB_BAD_MESSAGE_ID");
    await this.verify(binding);
    // The tested Gmail transport rewrote our RFC Message-ID. An acknowledged
    // Gmail ID is stronger evidence than a search index or a custom header.
    if (providerId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(providerId)) throw new Error("LAB_BAD_PROVIDER_ID");
      const response = await this.sdk.proxy("google-mail",
        `/gmail/v1/users/me/messages/${encodeURIComponent(providerId)}?format=metadata&fields=id,labelIds,payload%2Fheaders`,
        { method: "GET", connectionId: binding.connection_id });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`LAB_GMAIL_LOOKUP_${response.status}`);
      const value = await response.json();
      const to = value.payload?.headers?.find((h: any) => String(h.name).toLowerCase() === "to")?.value;
      return value.id === providerId && value.labelIds?.includes("SENT") &&
        typeof to === "string" && to.trim().toLowerCase() === binding.recipient.toLowerCase() ? providerId : null;
    }
    const q = encodeURIComponent(`in:sent rfc822msgid:${messageId}`);
    const response = await this.sdk.proxy("google-mail", `/gmail/v1/users/me/messages?q=${q}&maxResults=2`,
      { method: "GET", connectionId: binding.connection_id });
    if (!response.ok) throw new Error(`LAB_GMAIL_LOOKUP_${response.status}`);
    const data = await response.json();
    return data.messages?.[0]?.id ?? null;
  }

  async send(binding: MailBinding, messageId: string, report: any, canSend?: () => Promise<boolean>): Promise<string> {
    await this.verify(binding);
    if (canSend && !await canSend()) throw new Error("LAB_MAIL_PAUSED");
    const response = await this.sdk.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
      connectionId: binding.connection_id, method: "POST",
      body: { raw: encodeLetter(binding.recipient, messageId, report) },
    });
    if (!response.ok) throw new Error(`LAB_GMAIL_SEND_${response.status}`);
    const data = await response.json();
    if (typeof data.id !== "string") throw new Error("LAB_GMAIL_SEND_RESPONSE_UNKNOWN");
    return data.id;
  }
}

export function encodeLetter(recipient: string, messageId: string, report: any) {
  if (!/^[^\s\r\n<>@]+@[^\s\r\n<>@]+$/.test(recipient) || !/^[a-f0-9]+@talkhint-lab\.invalid$/.test(messageId)) {
    throw new Error("LAB_BAD_MAIL_HEADER");
  }
  const safe = (v: unknown) => String(v || "неизвестно").replace(/[\r\n]/g, " ").slice(0, 220);
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? String(v) : "неизвестно";
  const metrics = report.metrics ?? {};
  const subject = `${report.synthetic ? "ТЕСТ · " : ""}Hint · ${safe(report.ended_at)} · ` +
    `${safe((report.languages ?? []).join("/"))} · ${number(report.duration_ms)} мс · ` +
    `ошибок (AI) ${number(metrics.ai_classified_errors)} · пропущено ${number(metrics.confirmed_missed_hints)} · ${safe(report.qa_status)}`;
  const letter = report.letter ?? {};
  const body = [
    report.synthetic ? "СИНТЕТИЧЕСКАЯ ПРОВЕРКА. Реального звонка не было." : "Лаборатория Hint · отчёт по завершённому звонку",
    "Это AI-оценка, не приёмка владельцем и не отзыв участника.",
    "", "ИТОГ", letter.summary_ru, "", "КАЧЕСТВО", letter.quality_ru,
    "", "QA", report.qa_status, ...(report.qa_issues ?? []),
    "", "СОБЫТИЯ", ...(report.analysis?.findings ?? []).map((f: any) =>
      `${f.event_id}: ${f.category}\nОснование: ${f.evidence}\n${f.explanation}`),
    "", "ОГРАНИЧЕНИЯ", ...(report.analysis?.limitations ?? []), ...(letter.limitations_ru ?? []),
    `WER: ${number(metrics.wer)}`, `Цена минуты: ${number(metrics.minute_price)}`,
    `Задержки (из сохранённой телеметрии): ${metrics.latency ? JSON.stringify(metrics.latency) : "нет данных"}`,
    `Replay: ${report.replay?.status ?? "не выполнен"}`,
    "", "ПРЕДЛОЖЕНИЯ", ...(letter.proposals_ru ?? []),
    "", "HEAD.07 — последующий выборочный контроль. Outbox не принимает решения QA.",
  ].map(v => String(v ?? "")).join("\n");
  const encodedBody = Buffer.from(body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  // RFC2047 words are folded to remain below header line limits.
  const words = Array.from(subject).reduce((a, c) => {
    if (Buffer.byteLength(a[a.length - 1] + c) > 36) a.push(c); else a[a.length - 1] += c;
    return a;
  }, [""]).map(s => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`).join("\r\n ");
  return Buffer.from([
    `From: ${recipient}`, `To: ${recipient}`, `Message-ID: <${messageId}>`,
    `Subject: ${words}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", encodedBody, "",
  ].join("\r\n")).toString("base64url");
}
