import { describe, expect, it } from "vitest";

import {
  getSkillGroupSelectionState,
  toggleSkillGroupSelection,
} from "@/components/profiles/skillGroupSelection";

describe("skill group selection", () => {
  it("reports unchecked, mixed and checked group state", () => {
    expect(getSkillGroupSelectionState([], ["a", "b"])).toBe(false);
    expect(getSkillGroupSelectionState(["a"], ["a", "b"])).toBe(
      "indeterminate",
    );
    expect(getSkillGroupSelectionState(["a", "b"], ["a", "b"])).toBe(true);
    expect(getSkillGroupSelectionState(["a"], [])).toBe(false);
  });

  it("batch toggles members without changing unrelated selections", () => {
    expect(
      toggleSkillGroupSelection(["outside", "a"], ["a", "b"], true),
    ).toEqual(["outside", "a", "b"]);
    expect(
      toggleSkillGroupSelection(["outside", "a", "b"], ["a", "b"], false),
    ).toEqual(["outside"]);
  });

  it("keeps individual overrides after a group batch action", () => {
    const enabled = toggleSkillGroupSelection([], ["a", "b"], true);
    const individuallyDisabled = enabled.filter((id) => id !== "b");
    expect(getSkillGroupSelectionState(individuallyDisabled, ["a", "b"])).toBe(
      "indeterminate",
    );
  });
});
