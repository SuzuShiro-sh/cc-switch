import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillGroupManager } from "@/components/skills/SkillGroupManager";

vi.mock("@/hooks/useSkills", () => ({
  useSkillGroups: () => ({
    data: [
      {
        id: "research",
        name: "Research",
        skillIds: ["grouped"],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    isLoading: false,
  }),
  useCreateSkillGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSkillGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkillGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: { openFolder: vi.fn() },
}));

const apps = {
  claude: false,
  codex: false,
  gemini: false,
  opencode: false,
  openclaw: false,
  hermes: false,
};

const skills = [
  {
    id: "grouped",
    name: "Research Skill",
    directory: "research-skill",
    apps,
    installedAt: 1,
    updatedAt: 1,
  },
  {
    id: "alpha",
    name: "Alpha Skill",
    directory: "alpha-skill",
    apps,
    installedAt: 1,
    updatedAt: 1,
  },
  {
    id: "beta",
    name: "Beta Skill",
    directory: "beta-skill",
    apps,
    installedAt: 1,
    updatedAt: 1,
  },
  {
    id: "gamma",
    name: "Gamma Skill",
    directory: "gamma-skill",
    apps,
    installedAt: 1,
    updatedAt: 1,
  },
];

const renderManager = () =>
  render(<SkillGroupManager isOpen onClose={() => {}} skills={skills} />);

describe("SkillGroupManager", () => {
  it("defaults new groups to ungrouped Skills and toggles back to all", () => {
    renderManager();

    expect(screen.getByText("Research Skill")).toBeInTheDocument();
    expect(screen.getByText("Alpha Skill")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /新建分组|Create group|新規グループ|新增分組|skills\.groups\.create/,
      }),
    );

    expect(screen.queryByText("Research Skill")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha Skill")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /^(未分组|Ungrouped|未分類|未分組|skills\.groups\.ungrouped)$/,
      }),
    );

    expect(screen.getByText("Research Skill")).toBeInTheDocument();
    expect(screen.getByText("Alpha Skill")).toBeInTheDocument();
  });

  it("selects and deselects only the current visible results", () => {
    renderManager();

    const searchInput = screen.getByLabelText(
      /分组成员|Group members|グループメンバー|分組成員|skills\.groups\.members/,
    );
    fireEvent.change(searchInput, { target: { value: "Alpha" } });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /全选当前结果|Select all visible|表示中をすべて選択|全選目前結果|skills\.groups\.selectAllVisible/,
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /取消全选当前结果|Deselect all visible|表示中の選択をすべて解除|取消全選目前結果|skills\.groups\.clearVisibleSelection/,
      }),
    );

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(
      screen.getByRole("checkbox", { name: /Research Skill/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Alpha Skill/ }),
    ).not.toBeChecked();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /全选当前结果|Select all visible|表示中をすべて選択|全選目前結果|skills\.groups\.selectAllVisible/,
      }),
    );
    for (const skill of skills) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(skill.name) }),
      ).toBeChecked();
    }

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /取消全选当前结果|Deselect all visible|表示中の選択をすべて解除|取消全選目前結果|skills\.groups\.clearVisibleSelection/,
      }),
    );
    for (const skill of skills) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(skill.name) }),
      ).not.toBeChecked();
    }
  });

  it("supports Shift-click range selection within the visible list", () => {
    renderManager();

    fireEvent.click(screen.getByRole("checkbox", { name: /Alpha Skill/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Gamma Skill/ }), {
      shiftKey: true,
    });

    for (const name of ["Alpha Skill", "Beta Skill", "Gamma Skill"]) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(name) }),
      ).toBeChecked();
    }

    fireEvent.click(screen.getByRole("checkbox", { name: /Gamma Skill/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Alpha Skill/ }), {
      shiftKey: true,
    });

    for (const name of ["Alpha Skill", "Beta Skill", "Gamma Skill"]) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(name) }),
      ).not.toBeChecked();
    }
    expect(
      screen.getByRole("checkbox", { name: /Research Skill/ }),
    ).toBeChecked();
  });
});
