/** Only public-page access/ownership checks during preparation, not competitor fact updates. */
export const analystSourceChecks: Record<string, { checkedAt: string; note: string }> = Object.fromEntries([
  ["https://www.vocalingo.app/en", "Официальная страница публично прочитана; реестр, не обновление функций/цен карточки."],
  ["https://help.vocalingo.app/en", "Публичный индекс справки прочитан; отдельные материалы проверяются в пилоте."],
  ["https://feedback.vocalingo.app/en/changelog", "Публичный журнал прочитан; даты и заявления разработчика не являются личным тестом."],
  ["https://lingvanex.com/products/phone-call-translator", "Официальная страница публично прочитана; проверка доступа к источнику."],
  ["https://1aicall.com", "Официальная страница публично прочитана; канал из встроенного ролика требует отдельной проверки принадлежности."],
  ["https://www.aiphone.ai", "Официальная страница публично прочитана; в footer есть ссылка на YouTube @aiphone-team."],
  ["https://guardianly.ai", "Официальная страница публично прочитана; другие официальные каналы не установлены."],
].map(([url, note]) => [url, { checkedAt: "2026-10-25", note }]));
export const analystExtraSourceProposals = [
  { appId: "6465173251", url: "https://www.youtube.com/@aiphone-team", kind: "youtube" as const,
    ownership: "documented" as const, evidence: "Официальный сайт https://www.aiphone.ai/ ссылается на канал в footer. Содержание канала не просмотрено." },
  { appId: "6744344005", url: "https://www.youtube.com/channel/UCaKtmb5i6heDNLMVXHIVhqA", kind: "youtube" as const,
    ownership: "unverified" as const, evidence: "Канал AI Call указан во встроенном ролике официального сайта https://1aicall.com/. Это кандидат, не доказательство официального владения." },
] as const;
