import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePlacesSearch, placesInput } from "./places";
import { phoneContextSchema, usablePhoneContext } from "./context";
import { proposedPlan } from "./plans";
import { secretaryInstruction } from "../../shared/callPlan";
import { confirmedChatSource, signSecretaryConfirmation, verifySecretaryConfirmation } from "../secretary/confirmation";
import { ChatResults, resultLines } from "./results";
import { CHAT_INSTRUCTIONS, CHAT_MODEL } from "./provider";
import { distanceFromRouteMeters } from "./routeDistance";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", ""); vi.stubEnv("GOOGLE_MAPS_API_KEY", ""); });
const context = () => ({ localTime: new Date().toISOString(), timeZone: "America/Chicago",
  location: { latitude: 37.2, longitude: -93.3, accuracyMeters: 900, capturedAt: new Date().toISOString(), label: "Springfield, MO" } });
const plan = { goal: "Ask for total price", ownerFacts: [], sayAsk: ["Ask for total price including tax"],
  expectedQuestions: [], unknowns: ["Stock"], disclosurePolicy: { allowed: [], forbidden: ["Do not pay or prepay"] },
  language: "en", executor: "secretary", targetPhone: "+14055550123" };
describe("Chat actions / phone context — offline only", () => {
  it("accepts foreground phone time/location; rejects invalid zones and coordinates", () => {
    expect(phoneContextSchema.parse(context()).location?.label).toBe("Springfield, MO");
    expect(phoneContextSchema.safeParse({ ...context(), timeZone: "Fake/Zone" }).success).toBe(false);
    expect(phoneContextSchema.safeParse({ ...context(), location: { ...context().location, latitude: 100 } }).success).toBe(false);
  });
  it("does not treat stale GPS or phone clock as current", () => {
    const p = context();
    expect(usablePhoneContext({ ...p, location: { ...p.location, capturedAt: "2000-01-01T00:00:00Z" } })?.location).toBeUndefined();
    expect(usablePhoneContext({ ...p, localTime: "2000-01-01T00:00:00Z" })).toBeUndefined();
  });
  it("unifies only the native chat plan model, with natural action-based questions", () => {
    expect(CHAT_MODEL).toBe("gpt-6-sol");
    expect(CHAT_INSTRUCTIONS).toContain("2–3 missing key questions");
    expect(CHAT_INSTRUCTIONS).toContain("not profession");
    expect(CHAT_INSTRUCTIONS.toLowerCase()).toContain("never invent");
  });
  it("preserves a >9000-character plan for the full-prompt path without losing bans", () => {
    const long = proposedPlan({ ...plan, ownerFacts: Array(18).fill("x".repeat(480)) });
    const instruction = secretaryInstruction(long.plan);
    expect(instruction.length).toBeGreaterThan(9000);
    expect(instruction).toContain("Do not pay or prepay");
    expect(long.plan.ownerFacts).toHaveLength(18);
  });
  it("long native confirmations retain the old iOS-readable instruction and sign chat origin", () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-not-a-credential");
    const source = { conversationId: "10000000-0000-4000-a000-000000000001", messageId: "10000000-0000-4000-a000-000000000002" };
    const text = "a".repeat(9500);
    const token = signSecretaryConfirmation("owner", text, source);
    expect(verifySecretaryConfirmation(token, "owner", text)).toBe(true);
    expect(confirmedChatSource(token, "owner", text)).toEqual(source);
    expect(confirmedChatSource(token, "other", text)).toBeUndefined();
    expect(verifySecretaryConfirmation(token, "owner", text + "changed")).toBe(false);
    expect(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).instruction).toBe(text);
  });
  it("without a Maps key it fails explicitly, without network or fabricated places", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const net = vi.fn();
    const places = new GooglePlacesSearch(net as any);
    expect(places.available()).toBe(false);
    await expect(places.search(placesInput.parse({ query: "parts", city: "Springfield" }), undefined, new AbortController().signal))
      .rejects.toThrow("PLACES_NOT_CONFIGURED");
    expect(net).not.toHaveBeenCalled();
  });
  it("invalid service-account configuration fails closed without echoing secret JSON or making calls", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "not-json");
    const net = vi.fn();
    await expect(new GooglePlacesSearch(net as any).search(placesInput.parse({ query: "parts", city: "Tulsa" }),
      undefined, new AbortController().signal)).rejects.toThrow("MAPS_CREDENTIAL_INVALID");
    expect(net).not.toHaveBeenCalled();
  });
  it("route distance is geometric only; malformed polylines do not fabricate a detour", () => {
    // Official encoded-polyline example: first point is on the route.
    expect(distanceFromRouteMeters("_p~iF~ps|U_ulLnnqC_mqNvxq`@", { latitude: 38.5, longitude: -120.2 })).toBe(0);
    expect(distanceFromRouteMeters("invalid", { latitude: 38.5, longitude: -120.2 })).toBeNull();
  });
  it.each([
    { name: "Fontaine support-leg handle", query: "Fontaine landing gear crank parts", destination: "Joplin MO",
      route: "I-44 E", highwayOnly: true },
    { name: "EarthLite Harmony DX", query: "EarthLite Harmony DX massage table", destination: "Michigan",
      route: "Missouri to Michigan", highwayOnly: false },
  ])("replays $name map/route adapter, never asserts stock, price or highway access", async scenario => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "fixture-not-a-credential");
    const net = vi.fn(async (url: any) => new Response(JSON.stringify(
      url.includes("directions") ? { routes: [{ polyline: { encodedPolyline: "fixture-route" } }] } :
        { places: [{ id: "fixture-place", displayName: { text: "Offline fixture shop" },
          formattedAddress: "Fixture address", internationalPhoneNumber: "+14055550123", rating: 4.5 }] },
    ), { status: 200 }));
    const input = placesInput.parse({ query: scenario.query, destination: scenario.destination,
      route: scenario.route, highwayOnly: scenario.highwayOnly });
    const result: any = await new GooglePlacesSearch(net as any).search(input, context(), new AbortController().signal);
    expect(result.routeBiased).toBe(true);
    expect(result.highwayOnlyRequested).toBe(scenario.highwayOnly);
    expect(result.places[0]).toMatchObject({ price: null, stock: "unverified", detourDistanceMeters: null });
    expect(JSON.parse(net.mock.calls[1][1].body).searchAlongRouteParameters.polyline.encodedPolyline).toBe("fixture-route");
    expect(net).toHaveBeenCalledTimes(2);
  });
  it("no phone location and no city requires clarification, never an IP-based guess", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "fixture");
    const net = vi.fn();
    await expect(new GooglePlacesSearch(net as any).search(placesInput.parse({ query: "parts" }), undefined,
      new AbortController().signal)).rejects.toThrow("PLACES_LOCATION_REQUIRED");
    expect(net).not.toHaveBeenCalled();
  });
  it("provider rejection never echoes arbitrary secret/provider bodies or retries", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "fixture");
    const net = vi.fn(async () => new Response("private provider body", { status: 403 }));
    await expect(new GooglePlacesSearch(net as any).search(placesInput.parse({ query: "parts", city: "Springfield" }),
      undefined, new AbortController().signal)).rejects.toThrow("PLACES_PROVIDER_HTTP_403");
    expect(net).toHaveBeenCalledOnce();
  });
  it("scope-rejected task binding rolls back before any dialer exists", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const release = vi.fn();
    const results = new ChatResults({ connect: async () => ({ query, release }) } as any);
    await expect(results.bind("other", { conversationId: "conversation", messageId: "message" },
      { id: "task", instruction: "instruction", phoneNumber: "+14055550123" })).rejects.toThrow("CHAT_TASK_SOURCE_REJECTED");
    expect(query.mock.calls.map((c: any[]) => c[0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
  it("only bound owner tasks can become follow-up records", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    await expect(new ChatResults({ query } as any).followup("other", "conversation", "task", "Do it"))
      .rejects.toThrow("NOT_FOUND");
    expect(query).toHaveBeenCalledOnce();
  });
  it("three-line result reports unknown honestly and keeps it separate from crew acceptance", () => {
    const text = resultLines({ status: "unknown", outcome: "unknown" }, "ru");
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("не подтверждён");
    expect(text).not.toContain("Тома подтвердила");
    for (const language of ["en", "es", "kk", "uk"])
      expect(resultLines({ status: "unknown", outcome: "unknown" }, language).split("\n")).toHaveLength(3);
  });
});
