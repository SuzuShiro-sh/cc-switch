import { invoke } from "@tauri-apps/api/core";

/**
 * Profile 操作的应用分组（与后端 services/profile.rs 的 ProfileScope 严格对应）
 *
 * 项目实体全应用共享，快照槽位和当前指针按组保存；应用时由 targets
 * 决定一次需要整体切换哪些分组。
 */
export type ProfileScope =
  | "claude"
  | "claude-desktop"
  | "codex"
  | "gemini"
  | "grokbuild";

/**
 * 按 app 分槽的载荷容器（与后端 services/profile.rs 的 PerApp<T> 严格对应）
 */
export interface PerApp<T> {
  claude: T;
  "claude-desktop": T;
  codex: T;
  gemini: T;
  grokbuild: T;
}

/**
 * 项目 Profile 的配置快照（与后端 ProfilePayload 严格对应）
 *
 * 所有槽位 null = 该侧从未拍过快照（应用时不动），与"拍到的就是空集"
 * （空数组，应用时清空启用）严格区分。
 */
export interface ProfilePayload {
  targets: ProfileScope[];
  providers: PerApp<string | null>;
  mcp: PerApp<string[] | null>;
  skills: PerApp<string[] | null>;
  prompts: PerApp<string | null>;
  /**
   * 每个 Agent 的 CC Switch 路由状态：true/false 为方案显式管理，
   * null 为保持切换前状态。旧方案可能完全缺少该字段。
   */
  routing?: PerApp<boolean | null> | null;
}

export interface Profile {
  id: string;
  name: string;
  payload: ProfilePayload;
  createdAt?: number;
  updatedAt?: number;
}

/** 每个分组当前激活的项目 id（未使用项目时为 null）
 *
 * 注意：JSON key 是 camelCase（claudeDesktop），与 ProfileScope 的 kebab-case
 * 字符串不同——后者用于命令参数，前者用于响应字段。
 */
export interface CurrentProfileIds {
  claude: string | null;
  claudeDesktop: string | null;
  codex: string | null;
  gemini: string | null;
  grokbuild: string | null;
}

export interface ProfilesResponse {
  profiles: Profile[];
  currentIds: CurrentProfileIds;
}

export const profilesApi = {
  /**
   * 获取所有项目及各分组当前激活项目 id
   */
  async list(): Promise<ProfilesResponse> {
    return await invoke("list_profiles");
  },

  /**
   * 创建新项目（只拍发起页所属分组的当前状态，其余分组槽位留空）
   */
  async create(name: string, scope: ProfileScope): Promise<Profile> {
    return await invoke("create_profile", { name, scope });
  },

  /**
   * 更新项目名称和/或显式编辑后的独立配置快照
   */
  async update(
    id: string,
    options: {
      name?: string;
      payload?: ProfilePayload;
    },
  ): Promise<Profile> {
    return await invoke("update_profile", {
      id,
      name: options.name,
      payload: options.payload,
    });
  },

  /**
   * 删除项目
   */
  async delete(id: string): Promise<void> {
    return await invoke("delete_profile", { id });
  },

  /**
   * 按 targets 整体应用 1 个或多个 Agent，返回 warnings
   */
  async apply(id: string): Promise<string[]> {
    return await invoke("apply_profile", { id });
  },

  /**
   * 不使用项目：仅清除某分组的激活标记，不改动任何配置
   */
  async clearCurrent(scope: ProfileScope): Promise<void> {
    return await invoke("clear_current_profile", { scope });
  },
};
