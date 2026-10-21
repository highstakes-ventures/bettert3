import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSidebarShelves } from "./Sidebar.shelves";

const STORAGE_KEY = "t3code:sidebar:expanded-shelf";
let renderer: ReactTestRenderer | undefined;
let shelves: ReturnType<typeof useSidebarShelves>;
let storage: Map<string, string>;

function Probe({ isMobile }: { isMobile: boolean }) {
  const state = useSidebarShelves(isMobile);
  useLayoutEffect(() => {
    shelves = state;
  });
  return null;
}

function mount(isMobile = false) {
  act(() => {
    renderer = create(createElement(Probe, { isMobile }));
  });
}

function leave(buttons = 0) {
  act(() => shelves.onMouseLeave({ buttons }));
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    }),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("sidebar shelf navigation", () => {
  it.each(["working", "timer", "snoozed", "settled", "automatic"] as const)(
    "collapses %s after opening a chat and leaving, but not before",
    (shelf) => {
      mount();
      act(() => shelves.toggleShelf(shelf));
      leave();
      expect(shelves.expandedShelf).toBe(shelf);

      act(() => shelves.onThreadOpen());
      expect(shelves.expandedShelf).toBe(shelf);
      leave();
      expect(shelves.expandedShelf).toBeNull();
      expect(storage.has(STORAGE_KEY)).toBe(false);

      act(() => shelves.toggleShelf(shelf));
      leave();
      expect(shelves.expandedShelf).toBe(shelf);
    },
  );

  it("keeps a group open when the user explicitly toggles it after navigation", () => {
    mount();
    act(() => shelves.toggleShelf("working"));
    act(() => shelves.onThreadOpen());
    act(() => shelves.toggleShelf("settled"));
    leave();
    expect(shelves.expandedShelf).toBe("settled");
    expect(JSON.parse(storage.get(STORAGE_KEY)!)).toBe("settled");

    act(() => shelves.onThreadOpen());
    act(() => shelves.toggleShelf("settled"));
    act(() => shelves.toggleShelf("settled"));
    leave();
    expect(shelves.expandedShelf).toBe("settled");
  });

  it("preserves persisted expansion until a chat is selected", () => {
    storage.set(STORAGE_KEY, JSON.stringify("working"));
    mount();
    leave();
    expect(shelves.expandedShelf).toBe("working");
    act(() => shelves.onThreadOpen());
    leave();
    expect(shelves.expandedShelf).toBeNull();
  });

  it("does not collapse during a pointer drag", () => {
    mount();
    act(() => shelves.toggleShelf("working"));
    act(() => shelves.onThreadOpen());
    leave(1);
    expect(shelves.expandedShelf).toBe("working");
    leave();
    expect(shelves.expandedShelf).toBeNull();
  });

  it("keeps mobile expansion independent of pointer leave", () => {
    mount(true);
    act(() => shelves.toggleShelf("working"));
    act(() => shelves.onThreadOpen());
    leave();
    expect(shelves.expandedShelf).toBe("working");
  });

  it("does not carry a previous navigation into a newly expanded group", () => {
    mount();
    act(() => shelves.onThreadOpen());
    act(() => shelves.toggleShelf("timer"));
    leave();
    expect(shelves.expandedShelf).toBe("timer");
  });
});
