import { page } from "vite-plus/test/browser";
import { RegistryContext } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  environmentId: "home",
  request: vi.fn(),
  lists: new Map<string, unknown>(),
}));
vi.mock(import("../../state/server"), () => ({
  primaryServerKeybindingsAtom: Atom.make(DEFAULT_RESOLVED_KEYBINDINGS),
}));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironmentId: (() => state.environmentId) as never,
}));
vi.mock(import("../../state/todos"), () => ({
  todoList: (({ environmentId }: { environmentId: string }) =>
    state.lists.get(environmentId)) as never,
}));
vi.mock(import("../../state/todo"), () => ({ todoEnvironment: { request: {} } as never }));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.request) as never,
}));
import { SidebarMenu, SidebarProvider } from "../ui/sidebar";
import { TodoSidebarButton } from "./TodoSidebarButton";
import { TodoCaptureDialog } from "../TodoCaptureDialog";

const response = (completed: (string | null)[]) =>
  AsyncResult.success({ items: completed.map((completedAt) => ({ completedAt })) });
const view = (registry: AtomRegistry.AtomRegistry) => (
  <RegistryContext value={registry}>
    <SidebarProvider>
      <SidebarMenu>
        <TodoSidebarButton onClick={() => {}} />
      </SidebarMenu>
    </SidebarProvider>
  </RegistryContext>
);

it("counts unfinished todos from the shared list and reflects completion, including zero", async () => {
  state.environmentId = "home";
  state.lists.clear();
  const list = Atom.make(response([null, "2026-11-01T09:00:00Z", null]));
  state.lists.set("home", list);
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  await using screen = await render(view(registry));
  await expect
    .element(screen.getByRole("button", { name: "Add a personal todo, 2 open" }))
    .toBeVisible();
  await act(async () => registry.set(list, response([])));
  await expect
    .element(screen.getByRole("button", { name: "Add a personal todo, 0 open" }))
    .toBeVisible();
});

it("an environment change cannot show another environment's count", async () => {
  state.environmentId = "home";
  state.lists.clear();
  state.lists.set("home", Atom.make(response([null, null])));
  state.lists.set("remote", Atom.make(AsyncResult.initial()));
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  await using screen = await render(view(registry));
  await expect
    .element(screen.getByRole("button", { name: "Add a personal todo, 2 open" }))
    .toBeVisible();
  state.environmentId = "remote";
  await screen.rerender(view(registry));
  await expect
    .element(screen.getByRole("button", { name: "Add a personal todo", exact: true }))
    .toBeVisible();
});

it("opens todo capture inline from the sidebar and keeps the current route", async () => {
  state.environmentId = "home";
  state.lists.clear();
  state.lists.set("home", Atom.make(response([])));
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  await using screen = await render(
    <>
      {view(registry)}
      <RegistryContext value={registry}>
        <TodoCaptureDialog />
      </RegistryContext>
    </>,
  );
  await screen.getByRole("button", { name: "Add a personal todo, 0 open" }).click();
  await expect.element(page.getByRole("dialog", { name: "Add a personal todo" })).toBeVisible();
  expect(screen.router?.state.location.pathname).toBe("/");
  await expect.element(page.getByRole("link", { name: "View todos" })).toBeVisible();
});
