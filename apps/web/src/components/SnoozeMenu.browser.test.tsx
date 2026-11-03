import { act, render } from "../../test/render";
import { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SnoozeMenu } from "./SnoozeMenu";
import { resolveSnoozePresets } from "./Sidebar.snooze";

const snooze = vi.fn();
const threadJump = vi.fn();

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <SnoozeMenu
      environmentId={EnvironmentId.make("test")}
      open={open}
      onOpenChange={setOpen}
      onSnooze={snooze}
      timestampFormat="locale"
    />
  );
}

async function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.querySelector("[data-snooze-menu]")
    ? document.activeElement!
    : document.body;
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
      using _context = setup();

      const expected = resolveSnoozePresets(
        new Date(2026, 3, 8, 10),
        "locale",
        EnvironmentId.make("test"),
      )[number - 1]!;
      await using _screen = await render(<Harness />, { router: false });
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
    using _context = setup();

    vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 3, 8, 21).getTime());
    await using _screen = await render(<Harness />, { router: false });
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
    using _context = setup();

    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    await using _screen = await render(<Harness />, { router: false });
    await vi.waitFor(() =>
      expect(document.querySelector("[data-snooze-menu]")!.contains(document.activeElement)).toBe(
        true,
      ),
    );
    await press("2", { ctrlKey: true });
    expect(snooze).toHaveBeenCalledOnce();
  });

  it("leaves plain numbers and unrelated modifier combinations alone", async () => {
    using _context = setup();

    await using _screen = await render(<Harness />, { router: false });
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
    using context = setup();

    await using _screen = await render(<Harness />, { router: false });
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
    await vi.waitFor(() => expect(document.activeElement).toBe(context.composer));
  });

  it("refreshes the displayed and selected wake time when an idle menu opens again", async () => {
    using _context = setup();
    const clock = vi.mocked(Date.now);
    const onOpenChange = vi.fn();
    const menu = (open: boolean) => (
      <SnoozeMenu
        environmentId={EnvironmentId.make("test")}
        open={open}
        onOpenChange={onOpenChange}
        onSnooze={snooze}
        timestampFormat="24-hour"
      />
    );
    // This menu has no routing behavior.
    await using screen = await render(menu(false), { router: false });

    clock.mockReturnValue(new Date(2026, 3, 8, 14, 12).getTime());
    await screen.rerender(menu(true));
    await vi.waitFor(() => {
      const popup = document.querySelector("[data-snooze-menu]");
      expect(popup?.textContent).toContain("15:12");
      expect(popup?.contains(document.activeElement)).toBe(true);
    });
    await press("1", { metaKey: true });
    expect(snooze.mock.calls[0]![0].snoozedUntil).toBe(new Date(2026, 3, 8, 15, 12).toISOString());

    await screen.rerender(menu(false));
    clock.mockReturnValue(new Date(2026, 3, 8, 20, 30).getTime());
    await screen.rerender(menu(true));
    await vi.waitFor(() => {
      const popup = document.querySelector("[data-snooze-menu]");
      expect(popup?.textContent).toContain("21:30");
      expect(popup?.contains(document.activeElement)).toBe(true);
    });
    await press("1", { metaKey: true });
    expect(snooze).toHaveBeenCalledTimes(2);
    expect(snooze.mock.calls[1]![0].snoozedUntil).toBe(new Date(2026, 3, 8, 21, 30).toISOString());
  });

  it("does not capture numbers when the menu is closed", async () => {
    using _context = setup();

    await using _screen = await render(<Harness initiallyOpen={false} />, { router: false });
    await press("1", { metaKey: true });
    expect(snooze).not.toHaveBeenCalled();
    expect(threadJump).toHaveBeenCalledOnce();
  });
});

function setup() {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 3, 8, 10).getTime());
  const composer = document.createElement("input");
  document.body.append(composer);
  composer.focus();
  snooze.mockClear();
  threadJump.mockClear();
  window.addEventListener("keydown", threadJump);

  return {
    composer,
    [Symbol.dispose]() {
      window.removeEventListener("keydown", threadJump);
      composer.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
