// Tutor catalog (Lucy task, 2026-08-13): the catalog is the DYNAMIC source of
// truth — no hardcoded tutor ids, only tutor_id travels in session create,
// GLB assets are cached by tutor_id + asset_version.
import { describe, it, expect } from "vitest";
import { buildSessionPayload, normalizeTutorEntry, getTutorEngineBase } from "../tutorEngine";
import { TUTOR_AVATAR_PAGE_HTML } from "../tutorAvatarPage";

describe("session create carries only the selected tutor_id", () => {
  it("overrides the default tutor for practice and simulation", () => {
    expect(buildSessionPayload("u1", undefined, "lucy_us_01")).toMatchObject({ tutor_id: "lucy_us_01", mode: "practice" });
    const sim = buildSessionPayload("u1", { goal: "g", learnerRole: "a", tutorRole: "b", context: { source: "none" } }, "lucy_us_01");
    expect(sim).toMatchObject({ tutor_id: "lucy_us_01", mode: "simulation" });
  });
  it("keeps the configured default when no tutor is chosen", () => {
    expect(buildSessionPayload("u1")).toMatchObject({ tutor_id: "emma_us_01" });
  });
  it("never sends avatar/voice/persona internals", () => {
    const json = JSON.stringify(buildSessionPayload("u1", undefined, "lucy_us_01"));
    for (const banned of ["avatar", "voice", "persona", "glb", "elevenlabs"]) expect(json).not.toContain(banned);
  });
});

describe("catalog normalization — client-safe, absolute asset URLs", () => {
  it("normalizes the documented Lucy entry", () => {
    const t = normalizeTutorEntry({
      tutor_id: "lucy_us_01",
      display_name: "Lucy",
      description: "confident mentor",
      avatar: { glb_url: "/api/tutor-assets/avatars/redhead_female_02.glb", preview_url: "/api/tutor-assets/previews/lucy_us_01.png" },
      asset_version: 7,
    });
    expect(t).toEqual({
      tutorId: "lucy_us_01",
      name: "Lucy",
      description: "confident mentor",
      previewUrl: getTutorEngineBase() + "/api/tutor-assets/previews/lucy_us_01.png",
      glbUrl: getTutorEngineBase() + "/api/tutor-assets/avatars/redhead_female_02.glb",
      body: null,
      assetVersion: "7",
    });
  });
  it("keeps already-absolute URLs as-is and rejects malformed entries", () => {
    const t = normalizeTutorEntry({ tutor_id: "x", avatar: { glb_url: "https://cdn.example/x.glb" } })!;
    expect(t.glbUrl).toBe("https://cdn.example/x.glb");
    expect(normalizeTutorEntry(null)).toBeNull();
    expect(normalizeTutorEntry({ display_name: "no id" })).toBeNull();
  });
});

describe("page — dynamic picker + persistent GLB cache", () => {
  it("renders the tutor list from the catalog endpoint, no hardcoded ids", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('api("/api/tutor/tutors")');
    for (const id of ["lucy_us_01", "fiona_us_01"]) expect(TUTOR_AVATAR_PAGE_HTML).not.toContain(id);
  });
  it("caches GLBs by tutor_id + asset_version and evicts old versions", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('caches.open("tutor-glb-v1")');
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/glb-cache\/" \+ encodeURIComponent\(t\.tutorId\) \+ "\/" \+ encodeURIComponent\(version\)/);
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("cache.delete(k); // evict old versions");
  });
  it("prefetches the selected tutor's GLB before Live", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("prefetchTutorGlb(t); // download the GLB before Live");
  });
  it("passes the selected tutorId in status and session create", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('"?tutorId=" + encodeURIComponent(selectedTutorId)');
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("if (selectedTutorId) createBody.tutorId = selectedTutorId;");
  });
});
