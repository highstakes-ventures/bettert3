import "../index.css";
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

import { TodoCaptureDialog, forwardTodoKeydown, requestTodoCapture } from "./TodoCaptureDialog";

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

it("retains an uncertain capture and retries its same submission before refreshing the count", async () => {
  state.keybindings = DEFAULT_RESOLVED_KEYBINDINGS;
  state.request
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ _tag: "Success", value: { status: 201, body: "{}" } });
  await using _screen = await render(<TodoCaptureDialog />);
  const changed = vi.fn();
  window.addEventListener("t3:todos-changed", changed);
  try {
    await act(async () => requestTodoCapture());
    const field = page.getByRole("textbox", { name: "What do you want to remember?" });
    await field.fill("Book dentist tomorrow");
    await page.getByRole("button", { name: "Add todo" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(field).toHaveValue("Book dentist tomorrow");
    expect(changed).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Retry save" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
    const bodies = state.request.mock.calls.map(([input]) => JSON.parse(input.input.request.body));
    expect(bodies[1]).toEqual(bodies[0]);
  } finally {
    window.removeEventListener("t3:todos-changed", changed);
  }
});
