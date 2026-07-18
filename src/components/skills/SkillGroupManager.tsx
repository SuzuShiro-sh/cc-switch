import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  FolderTree,
  ListFilter,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateSkillGroup,
  useDeleteSkillGroup,
  useSkillGroups,
  useUpdateSkillGroup,
  type InstalledSkill,
} from "@/hooks/useSkills";
import { skillsApi } from "@/lib/api/skills";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";

const NEW_GROUP_ID = "__new_skill_group__";
type MemberFilter = "all" | "ungrouped";

interface SkillGroupManagerProps {
  isOpen: boolean;
  onClose: () => void;
  skills: InstalledSkill[];
}

type PendingAction = { type: "close" } | { type: "select"; id: string } | null;

export function SkillGroupManager({
  isOpen,
  onClose,
  skills,
}: SkillGroupManagerProps) {
  const { t } = useTranslation();
  const { data: groups = [], isLoading } = useSkillGroups();
  const createMutation = useCreateSkillGroup();
  const updateMutation = useUpdateSkillGroup();
  const deleteMutation = useDeleteSkillGroup();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const rangeAnchorIdRef = useRef<string | null>(null);
  const shiftPressedRef = useRef(false);

  const selectedGroup = groups.find((group) => group.id === selectedId);
  const isCreating = selectedId === NEW_GROUP_ID;
  const isDirty = isCreating
    ? draftName.trim().length > 0 || draftSkillIds.length > 0
    : Boolean(
        selectedGroup &&
          (draftName !== selectedGroup.name ||
            JSON.stringify(draftSkillIds) !==
              JSON.stringify(selectedGroup.skillIds)),
      );

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    [skills],
  );
  const groupedSkillIds = useMemo(
    () => new Set(groups.flatMap((group) => group.skillIds)),
    [groups],
  );
  const filteredSkills = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortedSkills.filter((skill) => {
      const matchesFilter =
        memberFilter === "all" || !groupedSkillIds.has(skill.id);
      const matchesSearch =
        !query ||
        `${skill.name} ${skill.description ?? ""} ${skill.directory}`
          .toLocaleLowerCase()
          .includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [groupedSkillIds, memberFilter, search, sortedSkills]);
  const selectedSkillSet = useMemo(
    () => new Set(draftSkillIds),
    [draftSkillIds],
  );
  const visibleSelectedCount = filteredSkills.reduce(
    (count, skill) => count + Number(selectedSkillSet.has(skill.id)),
    0,
  );
  const visibleSelectionState =
    visibleSelectedCount === 0
      ? false
      : visibleSelectedCount === filteredSkills.length
        ? true
        : "indeterminate";

  const loadGroup = (id: string) => {
    setSelectedId(id);
    setSearch("");
    setMemberFilter(id === NEW_GROUP_ID ? "ungrouped" : "all");
    rangeAnchorIdRef.current = null;
    if (id === NEW_GROUP_ID) {
      setDraftName("");
      setDraftSkillIds([]);
      return;
    }
    const group = groups.find((item) => item.id === id);
    setDraftName(group?.name ?? "");
    setDraftSkillIds(group?.skillIds ?? []);
  };

  useEffect(() => {
    if (!isOpen) return;
    if (selectedId === NEW_GROUP_ID) return;
    const current = groups.find((group) => group.id === selectedId);
    if (current) return;
    const nextId = groups[0]?.id ?? NEW_GROUP_ID;
    setSelectedId(nextId);
    if (nextId === NEW_GROUP_ID) {
      setDraftName("");
      setDraftSkillIds([]);
      setMemberFilter("ungrouped");
    } else {
      setDraftName(groups[0].name);
      setDraftSkillIds(groups[0].skillIds);
      setMemberFilter("all");
    }
  }, [groups, isOpen, selectedId]);

  const requestSelect = (id: string) => {
    if (id === selectedId) return;
    if (isDirty) {
      setPendingAction({ type: "select", id });
      return;
    }
    loadGroup(id);
  };

  const requestClose = () => {
    if (isDirty) {
      setPendingAction({ type: "close" });
      return;
    }
    onClose();
  };

  const discardAndContinue = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action?.type === "select") {
      loadGroup(action.id);
    } else if (action?.type === "close") {
      onClose();
    }
  };

  const updateSkillSelection = (
    current: string[],
    skillIds: string[],
    enabled: boolean,
  ) => {
    if (enabled) {
      const currentSet = new Set(current);
      return [
        ...current,
        ...skillIds.filter((skillId) => !currentSet.has(skillId)),
      ];
    }
    const removedIds = new Set(skillIds);
    return current.filter((skillId) => !removedIds.has(skillId));
  };

  const toggleSkill = (id: string, enabled: boolean, useRange: boolean) => {
    const anchorIndex = filteredSkills.findIndex(
      (skill) => skill.id === rangeAnchorIdRef.current,
    );
    const currentIndex = filteredSkills.findIndex((skill) => skill.id === id);
    const hasVisibleRange = useRange && anchorIndex >= 0 && currentIndex >= 0;
    const skillIds = hasVisibleRange
      ? filteredSkills
          .slice(
            Math.min(anchorIndex, currentIndex),
            Math.max(anchorIndex, currentIndex) + 1,
          )
          .map((skill) => skill.id)
      : [id];

    setDraftSkillIds((current) =>
      updateSkillSelection(current, skillIds, enabled),
    );
    if (!hasVisibleRange) rangeAnchorIdRef.current = id;
  };

  const toggleVisibleSkills = (enabled: boolean) => {
    setDraftSkillIds((current) =>
      updateSkillSelection(
        current,
        filteredSkills.map((skill) => skill.id),
        enabled,
      ),
    );
    rangeAnchorIdRef.current = null;
  };

  const handleSave = async () => {
    const name = draftName.trim();
    if (!name) return;
    try {
      const saved = isCreating
        ? await createMutation.mutateAsync({
            name,
            skillIds: draftSkillIds,
          })
        : await updateMutation.mutateAsync({
            id: selectedId as string,
            name,
            skillIds: draftSkillIds,
          });
      setSelectedId(saved.id);
      setDraftName(saved.name);
      setDraftSkillIds(saved.skillIds);
      setSearch("");
      setMemberFilter("all");
      toast.success(
        t("skills.groups.saveSuccess", {
          defaultValue: "Skills 分组已保存",
        }),
      );
    } catch (error) {
      toast.error(t("common.error"), {
        description: extractErrorMessage(error),
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedGroup) return;
    try {
      await deleteMutation.mutateAsync(selectedGroup.id);
      setDeleteConfirmOpen(false);
      const remaining = groups.filter((group) => group.id !== selectedGroup.id);
      loadGroup(remaining[0]?.id ?? NEW_GROUP_ID);
      toast.success(
        t("skills.groups.deleteSuccess", {
          defaultValue: "Skills 分组已删除",
        }),
      );
    } catch (error) {
      toast.error(t("common.error"), {
        description: extractErrorMessage(error),
      });
    }
  };

  const handleOpenFolder = async (id: string) => {
    try {
      await skillsApi.openFolder(id);
    } catch (error) {
      toast.error(
        t("skills.openFolderFailed", { defaultValue: "打开目录失败" }),
        {
          description: extractErrorMessage(error),
        },
      );
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <FullScreenPanel
        isOpen={isOpen}
        title={t("skills.groups.title", { defaultValue: "Skills 分组" })}
        onClose={requestClose}
        contentClassName="h-full p-0 space-y-0 overflow-hidden"
        footer={
          <>
            {!isCreating && selectedGroup && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.delete")}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSave}
              disabled={!draftName.trim() || isSaving}
            >
              {isSaving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="max-h-48 min-h-0 overflow-y-auto border-b bg-muted/20 p-3 md:max-h-none md:border-b-0 md:border-r">
            <Button
              type="button"
              variant="outline"
              className="mb-3 w-full justify-start"
              onClick={() => requestSelect(NEW_GROUP_ID)}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("skills.groups.create", { defaultValue: "新建分组" })}
            </Button>
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : groups.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t("skills.groups.empty", { defaultValue: "暂无分组" })}
              </div>
            ) : (
              <div className="space-y-1">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => requestSelect(group.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      selectedId === group.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <FolderTree className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {group.name}
                    </span>
                    <span className="text-xs opacity-70">
                      {group.skillIds.length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <main className="flex min-h-0 flex-col p-5">
            <div className="grid shrink-0 gap-4 border-b pb-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,360px)]">
              <div>
                <Label htmlFor="skill-group-name">
                  {t("skills.groups.name", { defaultValue: "分组名称" })}
                </Label>
                <Input
                  id="skill-group-name"
                  className="mt-2"
                  value={draftName}
                  maxLength={80}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder={t("skills.groups.namePlaceholder", {
                    defaultValue: "例如：科研工具",
                  })}
                />
              </div>
              <div>
                <Label htmlFor="skill-group-search">
                  {t("skills.groups.members", { defaultValue: "分组成员" })}
                </Label>
                <div className="mt-2 flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="skill-group-search"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        rangeAnchorIdRef.current = null;
                      }}
                      className="pl-8"
                      placeholder={t("skills.searchPlaceholder")}
                    />
                  </div>
                  <Button
                    type="button"
                    variant={
                      memberFilter === "ungrouped" ? "secondary" : "outline"
                    }
                    className="w-32 shrink-0 justify-start px-3"
                    aria-pressed={memberFilter === "ungrouped"}
                    onClick={() => {
                      rangeAnchorIdRef.current = null;
                      setMemberFilter((current) =>
                        current === "all" ? "ungrouped" : "all",
                      );
                    }}
                  >
                    <ListFilter className="h-4 w-4" />
                    {memberFilter === "all"
                      ? t("common.all")
                      : t("skills.groups.ungrouped", {
                          defaultValue: "未分组",
                        })}
                  </Button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-3">
              {filteredSkills.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {t("skills.noResults")}
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/35 px-3 py-2">
                    <Checkbox
                      id="skill-group-toggle-visible"
                      checked={visibleSelectionState}
                      onCheckedChange={() =>
                        toggleVisibleSkills(visibleSelectionState !== true)
                      }
                    />
                    <Label
                      htmlFor="skill-group-toggle-visible"
                      className="cursor-pointer text-sm font-medium"
                    >
                      {visibleSelectionState === true
                        ? t("skills.groups.clearVisibleSelection", {
                            defaultValue: "取消全选当前结果",
                          })
                        : t("skills.groups.selectAllVisible", {
                            defaultValue: "全选当前结果",
                          })}
                    </Label>
                    <span className="ml-auto text-right text-xs text-muted-foreground">
                      {t("skills.groups.visibleSelectionSummary", {
                        defaultValue:
                          "当前结果已选 {{selected}} / {{visible}} 项",
                        selected: visibleSelectedCount,
                        visible: filteredSkills.length,
                      })}
                    </span>
                  </div>
                  <div className="divide-y">
                    {filteredSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="flex min-h-14 items-center gap-3 px-3 py-2"
                      >
                        <Checkbox
                          checked={selectedSkillSet.has(skill.id)}
                          aria-label={t("skills.groups.toggleMember", {
                            defaultValue: "选择 {{name}}",
                            name: skill.name,
                          })}
                          onClickCapture={(event) => {
                            shiftPressedRef.current = event.shiftKey;
                          }}
                          onCheckedChange={(checked) => {
                            const useRange = shiftPressedRef.current;
                            shiftPressedRef.current = false;
                            toggleSkill(skill.id, checked === true, useRange);
                          }}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => handleOpenFolder(skill.id)}
                        >
                          <span className="block truncate text-sm font-medium hover:underline">
                            {skill.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {skill.description ?? skill.directory}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleOpenFolder(skill.id)}
                          title={t("skills.openFolder", {
                            defaultValue: "打开 Skill 目录",
                          })}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </FullScreenPanel>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={t("skills.groups.discardTitle", {
          defaultValue: "放弃未保存的更改？",
        })}
        message={t("skills.groups.discardMessage", {
          defaultValue: "当前分组的修改尚未保存，继续操作将丢失这些修改。",
        })}
        confirmText={t("common.confirm")}
        variant="destructive"
        zIndex="top"
        onConfirm={discardAndContinue}
        onCancel={() => setPendingAction(null)}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={t("skills.groups.deleteTitle", { defaultValue: "删除分组" })}
        message={t("skills.groups.deleteMessage", {
          defaultValue: "只会删除分组，不会卸载其中的 Skills。",
        })}
        confirmText={t("common.delete")}
        variant="destructive"
        zIndex="top"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </>
  );
}
