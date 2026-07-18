export type SkillGroupSelectionState = boolean | "indeterminate";

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function getSkillGroupSelectionState(
  selectedIds: Iterable<string>,
  groupSkillIds: string[],
): SkillGroupSelectionState {
  const members = uniqueIds(groupSkillIds);
  if (members.length === 0) return false;

  const selected = new Set(selectedIds);
  const selectedCount = members.filter((id) => selected.has(id)).length;
  if (selectedCount === 0) return false;
  if (selectedCount === members.length) return true;
  return "indeterminate";
}

export function toggleSkillGroupSelection(
  selectedIds: string[],
  groupSkillIds: string[],
  enabled: boolean,
): string[] {
  const members = uniqueIds(groupSkillIds);
  const memberSet = new Set(members);
  const selected = uniqueIds(selectedIds);

  if (!enabled) {
    return selected.filter((id) => !memberSet.has(id));
  }

  const next = [...selected];
  const nextSet = new Set(next);
  for (const id of members) {
    if (!nextSet.has(id)) {
      next.push(id);
      nextSet.add(id);
    }
  }
  return next;
}
