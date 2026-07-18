import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MultiResourceSelectionPanel } from "@/components/profiles/ProfileResourceEditor";

describe("MultiResourceSelectionPanel", () => {
  it("collapses Skill groups by default and supports group plus individual selection", () => {
    const onSave = vi.fn();
    render(
      <MultiResourceSelectionPanel
        isOpen
        kind="skills"
        title="Skills"
        value={[]}
        defaultIds={[]}
        items={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
        skillGroups={[
          {
            id: "research",
            name: "Research",
            skillIds: ["a", "b"],
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    const expandButton = screen.getByTitle(
      /展开分组|Expand group|configSets\.expandGroup/,
    );
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expandButton);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(
      screen.getByTitle(/折叠分组|Collapse group|configSets\.collapseGroup/),
    ).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(
      screen.getByRole("button", {
        name: /保存并返回|Save and return|configSets\.saveAndReturn/,
      }),
    );

    expect(onSave).toHaveBeenCalledWith(["a"]);
  });

  it("collapses ungrouped Skills by default and temporarily expands search results", () => {
    render(
      <MultiResourceSelectionPanel
        isOpen
        kind="skills"
        title="Skills"
        value={[]}
        defaultIds={[]}
        items={[{ id: "a", name: "Alpha" }]}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    const searchInput = screen.getByPlaceholderText(
      /搜索资源|Search resources|configSets\.resourceSearch/,
    );
    fireEvent.change(searchInput, { target: { value: "Alpha" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("keeps explicit Skill ids when group definitions change", () => {
    const onSave = vi.fn();
    const view = render(
      <MultiResourceSelectionPanel
        isOpen
        kind="skills"
        title="Skills"
        value={["a"]}
        defaultIds={[]}
        items={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
        skillGroups={[
          {
            id: "group",
            name: "Group",
            skillIds: ["a"],
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );

    view.rerender(
      <MultiResourceSelectionPanel
        isOpen
        kind="skills"
        title="Skills"
        value={["a"]}
        defaultIds={[]}
        items={[
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ]}
        skillGroups={[
          {
            id: "group",
            name: "Group",
            skillIds: ["b"],
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /保存并返回|Save and return|configSets\.saveAndReturn/,
      }),
    );
    expect(onSave).toHaveBeenCalledWith(["a"]);
  });
});
