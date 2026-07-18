import { describe, expect, it } from "vitest";
import type { PerApp, Profile, ProfilePayload } from "@/lib/api/profiles";
import { getProfileTargetScopes, isProfileAvailableForScope } from "./scope";

const perApp = <T>(value: T): PerApp<T> => ({
  claude: value,
  "claude-desktop": value,
  codex: value,
  gemini: value,
  grokbuild: value,
});

const profileWith = (payload: Partial<ProfilePayload>): Profile => ({
  id: "profile-1",
  name: "Test profile",
  payload: {
    targets: [],
    providers: perApp<string | null>(null),
    mcp: perApp<string[] | null>(null),
    skills: perApp<string[] | null>(null),
    prompts: perApp<string | null>(null),
    routing: perApp<boolean | null>(null),
    ...payload,
  },
});

describe("profile target scopes", () => {
  it("uses explicit targets even when other app slots retain data", () => {
    const providers = perApp<string | null>(null);
    providers.claude = "claude-provider";
    providers.codex = "codex-provider";
    const profile = profileWith({ targets: ["codex"], providers });

    expect(getProfileTargetScopes(profile)).toEqual(["codex"]);
    expect(isProfileAvailableForScope(profile, "codex")).toBe(true);
    expect(isProfileAvailableForScope(profile, "claude")).toBe(false);
  });

  it("infers targets from snapshots for legacy profiles", () => {
    const mcp = perApp<string[] | null>(null);
    mcp.claude = [];
    const skills = perApp<string[] | null>(null);
    skills.gemini = ["skill-1"];
    const profile = profileWith({ mcp, skills });

    expect(getProfileTargetScopes(profile)).toEqual(["claude", "gemini"]);
  });

  it("infers a target from an explicitly managed routing state", () => {
    const routing = perApp<boolean | null>(null);
    routing.codex = false;
    const profile = profileWith({ routing });

    expect(getProfileTargetScopes(profile)).toEqual(["codex"]);
  });

  it("supports Grok Build snapshots and explicit targets", () => {
    const prompts = perApp<string | null>(null);
    prompts.grokbuild = "grok-prompt";
    const profile = profileWith({ prompts });

    expect(getProfileTargetScopes(profile)).toEqual(["grokbuild"]);
    expect(isProfileAvailableForScope(profile, "grokbuild")).toBe(true);
  });
});
