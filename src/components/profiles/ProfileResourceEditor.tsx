import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderTree,
  Pencil,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import {
  getSkillGroupSelectionState,
  toggleSkillGroupSelection,
} from "@/components/profiles/skillGroupSelection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SkillGroup } from "@/lib/api/skills";
import { cn } from "@/lib/utils";

const UNGROUPED_SKILLS_SECTION_ID = "__ungrouped_skills__";

export interface SelectableProfileResource {
  id: string;
  name: string;
  description?: string;
}

interface ResourceSummaryCardProps {
  title: string;
  description: string;
  managed: boolean;
  selectedLabels: string[];
  selectedCount: number;
  missingIds: string[];
  onManagedChange: (managed: boolean) => void;
  onEdit: () => void;
}

export function ResourceSummaryCard({
  title,
  description,
  managed,
  selectedLabels,
  selectedCount,
  missingIds,
  onManagedChange,
  onEdit,
}: ResourceSummaryCardProps) {
  const { t } = useTranslation();
  const visibleLabels = selectedLabels.slice(0, 5);
  const hiddenCount = Math.max(0, selectedLabels.length - visibleLabels.length);

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("configSets.manageSection", { defaultValue: "由方案管理" })}
          </span>
          <Switch checked={managed} onCheckedChange={onManagedChange} />
        </label>
      </div>

      <div className="mt-4 flex min-h-10 items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
        <div className="min-w-0 flex-1">
          {!managed ? (
            <span className="text-sm text-muted-foreground">
              {t("configSets.unmanaged", { defaultValue: "未管理" })}
            </span>
          ) : selectedCount === 0 && missingIds.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              {t("configSets.noneSelected", { defaultValue: "未选择任何资源" })}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {visibleLabels.map((label) => (
                <Badge key={label} variant="secondary" className="max-w-48">
                  <span className="truncate">{label}</span>
                </Badge>
              ))}
              {hiddenCount > 0 && (
                <Badge variant="outline">+{hiddenCount}</Badge>
              )}
              {missingIds.map((id) => (
                <Badge key={id} variant="destructive" className="max-w-56">
                  <span className="truncate">
                    {t("configSets.missingRef", {
                      defaultValue: "缺失: {{id}}",
                      id,
                    })}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Settings2 className="mr-2 h-4 w-4" />
          {t("configSets.editSelection", { defaultValue: "选择与编辑" })}
        </Button>
      </div>
    </section>
  );
}

interface MultiResourceSelectionPanelProps {
  isOpen: boolean;
  kind: "mcp" | "skills";
  title: string;
  value: string[] | null;
  defaultIds: string[];
  items: SelectableProfileResource[];
  skillGroups?: SkillGroup[];
  onSave: (value: string[] | null) => void;
  onClose: () => void;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onOpenFolder?: (id: string) => void;
  onManageGroups?: () => void;
}

export function MultiResourceSelectionPanel({
  isOpen,
  kind,
  title,
  value,
  defaultIds,
  items,
  skillGroups = [],
  onSave,
  onClose,
  onCreate,
  onEdit,
  onOpenFolder,
  onManageGroups,
}: MultiResourceSelectionPanelProps) {
  const { t } = useTranslation();
  const [managed, setManaged] = useState(Array.isArray(value));
  const [selectedIds, setSelectedIds] = useState<string[]>(
    Array.isArray(value) ? value : defaultIds,
  );
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [discardOpen, setDiscardOpen] = useState(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setManaged(Array.isArray(value));
    setSelectedIds(Array.isArray(value) ? value : defaultIds);
    setSearch("");
    setExpandedGroups(new Set());
    setDiscardOpen(false);
  }, [defaultIds, isOpen, value]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const missingIds = selectedIds.filter((id) => !itemMap.has(id));
  const query = search.trim().toLocaleLowerCase();
  const matchesSearch = (item: SelectableProfileResource) =>
    !query ||
    `${item.name} ${item.description ?? ""} ${item.id}`
      .toLocaleLowerCase()
      .includes(query);
  const isDirty =
    managed !== Array.isArray(value) ||
    (managed && JSON.stringify(selectedIds) !== JSON.stringify(value ?? []));

  /** 切换 Skills 区块的手动展开状态；搜索期间由结果自动展开。 */
  const toggleGroup = (groupId: string) => {
    if (query) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleItem = (id: string, enabled: boolean) => {
    setSelectedIds((current) =>
      enabled
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((itemId) => itemId !== id),
    );
  };

  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  };

  const renderItem = (item: SelectableProfileResource) => (
    <div key={item.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
      <Checkbox
        checked={managed && selectedSet.has(item.id)}
        disabled={!managed}
        onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          if (kind === "skills") {
            onOpenFolder?.(item.id);
          } else if (managed) {
            toggleItem(item.id, !selectedSet.has(item.id));
          }
        }}
      >
        <span className="block truncate text-sm font-medium">{item.name}</span>
        {item.description && (
          <span className="block truncate text-xs text-muted-foreground">
            {item.description}
          </span>
        )}
      </button>
      {kind === "skills" && onOpenFolder && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onOpenFolder(item.id)}
          title={t("skills.openFolder", { defaultValue: "打开 Skill 目录" })}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      )}
      {kind === "mcp" && onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onEdit(item.id)}
          title={t("common.edit")}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  const renderSkillSection = (group: SkillGroup) => {
    const memberIds = group.skillIds.filter((id) => itemMap.has(id));
    const visibleItems = memberIds
      .map((id) => itemMap.get(id))
      .filter((item): item is SelectableProfileResource =>
        Boolean(item && matchesSearch(item)),
      );
    if (query && visibleItems.length === 0) return null;
    const expanded = Boolean(query) || expandedGroups.has(group.id);
    const groupState = managed
      ? getSkillGroupSelectionState(selectedIds, memberIds)
      : false;

    return (
      <section key={group.id} className="overflow-hidden rounded-md border">
        <div className="flex min-h-11 items-center gap-2 bg-muted/35 px-3">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded hover:bg-muted"
            onClick={() => toggleGroup(group.id)}
            disabled={Boolean(query)}
            aria-expanded={expanded}
            title={
              expanded
                ? t("configSets.collapseGroup", { defaultValue: "折叠分组" })
                : t("configSets.expandGroup", { defaultValue: "展开分组" })
            }
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <Checkbox
            checked={groupState}
            disabled={!managed || memberIds.length === 0}
            onCheckedChange={(checked) =>
              setSelectedIds((current) =>
                toggleSkillGroupSelection(current, memberIds, checked === true),
              )
            }
          />
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {group.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {memberIds.length}
          </span>
        </div>
        {expanded && (
          <div className="divide-y">{visibleItems.map(renderItem)}</div>
        )}
      </section>
    );
  };

  const groupedIds = new Set(skillGroups.flatMap((group) => group.skillIds));
  const ungroupedItems = items.filter(
    (item) => !groupedIds.has(item.id) && matchesSearch(item),
  );
  const filteredMcpItems = items.filter(matchesSearch);
  const ungroupedExpanded =
    Boolean(query) || expandedGroups.has(UNGROUPED_SKILLS_SECTION_ID);

  return (
    <>
      <FullScreenPanel
        isOpen={isOpen}
        title={title}
        onClose={requestClose}
        contentClassName="py-4"
        footer={
          <Button
            type="button"
            onClick={() => onSave(managed ? selectedIds : null)}
          >
            {t("configSets.saveAndReturn", { defaultValue: "保存并返回" })}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b pb-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={managed} onCheckedChange={setManaged} />
            {t("configSets.manageSection", { defaultValue: "由方案管理" })}
          </label>
          <span className="text-sm text-muted-foreground">
            {t("configSets.selectedCount", {
              defaultValue: "已选 {{count}} 项",
              count: managed ? selectedIds.length : 0,
            })}
          </span>
          <div className="relative ml-auto min-w-56 flex-1 md:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
              placeholder={t("configSets.resourceSearch", {
                defaultValue: "搜索资源",
              })}
            />
          </div>
          {kind === "skills" && onManageGroups && (
            <Button type="button" variant="outline" onClick={onManageGroups}>
              <FolderTree className="mr-2 h-4 w-4" />
              {t("skills.groups.manage", { defaultValue: "管理分组" })}
            </Button>
          )}
          {onCreate && (
            <Button type="button" variant="outline" onClick={onCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t("common.add")}
            </Button>
          )}
        </div>

        {missingIds.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium text-destructive">
              {t("configSets.missingResources", {
                defaultValue: "缺失资源",
              })}
            </h3>
            <div className="divide-y rounded-md border border-destructive/40">
              {missingIds.map((id) => (
                <div key={id} className="flex min-h-11 items-center gap-3 px-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {id}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => toggleItem(id, false)}
                    title={t("configSets.removeMissing", {
                      defaultValue: "从方案中移除",
                    })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className={cn("space-y-3", !managed && "opacity-65")}>
          {kind === "skills" ? (
            <>
              {skillGroups.map(renderSkillSection)}
              {(ungroupedItems.length > 0 || skillGroups.length === 0) && (
                <section className="overflow-hidden rounded-md border">
                  <div className="flex min-h-11 items-center gap-2 bg-muted/35 px-3">
                    <button
                      type="button"
                      className="grid h-7 w-7 place-items-center rounded hover:bg-muted"
                      onClick={() => toggleGroup(UNGROUPED_SKILLS_SECTION_ID)}
                      disabled={Boolean(query)}
                      aria-expanded={ungroupedExpanded}
                      title={
                        ungroupedExpanded
                          ? t("configSets.collapseGroup", {
                              defaultValue: "折叠分组",
                            })
                          : t("configSets.expandGroup", {
                              defaultValue: "展开分组",
                            })
                      }
                    >
                      {ungroupedExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <FolderTree className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium">
                      {skillGroups.length === 0
                        ? t("skills.groups.all", {
                            defaultValue: "全部 Skills",
                          })
                        : t("skills.groups.ungrouped", {
                            defaultValue: "未分组",
                          })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ungroupedItems.length}
                    </span>
                  </div>
                  {ungroupedExpanded && (
                    <div className="divide-y">
                      {ungroupedItems.map(renderItem)}
                    </div>
                  )}
                </section>
              )}
            </>
          ) : filteredMcpItems.length === 0 ? (
            <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              {t("configSets.noResources", { defaultValue: "暂无可选资源" })}
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {filteredMcpItems.map(renderItem)}
            </div>
          )}
        </div>
      </FullScreenPanel>

      <ConfirmDialog
        isOpen={discardOpen}
        title={t("configSets.discardResourceTitle", {
          defaultValue: "放弃资源选择更改？",
        })}
        message={t("configSets.discardResourceMessage", {
          defaultValue: "尚未保存到当前配置方案，返回后这些选择将丢失。",
        })}
        confirmText={t("common.confirm")}
        variant="destructive"
        zIndex="top"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}

interface PromptSelectionPanelProps {
  isOpen: boolean;
  title: string;
  value: string | null;
  defaultId: string | null;
  items: SelectableProfileResource[];
  onSave: (value: string | null) => void;
  onClose: () => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
}

export function PromptSelectionPanel({
  isOpen,
  title,
  value,
  defaultId,
  items,
  onSave,
  onClose,
  onCreate,
  onEdit,
}: PromptSelectionPanelProps) {
  const { t } = useTranslation();
  const [managed, setManaged] = useState(value !== null);
  const [selectedId, setSelectedId] = useState<string | null>(
    value ?? defaultId,
  );
  const [search, setSearch] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setManaged(value !== null);
    setSelectedId(value ?? defaultId);
    setSearch("");
    setDiscardOpen(false);
  }, [defaultId, isOpen, value]);

  const query = search.trim().toLocaleLowerCase();
  const filteredItems = items.filter((item) =>
    `${item.name} ${item.description ?? ""} ${item.id}`
      .toLocaleLowerCase()
      .includes(query),
  );
  const selectedMissing = Boolean(
    selectedId && !items.some((item) => item.id === selectedId),
  );
  const isDirty =
    managed !== (value !== null) || (managed && selectedId !== value);

  const requestClose = () => {
    if (isDirty) setDiscardOpen(true);
    else onClose();
  };

  return (
    <>
      <FullScreenPanel
        isOpen={isOpen}
        title={title}
        onClose={requestClose}
        contentClassName="py-4"
        footer={
          <Button
            type="button"
            onClick={() => onSave(managed ? selectedId : null)}
            disabled={managed && !selectedId}
          >
            {t("configSets.saveAndReturn", { defaultValue: "保存并返回" })}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b pb-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={managed} onCheckedChange={setManaged} />
            {t("configSets.manageSection", { defaultValue: "由方案管理" })}
          </label>
          <div className="relative ml-auto min-w-56 flex-1 md:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
              placeholder={t("configSets.resourceSearch", {
                defaultValue: "搜索资源",
              })}
            />
          </div>
          <Button type="button" variant="outline" onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("common.add")}
          </Button>
        </div>

        {selectedMissing && selectedId && (
          <div className="flex min-h-11 items-center gap-3 rounded-md border border-destructive/40 px-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {t("configSets.missingRef", {
                defaultValue: "缺失: {{id}}",
                id: selectedId,
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSelectedId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {filteredItems.length === 0 ? (
          <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
            {t("configSets.noResources", { defaultValue: "暂无可选资源" })}
          </div>
        ) : (
          <div
            className={cn(
              "divide-y rounded-md border",
              !managed && "opacity-65",
            )}
          >
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="flex min-h-14 items-center gap-3 px-3 py-2"
              >
                <Checkbox
                  checked={managed && selectedId === item.id}
                  disabled={!managed}
                  onCheckedChange={(checked) =>
                    setSelectedId(checked === true ? item.id : null)
                  }
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => managed && setSelectedId(item.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  {item.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(item.id)}
                  title={t("common.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </FullScreenPanel>

      <ConfirmDialog
        isOpen={discardOpen}
        title={t("configSets.discardResourceTitle", {
          defaultValue: "放弃资源选择更改？",
        })}
        message={t("configSets.discardResourceMessage", {
          defaultValue: "尚未保存到当前配置方案，返回后这些选择将丢失。",
        })}
        confirmText={t("common.confirm")}
        variant="destructive"
        zIndex="top"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
