// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SnoozeMenu } from "./SnoozeMenu";
import { resolveSnoozePresets } from "./Sidebar.snooze";

let root: Root;
let container: HTMLDivElement;
let composer: HTMLInputElement;
const snooze = vi.fn();
const threadJump = vi.fn();

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <SnoozeMenu open={open} onOpenChange={setOpen} onSnooze={snooze} timestampFormat="locale" />
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 8, 10));
  container = document.createElement("div");
  document.body.append(container);
  composer = document.createElement("input");
  document.body.append(composer);
  composer.focus();
  root = createRoot(container);
  snooze.mockClear();
  threadJump.mockClear();
  window.addEventListener("keydown", threadJump);
});

afterEach(async () => {
  await act(() => root.unmount());
  window.removeEventListener("keydown", threadJump);
  container.remove();
  composer.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.querySelector("[data-snooze-menu]") ? document.activeElement! : container;
  const event = new KeyboardEvent("keydown", {
    key,
    code: `Digit${key}`,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("snooze menu keyboard choices", () => {
  it.each([1, 2, 3])(
    "Cmd+%s snoozes for that visible duration and consumes the thread jump",
    async (number) => {
      const expected = resolveSnoozePresets(new Date(), "locale")[number - 1]!;
      await act(() => root.render(<Harness />));
      await vi.waitFor(() =>
        expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
          true,
        ),
      );
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      );
      const event = await press(String(number), { metaKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(snooze).toHaveBeenCalledExactlyOnceWith(expected);
      expect(threadJump).not.toHaveBeenCalled();
      expect(document.querySelector("[data-snooze-menu]")).toBeNull();
    },
  );

  it("chooses tomorrow with Cmd+3 when evening is absent", async () => {
    vi.setSystemTime(new Date(2026, 3, 8, 21));
    await act(() => root.render(<Harness />));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      ),
    );
    await press("3", { metaKey: true });
    expect(snooze).toHaveBeenCalledOnce();
    expect(snooze.mock.calls[0]![0].snoozedUntil).toBe(new Date(2026, 3, 9, 9).toISOString());
  });

  it("uses Ctrl for numbered choices on Windows", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    await act(() => root.render(<Harness />));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      ),
    );
    await press("2", { ctrlKey: true });
    expect(snooze).toHaveBeenCalledOnce();
  });

  it("leaves plain numbers and unrelated modifier combinations alone", async () => {
    await act(() => root.render(<Harness />));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      ),
    );
    for (const init of [
      {},
      { metaKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
      { metaKey: true, ctrlKey: true },
    ]) {
      await press("1", init);
    }
    await press("9", { metaKey: true });
    expect(snooze).not.toHaveBeenCalled();
    expect(document.querySelector("[data-snooze-menu]")).not.toBeNull();
  });

  it("ignores repeats and cancels with Escape without snoozing", async () => {
    await act(() => root.render(<Harness />));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      ),
    );
    await press("1", { metaKey: true, repeat: true });
    expect(snooze).not.toHaveBeenCalled();
    await press("Escape");
    expect(snooze).not.toHaveBeenCalled();
    expect(document.querySelector("[data-snooze-menu]")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it("does not capture numbers when the menu is closed", async () => {
    await act(() => root.render(<Harness initiallyOpen={false} />));
    await press("1", { metaKey: true });
    expect(snooze).not.toHaveBeenCalled();
    expect(threadJump).toHaveBeenCalledOnce();
  });
});
