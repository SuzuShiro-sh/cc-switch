import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FullScreenPanel } from "@/components/common/FullScreenPanel";

describe("FullScreenPanel body scroll locking", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("keeps scrolling locked until every stacked panel closes", () => {
    document.body.style.overflow = "auto";
    const view = render(
      <>
        <FullScreenPanel isOpen title="Parent" onClose={() => {}}>
          Parent
        </FullScreenPanel>
        <FullScreenPanel isOpen title="Child" onClose={() => {}}>
          Child
        </FullScreenPanel>
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <>
        <FullScreenPanel isOpen title="Parent" onClose={() => {}}>
          Parent
        </FullScreenPanel>
        <FullScreenPanel isOpen={false} title="Child" onClose={() => {}}>
          Child
        </FullScreenPanel>
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <>
        <FullScreenPanel isOpen={false} title="Parent" onClose={() => {}}>
          Parent
        </FullScreenPanel>
        <FullScreenPanel isOpen={false} title="Child" onClose={() => {}}>
          Child
        </FullScreenPanel>
      </>,
    );
    expect(document.body.style.overflow).toBe("auto");
  });

  it("lets only the topmost stacked panel handle Escape", () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    render(
      <>
        <FullScreenPanel isOpen title="Parent" onClose={closeParent}>
          Parent
        </FullScreenPanel>
        <FullScreenPanel isOpen title="Child" onClose={closeChild}>
          Child
        </FullScreenPanel>
      </>,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
  });
});
