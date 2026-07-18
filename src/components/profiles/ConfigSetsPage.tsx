import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  FolderCog,
  Plus,
  Route,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import McpFormModal from "@/components/mcp/McpFormModal";
import {
  MultiResourceSelectionPanel,
  PromptSelectionPanel,
  ResourceSummaryCard,
} from "@/components/profiles/ProfileResourceEditor";
import PromptFormPanel from "@/components/prompts/PromptFormPanel";
import { SkillGroupManager } from "@/components/skills/SkillGroupManager";
import { providersApi, proxyApi, settingsApi, skillsApi } from "@/lib/api";
import { promptsApi, type Prompt } from "@/lib/api/prompts";
import type {
  PerApp,
  Profile,
  ProfilePayload,
  ProfileScope,
} from "@/lib/api/profiles";
import { useAllMcpServers } from "@/hooks/useMcp";
import { useInstalledSkills, useSkillGroups } from "@/hooks/useSkills";
import {
  useApplyProfileMutation,
  useCreateProfileMutation,
  useDeleteProfileMutation,
  useProfilesQuery,
  useUpdateProfileMutation,
} from "@/lib/query/profiles";
import { deepClone } from "@/utils/deepClone";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { AppId } from "@/lib/api/types";
import {
  CONFIG_SET_SCOPES,
  PROFILE_CURRENT_ID_KEY,
  PROFILE_SCOPES,
} from "@/components/profiles/scope";

const MANAGED_APPS = CONFIG_SET_SCOPES;
type ManagedApp = (typeof MANAGED_APPS)[number];
type ScopeFilter = ManagedApp | "all";

const UNMANAGED_VALUE = "__cc_switch_unmanaged__";

const APP_LABELS: Record<ManagedApp, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  grokbuild: "Grok Build",
};

const emptyPerApp = <T,>(value: T): PerApp<T> => ({
  claude: value,
  "claude-desktop": value,
  codex: value,
  gemini: value,
  grokbuild: value,
});

type EditableProfilePayload = Omit<ProfilePayload, "routing"> & {
  routing: PerApp<boolean | null>;
};

const createEmptyPayload = (): EditableProfilePayload => ({
  targets: [],
  providers: emptyPerApp<string | null>(null),
  mcp: emptyPerApp<string[] | null>(null),
  skills: emptyPerApp<string[] | null>(null),
  prompts: emptyPerApp<string | null>(null),
  routing: emptyPerApp<boolean | null>(null),
});

function normalizePayload(payload?: ProfilePayload): EditableProfilePayload {
  const base = createEmptyPayload();
  if (!payload) return base;
  const hasExplicitRouting = payload.routing != null;
  const normalized: EditableProfilePayload = {
    targets: [],
    providers: { ...base.providers, ...payload.providers },
    mcp: { ...base.mcp, ...payload.mcp },
    skills: { ...base.skills, ...payload.skills },
    prompts: { ...base.prompts, ...payload.prompts },
    routing: { ...base.routing, ...(payload.routing ?? {}) },
  };
  const explicitTargets = (payload.targets ?? []).filter(
    (scope): scope is ProfileScope => PROFILE_SCOPES.includes(scope),
  );
  normalized.targets =
    explicitTargets.length > 0
      ? explicitTargets
      : PROFILE_SCOPES.filter((scope) => hasScopeSlots(normalized, scope));

  // 旧方案没有 routing 字段。后端对此沿用旧行为：切换时关闭目标 Agent
  // 的路由。编辑器将其显式规范化为 false，保存后语义保持不变且可见。
  if (!hasExplicitRouting) {
    for (const app of MANAGED_APPS) {
      if (normalized.targets.includes(app)) {
        normalized.routing[app] = false;
      }
    }
  }
  return normalized;
}

function sortedEntries<T extends { name?: string }>(
  value: Record<string, T> | undefined,
) {
  return Object.entries(value ?? {}).sort(([, a], [, b]) =>
    (a.name ?? "").localeCompare(b.name ?? "", "zh-CN"),
  );
}

function selectedCount(value: string[] | null) {
  return Array.isArray(value) ? value.length : null;
}

function labelForCount(value: string[] | null, unmanagedLabel: string) {
  const count = selectedCount(value);
  return count === null ? unmanagedLabel : String(count);
}

function hasScopeSlots(payload: ProfilePayload, app: ProfileScope) {
  return (
    payload.providers[app] !== null ||
    payload.mcp[app] !== null ||
    payload.skills[app] !== null ||
    payload.prompts[app] !== null ||
    payload.routing?.[app] != null
  );
}

function getTargetApps(payload: ProfilePayload): ManagedApp[] {
  return MANAGED_APPS.filter((app) => payload.targets.includes(app));
}

