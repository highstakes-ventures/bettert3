import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => DEFAULT_RESOLVED_KEYBINDINGS) as never,
}));
vi.mock(import("../../state/server"), () => ({ primaryServerKeybindingsAtom: {} as never }));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironmentId: (() => "env") as never,
}));
vi.mock(import("../../state/mation"), () => ({ mationEnvironment: { request: {} } as never }));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.request) as never,
}));

import { SidebarMenu, SidebarProvider } from "../ui/sidebar";
import { TodoSidebarButton } from "./TodoSidebarButton";

const button = (
  <SidebarProvider>
    <SidebarMenu>
      <TodoSidebarButton onClick={() => {}} />
    </SidebarMenu>
  </SidebarProvider>
);
const response = (completed: (string | null)[]) => ({
  _tag: "Success",
  value: {
    status: 200,
    body: JSON.stringify({ items: completed.map((completedAt) => ({ completedAt })) }),
  },
});

it("counts unfinished todos and refreshes after a confirmed mutation, including zero", async () => {
  state.request.mockReset().mockResolvedValue(response([null, "2026-11-01T09:00:00Z", null]));
  await using screen = await render(button);
  await expect
    .element(screen.getByRole("button", { name: "Personal todos, 2 open" }))
    .toBeVisible();
  state.request.mockResolvedValue(response([]));
  await act(async () => window.dispatchEvent(new Event("t3:todos-changed")));
  await expect
    .element(screen.getByRole("button", { name: "Personal todos, 0 open" }))
    .toBeVisible();
  state.request.mockResolvedValue({ _tag: "Success", value: { status: 503, body: "{}" } });
  await act(async () => window.dispatchEvent(new Event("t3:todos-changed")));
  await expect
    .element(screen.getByRole("button", { name: "Personal todos, 0 open" }))
    .toBeVisible();
});

it("a delayed count read cannot overwrite a newer refresh", async () => {
  let resolve!: (value: unknown) => void;
  const slow = new Promise((done) => {
    resolve = done;
  });
  state.request
    .mockReset()
    .mockReturnValueOnce(slow)
    .mockResolvedValue(response([null]));
  await using screen = await render(button);
  await act(async () => window.dispatchEvent(new Event("t3:todos-changed")));
  await expect
    .element(screen.getByRole("button", { name: "Personal todos, 1 open" }))
    .toBeVisible();
  await act(async () => resolve(response([null, null, null])));
  await expect
    .element(screen.getByRole("button", { name: "Personal todos, 1 open" }))
    .toBeVisible();
});
