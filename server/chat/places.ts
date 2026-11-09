import { z } from "zod";
import { ChatError } from "./contracts";
import type { PhoneContext } from "./context";
import { mapsConfigured, mapsHeaders } from "./mapsAuth";
import { distanceFromRouteMeters } from "./routeDistance";

export const placesInput = z.object({
  query: z.string().trim().min(2).max(240),
  city: z.string().trim().min(2).max(180).optional(),
  destination: z.string().trim().min(2).max(240).optional(),
  route: z.string().trim().max(180).optional(),
  highwayOnly: z.boolean().default(false),
}).strict();
export type PlacesInput = z.infer<typeof placesInput>;
export interface PlacesSearch {
  available(): boolean;
  search(input: PlacesInput, context: PhoneContext | undefined, signal: AbortSignal): Promise<unknown>;
}
export class GooglePlacesSearch implements PlacesSearch {
  constructor(private net: typeof fetch = fetch) {}
  available() { return mapsConfigured(); }
  private async post(url: string, mask: string, body: unknown, signal: AbortSignal) {
    if (!this.available()) throw new ChatError("PLACES_NOT_CONFIGURED", 503);
    const response = await this.net(url, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", ...await mapsHeaders(signal),
        "X-Goog-FieldMask": mask },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
    if (!response.ok) throw new ChatError(`PLACES_PROVIDER_HTTP_${response.status}`, 503);
    return response.json();
  }
  async search(input: PlacesInput, context: PhoneContext | undefined, signal: AbortSignal) {
    const position = context?.location;
    if (!position && !input.city) throw new ChatError("PLACES_LOCATION_REQUIRED", 422);
    let encodedPolyline: string | undefined;
    if (input.destination) {
      const routes = await this.post("https://routes.googleapis.com/directions/v2:computeRoutes",
        "routes.polyline.encodedPolyline", {
          origin: position ? { location: { latLng: { latitude: position.latitude, longitude: position.longitude } } }
            : { address: input.city },
          destination: { address: input.destination }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
        }, signal);
      encodedPolyline = routes.routes?.[0]?.polyline?.encodedPolyline;
      if (!encodedPolyline) throw new ChatError("PLACES_ROUTE_UNAVAILABLE", 422);
    }
    const data = await this.post("https://places.googleapis.com/v1/places:searchText",
      "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.regularOpeningHours.weekdayDescriptions,places.rating,places.googleMapsUri,places.attributions,places.location",
      {
        textQuery: [input.query, input.city, input.route].filter(Boolean).join(" "), pageSize: 5,
        ...(encodedPolyline ? { searchAlongRouteParameters: { polyline: { encodedPolyline } } }
          : position ? { locationBias: { circle: { center: { latitude: position.latitude, longitude: position.longitude },
            radius: 30000 } } } : {}),
      }, signal);
    if (!Array.isArray(data.places) && data.places !== undefined) throw new ChatError("PLACES_INVALID_RESPONSE", 503);
    return {
      source: "Google Maps", searchedAt: new Date().toISOString(), routeBiased: !!encodedPolyline,
      highwayOnlyRequested: input.highwayOnly,
      // Search-along-route is a BIAS, not proof of an exit's access or a detour.
      limitation: "Product price, stock, route deviation distance and highway-only access are NOT verified. Ask the shop; never invent them.",
      places: (data.places ?? []).slice(0, 5).map((place: any) => ({
        id: place.id, name: place.displayName?.text, address: place.formattedAddress,
        phone: place.internationalPhoneNumber ?? null, hours: place.regularOpeningHours?.weekdayDescriptions ?? null,
        rating: typeof place.rating === "number" ? place.rating : null,
        mapsUrl: /^https:\/\/(?:(?:www\.)?google\.com\/maps\/|maps\.google\.com\/)/.test(place.googleMapsUri ?? "") ? place.googleMapsUri : null,
        attributions: place.attributions ?? [], price: null, stock: "unverified", detourDistanceMeters: null,
        distanceFromRouteMeters: encodedPolyline && place.location
          ? distanceFromRouteMeters(encodedPolyline, place.location) : null,
        distanceKind: "approximate straight-line distance, NOT driving detour or highway access",
      })),
    };
  }
}
export const PLACES_TOOL = {
  type: "function" as const, name: "search_places",
  description: "Read-only Google Maps place candidates near the phone/city or along a route to a destination. No prices or stock are verified.",
  strict: false,
  parameters: { type: "object", properties: {
    query: { type: "string" }, city: { type: "string" }, destination: { type: "string" },
    route: { type: "string" }, highwayOnly: { type: "boolean" },
  }, required: ["query"], additionalProperties: false },
};