function normalizeInitialApp(initialApp: AppId): ManagedApp {
  return MANAGED_APPS.includes(initialApp as ManagedApp)
    ? (initialApp as ManagedApp)
    : "claude";
}

interface ConfigSetsPageProps {
  initialApp: AppId;
}

interface ActiveResourceEditor {
  app: ManagedApp;
  kind: "mcp" | "skills" | "prompt";
}

interface PromptEditorState {
  app: ManagedApp;
  id?: string;
}

export function ConfigSetsPage({ initialApp }: ConfigSetsPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const entryApp = normalizeInitialApp(initialApp);
  const { data: profilesData, isLoading: profilesLoading } = useProfilesQuery();
  const { data: mcpServersMap } = useAllMcpServers();
  const { data: installedSkills = [] } = useInstalledSkills();
  const { data: skillGroups = [] } = useSkillGroups();
  const createMutation = useCreateProfileMutation();
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const applyMutation = useApplyProfileMutation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPayload, setDraftPayload] =
    useState<EditableProfilePayload>(createEmptyPayload);
  const [newName, setNewName] = useState("");
  const [createScope, setCreateScope] = useState<ManagedApp>(entryApp);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(entryApp);
  const [activeEditorApp, setActiveEditorApp] = useState<ManagedApp>(entryApp);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [resourceEditor, setResourceEditor] =
    useState<ActiveResourceEditor | null>(null);
  const [mcpEditor, setMcpEditor] = useState<{ id?: string } | null>(null);
  const [promptEditor, setPromptEditor] = useState<PromptEditorState | null>(
    null,
  );
  const [skillGroupManagerOpen, setSkillGroupManagerOpen] = useState(false);
  const loadedProfileIdRef = useRef<string | null>(null);

  const providersQueries = {
    claude: useQuery({
      queryKey: ["configSets", "providers", "claude"],
      queryFn: () => providersApi.getAll("claude"),
    }),
    codex: useQuery({
      queryKey: ["configSets", "providers", "codex"],
      queryFn: () => providersApi.getAll("codex"),
    }),
    gemini: useQuery({
      queryKey: ["configSets", "providers", "gemini"],
      queryFn: () => providersApi.getAll("gemini"),
    }),
    grokbuild: useQuery({
      queryKey: ["configSets", "providers", "grokbuild"],
      queryFn: () => providersApi.getAll("grokbuild"),
    }),
  };

  const promptsQueries = {
    claude: useQuery({
      queryKey: ["configSets", "prompts", "claude"],
      queryFn: () => promptsApi.getPrompts("claude"),
    }),
    codex: useQuery({
      queryKey: ["configSets", "prompts", "codex"],
      queryFn: () => promptsApi.getPrompts("codex"),
    }),
    gemini: useQuery({
      queryKey: ["configSets", "prompts", "gemini"],
      queryFn: () => promptsApi.getPrompts("gemini"),
    }),
    grokbuild: useQuery({
      queryKey: ["configSets", "prompts", "grokbuild"],
      queryFn: () => promptsApi.getPrompts("grokbuild"),
    }),
  };

  const configDirQueries = {
    claude: useQuery({
      queryKey: ["configSets", "configDir", "claude"],
      queryFn: () => settingsApi.getConfigDir("claude"),
    }),
    codex: useQuery({
      queryKey: ["configSets", "configDir", "codex"],
      queryFn: () => settingsApi.getConfigDir("codex"),
    }),
    gemini: useQuery({
      queryKey: ["configSets", "configDir", "gemini"],
      queryFn: () => settingsApi.getConfigDir("gemini"),
    }),
    grokbuild: useQuery({
      queryKey: ["configSets", "configDir", "grokbuild"],
      queryFn: () => settingsApi.getConfigDir("grokbuild"),
    }),
  };

  const { data: proxyTakeoverStatus } = useQuery({
    queryKey: ["proxyTakeoverStatus"],
    queryFn: () => proxyApi.getProxyTakeoverStatus(),
  });

  const profiles = profilesData?.profiles ?? [];
  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((profile) => {
      const payload = normalizePayload(profile.payload);
      const profileTargets = getTargetApps(payload);
      const matchesScope =
        profileTargets.length > 0 &&
        (scopeFilter === "all" || profileTargets.includes(scopeFilter));
      const matchesSearch = !q || profile.name.toLowerCase().includes(q);
      return matchesScope && matchesSearch;
    });
  }, [profiles, scopeFilter, search]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedId);
  const savedPayload = useMemo(
    () => normalizePayload(selectedProfile?.payload),
    [selectedProfile],
  );
  const isDirty =
    Boolean(selectedProfile) &&
    (draftName !== selectedProfile?.name ||
      JSON.stringify(draftPayload) !== JSON.stringify(savedPayload));
  const targetApps = useMemo(() => getTargetApps(draftPayload), [draftPayload]);
  const isSelectedProfileActive = Boolean(
    selectedProfile &&
      PROFILE_SCOPES.some(
        (scope) =>
          profilesData?.currentIds?.[PROFILE_CURRENT_ID_KEY[scope]] ===
          selectedProfile.id,
      ),
  );

  useEffect(() => {
    setCreateScope(entryApp);
    setScopeFilter(entryApp);
    setActiveEditorApp(entryApp);
  }, [entryApp]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !profiles.some((profile) => profile.id === selectedId)) {
      const currentId =
        profilesData?.currentIds?.[PROFILE_CURRENT_ID_KEY[entryApp]] ?? null;
      const currentProfile = profiles.find(
        (profile) =>
          profile.id === currentId &&
          normalizePayload(profile.payload).targets.includes(entryApp),
      );
      const firstForEntry = profiles.find((profile) =>
        normalizePayload(profile.payload).targets.includes(entryApp),
      );
      const firstConfigProfile = profiles.find(
        (profile) =>
          getTargetApps(normalizePayload(profile.payload)).length > 0,
      );
      setSelectedId(
        (currentProfile ?? firstForEntry ?? firstConfigProfile)?.id ?? null,
      );
    }
  }, [entryApp, profiles, profilesData?.currentIds, selectedId]);

  useEffect(() => {
    if (!selectedProfile) {
      loadedProfileIdRef.current = null;
      setDraftName("");
      setDraftPayload(createEmptyPayload());
      return;
    }
    const isSwitchingProfile =
      loadedProfileIdRef.current !== selectedProfile.id;
    if (!isSwitchingProfile && isDirty) {
      return;
    }
    loadedProfileIdRef.current = selectedProfile.id;
    const nextPayload = normalizePayload(selectedProfile.payload);
    setDraftName(selectedProfile.name);
    setDraftPayload(nextPayload);
    const nextTargets = getTargetApps(nextPayload);
    setActiveEditorApp((current) =>
      nextTargets.includes(entryApp)
        ? entryApp
        : nextTargets.includes(current)
          ? current
          : (nextTargets[0] ?? entryApp),
    );
  }, [entryApp, selectedProfile, isDirty]);

  useEffect(() => {
    if (targetApps.length > 0 && !targetApps.includes(activeEditorApp)) {
      setActiveEditorApp(targetApps[0]);
    }
  }, [activeEditorApp, targetApps]);

  const mcpServers = useMemo(
    () =>
      Object.values(mcpServersMap ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN"),
      ),
    [mcpServersMap],
  );

  const skills = useMemo(
    () =>
      [...installedSkills].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN"),
      ),
    [installedSkills],
  );

  const updatePayload = (updater: (next: EditableProfilePayload) => void) => {
    setDraftPayload((current) => {
      const next = normalizePayload(deepClone(current));
      updater(next);
      return next;
    });
  };

  const getDefaultMcpIds = (app: ManagedApp) =>
    mcpServers
      .filter((server) => server.apps?.[app] === true)
      .map((server) => server.id);

  const getDefaultSkillIds = (app: ManagedApp) =>
    skills
      .filter((skill) => skill.apps?.[app] === true)
      .map((skill) => skill.id);

  const getDefaultPromptId = (app: ManagedApp) =>
    Object.entries(promptsQueries[app].data ?? {}).find(
      ([, prompt]) => prompt.enabled,
    )?.[0] ?? null;

  const getSkillSummaryLabels = (ids: string[]) => {
    const selected = new Set(ids);
    const remaining = new Set(ids);
    const labels: string[] = [];
    for (const group of skillGroups) {
      const existingMembers = group.skillIds.filter((id) =>
        skills.some((skill) => skill.id === id),
      );
      if (
        existingMembers.length > 0 &&
        existingMembers.every((id) => selected.has(id))
      ) {
        labels.push(group.name);
        existingMembers.forEach((id) => remaining.delete(id));
      }
    }
    for (const skill of skills) {
      if (remaining.has(skill.id)) labels.push(skill.name);
    }
    return labels;
  };

  const handleOpenSkillFolder = async (id: string) => {
    try {
      await skillsApi.openFolder(id);
    } catch (error) {
      toast.error(
        t("skills.openFolderFailed", { defaultValue: "打开目录失败" }),
        { description: extractErrorMessage(error) },
      );
    }
  };

  const handlePromptSave = async (id: string, prompt: Prompt) => {
    if (!promptEditor) return;
    try {
      await promptsApi.upsertPrompt(promptEditor.app, id, prompt);
      await queryClient.invalidateQueries({
        queryKey: ["configSets", "prompts", promptEditor.app],
      });
      toast.success(t("common.success"));
    } catch (error) {
      toast.error(t("common.error"), {
        description: extractErrorMessage(error),
      });
      throw error;
    }
  };

  const saveSelectedProfile = async (silent = false) => {
    if (!selectedProfile) return;
    return await updateMutation.mutateAsync({
      id: selectedProfile.id,
      name: draftName.trim() || selectedProfile.name,
      payload: normalizePayload(draftPayload),
      silent,
    });
  };

  const notifyApplyResult = (
    warnings: string[],
    result: "saved" | "saved-and-applied" | "applied",
  ) => {
    if (warnings.length > 0) {
      toast.warning(
        t("profiles.applyWarnings", {
          warningCount: warnings.length,
          details: warnings.join("\n"),
        }),
        { closeButton: true, duration: 10000 },
      );
      return;
    }
    const message =
      result === "saved"
        ? t("configSets.saveSuccess", { defaultValue: "方案已保存" })
        : result === "saved-and-applied"
          ? t("configSets.saveAppliedSuccess", {
              defaultValue: "方案已保存并同步到所有关联 Agent",
            })
          : t("profiles.applySuccess");
    toast.success(message, { closeButton: true });
  };

  const handleSave = async () => {
    if (targetApps.length === 0) {
      toast.error(
        t("configSets.targetRequired", {
          defaultValue: "至少选择一个适用 Agent",
        }),
      );
      return;
    }
    try {
      await saveSelectedProfile(true);
      if (isSelectedProfileActive && selectedProfile) {
        const warnings = await applyMutation.mutateAsync({
          id: selectedProfile.id,
          silent: true,
        });
        notifyApplyResult(warnings, "saved-and-applied");
      } else {
        notifyApplyResult([], "saved");
      }
    } catch {
      // mutation 已统一展示错误 toast。
    }
  };

  const handleApplyAll = async () => {
    if (!selectedProfile || targetApps.length === 0) {
      toast.error(
        t("configSets.targetRequired", {
          defaultValue: "至少选择一个适用 Agent",
        }),
      );
      return;
    }
    setIsApplyingAll(true);
    const savedBeforeApply = isDirty;
    try {
      if (isDirty) {
        await saveSelectedProfile(true);
      }
      const warnings = await applyMutation.mutateAsync({
        id: selectedProfile.id,
        silent: true,
      });
      notifyApplyResult(
        warnings,
        savedBeforeApply ? "saved-and-applied" : "applied",
      );
    } catch {
      // 保存失败时不继续应用；错误 toast 由 mutation 统一处理。
    } finally {
      setIsApplyingAll(false);
    }
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate(
      { name, scope: createScope },
      {
        onSuccess: (profile) => {
          setNewName("");
          setSelectedId(profile.id);
          setScopeFilter(createScope as ManagedApp);
          setActiveEditorApp(createScope as ManagedApp);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    deleteMutation.mutate(targetId, {
      onSuccess: () => {
        setDeleteTarget(null);
        if (selectedId === targetId) {
          setSelectedId(null);
        }
      },
    });
  };

  const activeAppsForProfile = (profileId: string) =>
    MANAGED_APPS.filter(
      (app) =>
        profilesData?.currentIds?.[PROFILE_CURRENT_ID_KEY[app]] === profileId,
    );

  const handleSelectProfile = (profileId: string) => {
    if (profileId !== selectedId && isDirty) {
      toast.warning(
        t("configSets.saveBeforeSwitch", {
          defaultValue: "请先保存当前方案，再切换到其他方案",
        }),
      );
      return;
    }
    setSelectedId(profileId);
  };

  const renderSummary = (profile: Profile, app: ManagedApp) => {
    const payload = normalizePayload(profile.payload);
    const providers = providersQueries[app].data;
    const prompts = promptsQueries[app].data;
    const providerId = payload.providers[app];
    const promptId = payload.prompts[app];
    const routingState = payload.routing[app];
    const providerName = providerId
      ? (providers?.[providerId]?.name ??
        t("configSets.missingShort", {
          defaultValue: "缺失",
        }))
      : t("configSets.unmanaged", {
          defaultValue: "未管理",
        });
    const promptName = promptId
      ? (prompts?.[promptId]?.name ??
        t("configSets.missingShort", {
          defaultValue: "缺失",
        }))
      : t("configSets.unmanaged", {
          defaultValue: "未管理",
        });

    return (
      <div key={app} className="rounded-md bg-muted/40 p-2">
        <div className="mb-1 text-xs font-semibold">{APP_LABELS[app]}</div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="truncate">
            {t("configSets.provider", { defaultValue: "配置" })}: {providerName}
          </div>
          <div>
            MCP:{" "}
            {labelForCount(
              payload.mcp[app],
              t("configSets.unmanaged", { defaultValue: "未管理" }),
            )}
            <span className="mx-1">·</span>
            Skills:{" "}
            {labelForCount(
              payload.skills[app],
              t("configSets.unmanaged", { defaultValue: "未管理" }),
            )}
          </div>
          <div className="truncate">
            {t("configSets.prompt", { defaultValue: "提示词" })}: {promptName}
          </div>
          <div
            className={cn(
              "flex items-center gap-1 truncate font-medium",
              routingState === true && "text-emerald-600 dark:text-emerald-400",
              routingState === false && "text-amber-600 dark:text-amber-400",
            )}
          >
            <Route className="h-3.5 w-3.5 shrink-0" />
            {t("configSets.routing", { defaultValue: "CC Switch 路由" })}:{" "}
            {routingState === null
              ? t("configSets.unmanaged", { defaultValue: "未管理" })
              : routingState
                ? t("configSets.routingEnabled", { defaultValue: "开启" })
                : t("configSets.routingDisabled", { defaultValue: "关闭" })}
          </div>
        </div>
      </div>
    );
  };

  const renderAppEditor = (app: ManagedApp) => {
    const providers = providersQueries[app].data ?? {};
    const promptMap = promptsQueries[app].data ?? {};
    const providerId = draftPayload.providers[app];
    const promptId = draftPayload.prompts[app];
    const routingState = draftPayload.routing[app];
    const routingManaged = routingState !== null;
    const selectedProvider = providerId ? providers[providerId] : undefined;
    const officialRoutingWarning =
      routingState === true && selectedProvider?.category === "official";
    const providerMissing = providerId && !providers[providerId];
    const mcpValue = draftPayload.mcp[app];
    const skillsValue = draftPayload.skills[app];
    const selectedMcpIds = Array.isArray(mcpValue) ? mcpValue : [];
    const selectedSkillIds = Array.isArray(skillsValue) ? skillsValue : [];
    const existingMcpIds = new Set(mcpServers.map((server) => server.id));
    const existingSkillIds = new Set(skills.map((skill) => skill.id));
    const missingMcpIds = selectedMcpIds.filter(
      (id) => !existingMcpIds.has(id),
    );
    const missingSkillIds = selectedSkillIds.filter(
      (id) => !existingSkillIds.has(id),
    );

    return (
      <TabsContent key={app} value={app} className="mt-4 space-y-4">
        <div className="rounded-lg border bg-muted/25 p-4">
          <h2 className="text-base font-semibold">{APP_LABELS[app]}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("configSets.configDir", {
              defaultValue: "当前配置目录",
            })}
            :{" "}
            <span className="font-mono">
              {configDirQueries[app].data ??
                t("common.loading", { defaultValue: "加载中..." })}
            </span>
          </p>
        </div>

        <section className="rounded-lg border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {t("configSets.providerConfig", {
              defaultValue: "供应商配置",
            })}
          </h3>
          <Select
            value={providerId ?? UNMANAGED_VALUE}
            onValueChange={(value) =>
              updatePayload((next) => {
                next.providers[app] = value === UNMANAGED_VALUE ? null : value;
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNMANAGED_VALUE}>
                {t("configSets.unmanaged", { defaultValue: "未管理" })}
              </SelectItem>
              {sortedEntries(providers).map(([id, provider]) => (
                <SelectItem key={id} value={id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {providerMissing && (
            <Badge className="mt-3" variant="destructive">
              {t("configSets.missingRef", {
                defaultValue: "缺失: {{id}}",
                id: providerId,
              })}
            </Badge>
          )}
        </section>

        <section className="rounded-lg border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold">
                  {t("configSets.routing", {
                    defaultValue: "CC Switch 路由",
                  })}
                </h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("configSets.routingDescription", {
                  defaultValue:
                    "切换方案时同步设置此 Agent 的路由。取消管理会保留当时的路由状态。",
                })}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={routingManaged}
                onCheckedChange={(checked) =>
                  updatePayload((next) => {
                    next.routing[app] =
                      checked === true
                        ? (proxyTakeoverStatus?.[app] ?? false)
                        : null;
                  })
                }
              />
              {t("configSets.manageSection", {
                defaultValue: "由方案管理",
              })}
            </label>
          </div>

          {routingManaged && (
            <div className="mt-4 flex min-h-12 items-center justify-between rounded-md border bg-muted/25 px-3 py-2">
              <div>
                <div className="text-sm font-medium">
                  {routingState
                    ? t("configSets.routingEnabled", { defaultValue: "开启" })
                    : t("configSets.routingDisabled", {
                        defaultValue: "关闭",
                      })}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {routingState
                    ? t("configSets.routingEnabledHint", {
                        defaultValue: "应用方案后由 CC Switch 接管请求",
                      })
                    : t("configSets.routingDisabledHint", {
                        defaultValue: "应用方案后使用 Agent 的直接连接",
                      })}
                </div>
              </div>
              <Switch
                checked={routingState === true}
                onCheckedChange={(checked) =>
                  updatePayload((next) => {
                    next.routing[app] = checked;
                  })
                }
                aria-label={t("configSets.routing", {
                  defaultValue: "CC Switch 路由",
                })}
              />
            </div>
          )}

          {officialRoutingWarning && (
            <p className="mt-3 text-xs text-destructive">
              {t("configSets.routingOfficialWarning", {
                defaultValue:
                  "当前选择的是官方供应商。经本地路由使用官方账号可能存在账号风险，请确认后再开启。",
              })}
            </p>
          )}
        </section>

        <ResourceSummaryCard
          title="MCP"
          description={t("configSets.mcpDescription", {
            defaultValue:
              "选择启用这一方案时要保留的 MCP。取消管理时不会改动当前 MCP 状态。",
          })}
          managed={Array.isArray(mcpValue)}
          onManagedChange={(managed) =>
            updatePayload((next) => {
              next.mcp[app] = managed ? getDefaultMcpIds(app) : null;
            })
          }
          selectedCount={selectedMcpIds.length}
          selectedLabels={selectedMcpIds
            .map((id) => mcpServersMap?.[id]?.name)
            .filter((name): name is string => Boolean(name))}
          missingIds={missingMcpIds}
          onEdit={() => setResourceEditor({ app, kind: "mcp" })}
        />

        <ResourceSummaryCard
          title="Skills"
          description={t("configSets.skillsDescription", {
            defaultValue:
              "选择启用这一方案时要保留的 Skills。取消管理时不会改动当前 Skills 状态。",
          })}
          managed={Array.isArray(skillsValue)}
          onManagedChange={(managed) =>
            updatePayload((next) => {
              next.skills[app] = managed ? getDefaultSkillIds(app) : null;
            })
          }
          selectedCount={selectedSkillIds.length}
          selectedLabels={getSkillSummaryLabels(selectedSkillIds)}
          missingIds={missingSkillIds}
          onEdit={() => setResourceEditor({ app, kind: "skills" })}
        />

        <ResourceSummaryCard
          title={t("configSets.prompt", { defaultValue: "全局提示词" })}
          description={t("configSets.promptDescription", {
            defaultValue:
              "选择应用方案时使用的全局提示词，并可在选择页面直接编辑。",
          })}
          managed={promptId !== null}
          onManagedChange={(managed) => {
            if (!managed) {
              updatePayload((next) => {
                next.prompts[app] = null;
              });
              return;
            }
            const defaultPromptId = getDefaultPromptId(app);
            if (defaultPromptId) {
              updatePayload((next) => {
                next.prompts[app] = defaultPromptId;
              });
            } else {
              setResourceEditor({ app, kind: "prompt" });
            }
          }}
          selectedCount={promptId ? 1 : 0}
          selectedLabels={
            promptId && promptMap[promptId] ? [promptMap[promptId].name] : []
          }
          missingIds={promptId && !promptMap[promptId] ? [promptId] : []}
          onEdit={() => setResourceEditor({ app, kind: "prompt" })}
        />
      </TabsContent>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-6 py-4">
      <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border bg-background">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center gap-2">
            <FolderCog className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold">
              {t("configSets.title", { defaultValue: "配置方案" })}
            </h2>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("configSets.searchPlaceholder", {
                defaultValue: "搜索方案",
              })}
              className="pl-8"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1">
            {(["all", ...MANAGED_APPS] as ScopeFilter[]).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => setScopeFilter(scope)}
                className={cn(
                  "h-8 rounded-md px-2 text-xs font-medium transition-colors",
                  scopeFilter === scope
                    ? "bg-foreground text-background"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {scope === "all"
                  ? t("configSets.filterAll", { defaultValue: "全部方案" })
                  : APP_LABELS[scope]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {profilesLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t("configSets.empty", {
                defaultValue: "暂无配置方案",
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProfiles.map((profile) => {
                const profileTargets = getTargetApps(
                  normalizePayload(profile.payload),
                );
                const activeApps = activeAppsForProfile(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => handleSelectProfile(profile.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      selectedId === profile.id
                        ? "border-blue-500 bg-blue-500/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {profile.name}
                      </span>
                      <div className="flex shrink-0 gap-1">
                        {activeApps.length > 0 && (
                          <Badge variant="default">
                            {t("configSets.active", {
                              defaultValue: "使用中",
                            })}
                          </Badge>
                        )}
                        {selectedId === profile.id && (
                          <Badge variant="secondary">
                            {t("configSets.editing", {
                              defaultValue: "编辑中",
                            })}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {profileTargets.map((app) => (
                        <Badge key={app} variant="outline">
                          {APP_LABELS[app]}
                        </Badge>
                      ))}
                    </div>
                    <div className="grid gap-2">
                      {profileTargets.map((app) => renderSummary(profile, app))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <Label className="text-xs">
            {t("configSets.createFromCurrent", {
              defaultValue: "从当前状态创建",
            })}
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("profiles.namePlaceholder")}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreate();
              }}
            />
            <Select
              value={createScope}
              onValueChange={(value) => setCreateScope(value as ManagedApp)}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANAGED_APPS.map((app) => (
                  <SelectItem key={app} value={app}>
                    {APP_LABELS[app]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="mt-2 w-full"
            size="sm"
            onClick={handleCreate}
            disabled={!newName.trim() || createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("common.add")}
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto rounded-lg border bg-background">
        {!selectedProfile ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center p-8 text-center">
            <FolderCog className="mb-4 h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {t("configSets.empty", {
                defaultValue: "暂无配置方案",
              })}
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {t("configSets.emptyHint", {
                defaultValue:
                  "先从当前 Claude、Codex 或 Gemini 状态创建一个方案，再在这里可视化编辑。",
              })}
            </p>
          </div>
        ) : (
          <div className="p-5">
            <div className="mb-5 flex flex-col gap-3 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-xl flex-1">
                <Label htmlFor="config-set-name">
                  {t("configSets.name", { defaultValue: "方案名称" })}
                </Label>
                <Input
                  id="config-set-name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  className="mt-2"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("configSets.saveHint", {
                    defaultValue:
                      "方案是独立快照，不会被日常修改反写；保存正在使用的方案时会立即同步全部关联 Agent。",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleApplyAll()}
                  disabled={
                    targetApps.length === 0 ||
                    updateMutation.isPending ||
                    applyMutation.isPending ||
                    isApplyingAll
                  }
                >
                  <Check className="mr-2 h-4 w-4" />
                  {t("configSets.applyAll", {
                    defaultValue: "应用 Agent 捆绑包",
                  })}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(selectedProfile)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("common.delete")}
                </Button>
                <Button
                  onClick={() => void handleSave()}
                  disabled={targetApps.length === 0 || updateMutation.isPending}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {updateMutation.isPending
                    ? t("common.saving")
                    : t("common.save")}
                </Button>
              </div>
            </div>

            <section className="mb-5 border-b pb-5">
              <div className="mb-3">
                <h2 className="text-sm font-semibold">
                  {t("configSets.targetAgents", {
                    defaultValue: "适用 Agent",
                  })}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("configSets.targetAgentsDescription", {
                    defaultValue:
                      "方案只在选中的 Agent 页面出现；从任一页面应用时会同步整套配置。",
                  })}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {MANAGED_APPS.map((app) => {
                  const enabled = targetApps.includes(app);
                  const active =
                    profilesData?.currentIds?.[PROFILE_CURRENT_ID_KEY[app]] ===
                    selectedProfile.id;
                  return (
                    <label
                      key={app}
                      className={cn(
                        "flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                        enabled
                          ? "border-blue-500 bg-blue-500/5"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <Checkbox
                        checked={enabled}
                        onCheckedChange={(checked) =>
                          updatePayload((next) => {
                            const managedTargets = new Set(
                              next.targets.filter((scope) =>
                                MANAGED_APPS.includes(scope as ManagedApp),
                              ),
                            );
                            if (checked === true) {
                              managedTargets.add(app);
                            } else {
                              managedTargets.delete(app);
                            }
                            const preservedTargets = next.targets.filter(
                              (scope) =>
                                !MANAGED_APPS.includes(scope as ManagedApp),
                            );
                            next.targets = [
                              ...preservedTargets,
                              ...MANAGED_APPS.filter((scope) =>
                                managedTargets.has(scope),
                              ),
                            ];
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {APP_LABELS[app]}
                        </span>
                        {active && (
                          <span className="mt-0.5 block text-xs text-blue-600 dark:text-blue-400">
                            {t("configSets.activeOnAgent", {
                              defaultValue: "当前已应用",
                            })}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              {targetApps.length === 0 && (
                <p className="mt-2 text-xs text-destructive">
                  {t("configSets.targetRequired", {
                    defaultValue: "至少选择一个适用 Agent",
                  })}
                </p>
              )}
            </section>

            <Tabs
              value={activeEditorApp}
              onValueChange={(value) => setActiveEditorApp(value as ManagedApp)}
            >
              <TabsList className="w-full justify-start overflow-x-auto">
                {targetApps.map((app) => (
                  <TabsTrigger key={app} value={app} className="min-w-[140px]">
                    {APP_LABELS[app]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {targetApps.map((app) => renderAppEditor(app))}
            </Tabs>
          </div>
        )}
      </main>

      {resourceEditor?.kind === "mcp" && (
        <MultiResourceSelectionPanel
          key={`${resourceEditor.app}:mcp`}
          isOpen
          kind="mcp"
          title={`${APP_LABELS[resourceEditor.app]} · MCP`}
          value={draftPayload.mcp[resourceEditor.app]}
          defaultIds={getDefaultMcpIds(resourceEditor.app)}
          items={mcpServers.map((server) => ({
            id: server.id,
            name: server.name,
            description: server.description,
          }))}
          onSave={(value) => {
            updatePayload((next) => {
              next.mcp[resourceEditor.app] = value;
            });
            setResourceEditor(null);
          }}
          onClose={() => setResourceEditor(null)}
          onCreate={() => setMcpEditor({})}
          onEdit={(id) => setMcpEditor({ id })}
        />
      )}

      {resourceEditor?.kind === "skills" && (
        <MultiResourceSelectionPanel
          key={`${resourceEditor.app}:skills`}
          isOpen
          kind="skills"
          title={`${APP_LABELS[resourceEditor.app]} · Skills`}
          value={draftPayload.skills[resourceEditor.app]}
          defaultIds={getDefaultSkillIds(resourceEditor.app)}
          items={skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
          }))}
          skillGroups={skillGroups}
          onSave={(value) => {
            updatePayload((next) => {
              next.skills[resourceEditor.app] = value;
            });
            setResourceEditor(null);
          }}
          onClose={() => setResourceEditor(null)}
          onOpenFolder={(id) => void handleOpenSkillFolder(id)}
          onManageGroups={() => setSkillGroupManagerOpen(true)}
        />
      )}

      {resourceEditor?.kind === "prompt" && (
        <PromptSelectionPanel
          key={`${resourceEditor.app}:prompt`}
          isOpen
          title={`${APP_LABELS[resourceEditor.app]} · ${t("configSets.prompt", {
            defaultValue: "全局提示词",
          })}`}
          value={draftPayload.prompts[resourceEditor.app]}
          defaultId={getDefaultPromptId(resourceEditor.app)}
          items={sortedEntries<Prompt>(
            promptsQueries[resourceEditor.app].data,
          ).map(([id, prompt]) => ({
            id,
            name: prompt.name,
            description: prompt.description,
          }))}
          onSave={(value) => {
            updatePayload((next) => {
              next.prompts[resourceEditor.app] = value;
            });
            setResourceEditor(null);
          }}
          onClose={() => setResourceEditor(null)}
          onCreate={() =>
            setPromptEditor({
              app: resourceEditor.app,
            })
          }
          onEdit={(id) =>
            setPromptEditor({
              app: resourceEditor.app,
              id,
            })
          }
        />
      )}

      {skillGroupManagerOpen && (
        <SkillGroupManager
          isOpen
          onClose={() => setSkillGroupManagerOpen(false)}
          skills={skills}
        />
      )}

      {mcpEditor && (
        <McpFormModal
          editingId={mcpEditor.id}
          initialData={mcpEditor.id ? mcpServersMap?.[mcpEditor.id] : undefined}
          existingIds={Object.keys(mcpServersMap ?? {})}
          defaultEnabledApps={[resourceEditor?.app ?? activeEditorApp]}
          onSave={async () => {
            await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
            setMcpEditor(null);
          }}
          onClose={() => setMcpEditor(null)}
        />
      )}

      {promptEditor && (
        <PromptFormPanel
          appId={promptEditor.app}
          editingId={promptEditor.id}
          initialData={
            promptEditor.id
              ? promptsQueries[promptEditor.app].data?.[promptEditor.id]
              : undefined
          }
          onSave={handlePromptSave}
          onClose={() => setPromptEditor(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          isOpen
          title={t("profiles.deleteConfirmTitle")}
          message={t("profiles.deleteConfirmMessage", {
            name: deleteTarget.name,
          })}
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
