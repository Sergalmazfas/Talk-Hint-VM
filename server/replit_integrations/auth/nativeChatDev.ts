// Fixed, Dev-only return target. Never accept an arbitrary redirect URL/scheme.
export function nativeChatDevRequested(client: unknown, environment: string | undefined): boolean {
  if (client === undefined) return false;
  if (client !== "chatdev" || environment !== "development") {
    throw new Error("NATIVE_DEV_LOGIN_UNAVAILABLE");
  }
  return true;
}

export function nativeReturnScheme(devSession: unknown, environment: string | undefined): string {
  return devSession === true && environment === "development" ? "talkhint-chatdev" : "talkhint";
}
