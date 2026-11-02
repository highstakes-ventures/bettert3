import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../test/render";

const state = vi.hoisted(() => ({
  environmentId: "home",
  run: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({
    options,
  }),
  redirect: vi.fn(),
  useNavigate: () => state.navigate,
}));
vi.mock("./state/environments", () => ({ usePrimaryEnvironmentId: () => state.environmentId }));
vi.mock("./state/mation", () => ({
  mationEnvironment: { request: { label: "mation-test", run: state.run } },
}));
vi.mock("./components/TodoCaptureDialog", () => ({ forwardTodoKeydown: vi.fn() }));

import { Route } from "./routes/mation";

const MationPage = Route.options.component!;
await MationPage.preload?.();
type PageReply = ReturnType<typeof AsyncResult.success<{ status: number; body: string }>>;

function setup() {
  state.environmentId = "home";
  const pending: Array<(reply: PageReply) => void> = [];
  state.run
    .mockReset()
    .mockImplementation(() => new Promise<PageReply>((resolve) => pending.push(resolve)));
  const registry = AtomRegistry.make();
  return {
    registry,
    view: () => (
      <RegistryContext value={registry}>
        <MationPage />
      </RegistryContext>
    ),
    reply: (index: number, html: string) =>
      act(async () =>
        pending[index]!(
          AsyncResult.success({
            status: 200,
            body: JSON.stringify({ html }),
          }),
        ),
      ),
    fail: () => act(async () => pending[0]!(AsyncResult.success({ status: 503, body: "" }))),
    [Symbol.dispose]: () => registry.dispose(),
  };
}

it("displays the pending todo page after unrelated rerenders without restarting its load", async () => {
  using test = setup();
  await using screen = await render(test.view());
  await expect.element(screen.getByRole("status")).toHaveTextContent("Opening Mation...");
  await screen.rerender(test.view());
  await screen.rerender(test.view());
  await test.reply(0, "<p>Personal todos</p>");
  await expect
    .element(screen.getByTitle("Mation automations"))
    .toHaveAttribute("srcdoc", "<p>Personal todos</p>");
  expect(state.run).toHaveBeenCalledTimes(1);
});

it("ignores an obsolete Mation page after changing the environment", async () => {
  using test = setup();
  await using screen = await render(test.view());
  state.environmentId = "remote";
  await screen.rerender(test.view());
  await test.reply(1, "<p>Current page</p>");
  await test.reply(0, "<p>Obsolete page</p>");
  await expect
    .element(screen.getByTitle("Mation automations"))
    .toHaveAttribute("srcdoc", "<p>Current page</p>");
  expect(state.run).toHaveBeenCalledTimes(2);
});

it("shows a failed load without starting another request", async () => {
  using test = setup();
  await using screen = await render(test.view());
  await test.fail();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Mation could not be opened. Check this environment's Mation connection.");
  expect(state.run).toHaveBeenCalledTimes(1);
});
