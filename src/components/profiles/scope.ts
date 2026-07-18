import type { AppId } from "@/lib/api/types";
import type {
  CurrentProfileIds,
  PerApp,
  Profile,
  ProfileScope,
} from "@/lib/api/profiles";

export const PROFILE_SCOPES: ProfileScope[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
];

export const CONFIG_SET_SCOPES = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
] as const;

export const PROFILE_CURRENT_ID_KEY: Record<
  ProfileScope,
  keyof CurrentProfileIds
> = {
  claude: "claude",
  "claude-desktop": "claudeDesktop",
  codex: "codex",
  gemini: "gemini",
  grokbuild: "grokbuild",
};

/**
 * 应用页 → 所属项目分组（后端 ProfileScope::for_app 的前端镜像，两处同步）
 *
 * 不在映射里的应用不支持 Profile，其标签页不渲染切换器。
 */
export const APP_PROFILE_SCOPE: Partial<Record<AppId, ProfileScope>> = {
  claude: "claude",
  "claude-desktop": "claude-desktop",
  codex: "codex",
  gemini: "gemini",
  grokbuild: "grokbuild",
};

/** 分组内的 payload 槽位 key（后端 ProfileScope::apps 的前端镜像） */
const SCOPE_SLOT_KEYS: Record<ProfileScope, (keyof PerApp<unknown>)[]> = {
  claude: ["claude"],
  "claude-desktop": ["claude-desktop"],
  codex: ["codex"],
  gemini: ["gemini"],
  grokbuild: ["grokbuild"],
};

/**
 * 项目在某分组是否拍过快照（任一槽位非 null 即视为拍过）
 *
 * 未拍过的项目在该分组应用时不改动配置，只绑定 current 标记。
 */
export function hasScopeSnapshot(profile: Profile, scope: ProfileScope) {
  const { providers, mcp, skills, prompts, routing } = profile.payload;
  return SCOPE_SLOT_KEYS[scope].some(
    (app) =>
      providers[app] !== null ||
      mcp[app] !== null ||
      skills[app] !== null ||
      prompts[app] !== null ||
      routing?.[app] != null,
  );
}

/**
 * 返回方案显式绑定的分组；旧方案没有 targets 时按已有快照推断。
 */
export function getProfileTargetScopes(profile: Profile): ProfileScope[] {
  const explicitTargets = profile.payload.targets ?? [];
  if (explicitTargets.length > 0) {
    return PROFILE_SCOPES.filter((scope) => explicitTargets.includes(scope));
  }
  return PROFILE_SCOPES.filter((scope) => hasScopeSnapshot(profile, scope));
}

export function isProfileAvailableForScope(
  profile: Profile,
  scope: ProfileScope,
) {
  return getProfileTargetScopes(profile).includes(scope);
}
