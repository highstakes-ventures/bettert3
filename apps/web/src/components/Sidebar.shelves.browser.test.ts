import { act, render } from "../../test/render";
import { createElement, useLayoutEffect } from "react";
import { describe, expect, it } from "vite-plus/test";
import { useSidebarShelves } from "./Sidebar.shelves";

const STORAGE_KEY = "t3code:sidebar:expanded-shelf";
function Probe({
  isMobile,
  capture,
}: {
  isMobile: boolean;
  capture: (value: ReturnType<typeof useSidebarShelves>) => void;
}) {
  const shelves = useSidebarShelves(isMobile);
  useLayoutEffect(() => capture(shelves));
  return null;
}
describe("sidebar shelf navigation", () => {
  it.each(["working", "timer", "snoozed", "settled", "automatic"] as const)(
    "collapses %s after opening a chat and leaving, but not before",
    async (shelf) => {
      using context = setup();

      await using _screen = await render(
        createElement(Probe, {
          isMobile: false,
          capture: (value) => {
            context.shelves = value;
          },
        }),
      );
      await act(() => context.shelves.toggleShelf(shelf));
      await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
      expect(context.shelves.expandedShelf).toBe(shelf);

      await act(() => context.shelves.onThreadOpen());
      expect(context.shelves.expandedShelf).toBe(shelf);
      await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
      expect(context.shelves.expandedShelf).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY) !== null).toBe(false);

      await act(() => context.shelves.toggleShelf(shelf));
      await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
      expect(context.shelves.expandedShelf).toBe(shelf);
    },
  );

  it("keeps a group open when the user explicitly toggles it after navigation", async () => {
    using context = setup();

    await using _screen = await render(
      createElement(Probe, {
        isMobile: false,
        capture: (value) => {
          context.shelves = value;
        },
      }),
    );
    await act(() => context.shelves.toggleShelf("working"));
    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.toggleShelf("settled"));
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBe("settled");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toBe("settled");

    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.toggleShelf("settled"));
    await act(() => context.shelves.toggleShelf("settled"));
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBe("settled");
  });

  it("preserves persisted expansion until a chat is selected", async () => {
    using context = setup();

    localStorage.setItem(STORAGE_KEY, JSON.stringify("working"));
    await using _screen = await render(
      createElement(Probe, {
        isMobile: false,
        capture: (value) => {
          context.shelves = value;
        },
      }),
    );
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBe("working");
    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBeNull();
  });

  it("does not collapse during a pointer drag", async () => {
    using context = setup();

    await using _screen = await render(
      createElement(Probe, {
        isMobile: false,
        capture: (value) => {
          context.shelves = value;
        },
      }),
    );
    await act(() => context.shelves.toggleShelf("working"));
    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.onMouseLeave({ buttons: 1 }));
    expect(context.shelves.expandedShelf).toBe("working");
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBeNull();
  });

  it("keeps mobile expansion independent of pointer leave", async () => {
    using context = setup();

    await using _screen = await render(
      createElement(Probe, {
        isMobile: true,
        capture: (value) => {
          context.shelves = value;
        },
      }),
    );
    await act(() => context.shelves.toggleShelf("working"));
    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBe("working");
  });

  it("does not carry a previous navigation into a newly expanded group", async () => {
    using context = setup();

    await using _screen = await render(
      createElement(Probe, {
        isMobile: false,
        capture: (value) => {
          context.shelves = value;
        },
      }),
    );
    await act(() => context.shelves.onThreadOpen());
    await act(() => context.shelves.toggleShelf("timer"));
    await act(() => context.shelves.onMouseLeave({ buttons: 0 }));
    expect(context.shelves.expandedShelf).toBe("timer");
  });
});

function setup() {
  const previous = localStorage.getItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  return {
    shelves: undefined as unknown as ReturnType<typeof useSidebarShelves>,
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previous);
    },
  };
}
