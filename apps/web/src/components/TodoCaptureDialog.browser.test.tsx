import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
} from "@t3tools/shared/keybindings";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { GhosttyTerminalSurface } from "../terminal/ghostty/surface";

const state = vi.hoisted(() => ({
  keybindings: [] as ResolvedKeybindingsConfig,
  request: vi.fn(),
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => state.keybindings) as never,
}));
vi.mock(import("../state/server"), () => ({ primaryServerKeybindingsAtom: {} as never }));
vi.mock(import("../state/environments"), () => ({
  usePrimaryEnvironmentId: (() => "env") as never,
}));
vi.mock(import("../state/mation"), () => ({ mationEnvironment: { request: {} } as never }));
vi.mock(import("../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.request) as never,
}));

import { TodoCaptureDialog, forwardTodoKeydown } from "./TodoCaptureDialog";

it.each([
  { platform: "MacIntel", modifiers: { metaKey: true, altKey: true } },
  { platform: "Linux x86_64", modifiers: { ctrlKey: true, altKey: true } },
])(
  "opens todo capture before the terminal writes the shortcut on $platform",
  async ({ platform, modifiers }) => {
    state.keybindings = DEFAULT_RESOLVED_KEYBINDINGS;
    state.request.mockReset();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    await using screen = await render(
      <>
        <TodoCaptureDialog />
        <div
          data-thread-terminal-drawer=""
          data-testid="terminal"
          style={{ width: 400, height: 200 }}
        />
      </>,
    );
    await using stack = new AsyncDisposableStack();
    const writes = vi.fn();
    const terminal = await GhosttyTerminalSurface.create(
      screen.container.querySelector('[data-testid="terminal"]')!,
      {
        theme: {
          foreground: { r: 255, g: 255, b: 255 },
          background: { r: 0, g: 0, b: 0 },
          cursor: { r: 255, g: 255, b: 255 },
        },
        onData: writes,
        onResize() {},
        onSelectionChange() {},
        beforeKey: () => true,
        onLinkActivate() {},
        visible: true,
      },
    );
    stack.defer(() => terminal.dispose());
    terminal.input.focus();
    terminal.input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "l",
        code: "KeyL",
        ...modifiers,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(writes).not.toHaveBeenCalled();
  },
);

it("resolves embedded keys against remapped and disabled todo bindings", async () => {
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  state.keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+alt+k", command: "todo.capture" },
  ]);
  await using screen = await render(<TodoCaptureDialog />);
  await act(async () =>
    forwardTodoKeydown({ key: "l", code: "KeyL", metaKey: true, altKey: true }),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () =>
    forwardTodoKeydown({ key: "k", code: "KeyK", metaKey: true, altKey: true }),
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await screen.unmount();
  state.keybindings = [];
  await using _disabled = await render(<TodoCaptureDialog />);
  await act(async () => {
    forwardTodoKeydown({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    forwardTodoKeydown({ key: "l", code: "KeyL", metaKey: true, altKey: true });
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
