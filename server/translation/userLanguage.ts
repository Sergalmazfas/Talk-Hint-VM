export type UserSubtitleLanguage = "ru" | "es";

const languagesByUser = new Map<string, UserSubtitleLanguage>();

export function setUserSubtitleLanguage(userId: string, language: UserSubtitleLanguage): void {
  languagesByUser.set(userId, language);
}

export function getUserSubtitleLanguage(userId?: string): UserSubtitleLanguage {
  return userId ? languagesByUser.get(userId) ?? "ru" : "ru";
}
