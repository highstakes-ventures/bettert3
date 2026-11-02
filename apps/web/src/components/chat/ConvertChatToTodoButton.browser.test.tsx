import "../../index.css";
import { RegistryContext } from "@effect/atom-react";
import { page } from "vite-plus/test/browser";
import { TodoCaptureDialog } from "../TodoCaptureDialog";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  request: vi.fn(),
  snapshot: vi.fn(),
  notify: vi.fn(),
  allowed: true,
  atom: null as unknown,
}));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironmentId: (() => "local") as never,
}));
vi.mock(import("../../state/server"), () => ({ primaryServerKeybindingsAtom: {} as never }));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => []) as never,
}));
vi.mock(import("../../state/todo"), () => ({ todoEnvironment: { request: {} } as never }));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: ((command: unknown) =>
    command === "fresh-snapshot" ? state.snapshot : state.request) as never,
}));
vi.mock(import("../../state/session"), () => ({
  useEnvironmentScope: (() => state.allowed) as never,
  readEnvironmentScope: (() => state.allowed) as never,
}));
vi.mock(import("../../state/threads"), () => ({
  environmentThreadDetails: { stateAtom: () => state.atom } as never,
  readFreshThreadSnapshot: "fresh-snapshot" as never,
}));
vi.mock(import("../../state/entities"), () => ({
  readThreadShell: (() => ({ title: "Book dentist" })) as never,
}));
vi.mock(import("../ui/toast"), () => ({
  toastManager: { add: (value: unknown) => state.notify(value) } as never,
}));
import { ConvertChatToTodoButton } from "./ConvertChatToTodoButton";

it("opens the shared capture dialog and saves its note and chat context only after confirmation", async () => {
  state.allowed = true;
  state.request
    .mockReset()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValue({ _tag: "Success", value: { status: 201, body: "{}" } });
  state.notify.mockReset();
  state.snapshot.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      thread: { title: "Book dentist" },
      messages: [
        {
          role: "user",
          text: "Book a checkup next week",
          createdAt: DateTime.makeUnsafe("2026-11-01T09:00:00Z"),
        },
      ],
    },
  });
  const snapshot = {
    status: "live",
    error: Option.none(),
    data: Option.some({
      messages: [
        {
          role: "user",
          text: "Book a checkup next week",
          createdAt: DateTime.makeUnsafe("2026-11-01T09:00:00Z"),
        },
      ],
    }),
  };
  const atom = Atom.make(snapshot);
  state.atom = atom;
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  const ref = { environmentId: EnvironmentId.make("remote"), threadId: ThreadId.make("chat-1") };
  const onRowClick = vi.fn();
  await using screen = await render(
    <RegistryContext value={registry}>
      <TodoCaptureDialog />
      <div onClick={onRowClick}>
        <ConvertChatToTodoButton threadRef={ref} />
      </div>
    </RegistryContext>,
  );
  await screen.getByRole("button", { name: "Convert chat to todo" }).click();
  await expect.element(page.getByRole("dialog", { name: "Add a personal todo" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Book dentist" })).toBeVisible();
  expect(state.request).not.toHaveBeenCalled();
  const field = page.getByRole("textbox", { name: "What do you want to remember?" });
  await expect.element(field).toHaveValue("");
  await field.fill("Call the dentist on Monday");
  await page.getByRole("button", { name: "Add todo" }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(field).toHaveValue("Call the dentist on Monday");
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  const first = state.request.mock.calls[0]![0];
  const second = state.request.mock.calls[1]![0];
  expect(second).toEqual(first);
  expect(first.environmentId).toBe("remote");
  const body = JSON.parse(first.input.request.body);
  expect(body.sourceChat).toEqual(ref);
  expect(body.note).toContain("Call the dentist on Monday");
  expect(body.note).toContain("Book dentist");
  expect(body.note).toContain("Book a checkup next week");
  expect(onRowClick).not.toHaveBeenCalled();
  expect(registry.get(atom)).toBe(snapshot);
  expect(
    state.request.mock.calls.every(
      ([input]) => input.input.request.path === "todos" && input.input.request.method === "POST",
    ),
  ).toBe(true);
});

it("does not capture a read-only chat", async () => {
  state.allowed = false;
  state.request.mockReset();
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  await using screen = await render(
    <RegistryContext value={registry}>
      <ConvertChatToTodoButton
        threadRef={{
          environmentId: EnvironmentId.make("remote"),
          threadId: ThreadId.make("chat-1"),
        }}
      />
    </RegistryContext>,
  );
  await expect.element(screen.getByRole("button", { name: "Convert chat to todo" })).toBeDisabled();
  expect(state.request).not.toHaveBeenCalled();
});

it("waits for a fresh snapshot instead of capturing a retained live conversation", async () => {
  state.allowed = true;
  state.request
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { status: 201, body: "{}" } });
  const cached = {
    status: "live",
    error: Option.none(),
    data: Option.some({
      messages: [
        {
          role: "user",
          text: "Old instruction",
          createdAt: DateTime.makeUnsafe("2026-11-01T09:00:00Z"),
        },
      ],
    }),
  };
  state.atom = Atom.make(cached);
  let finish!: (value: unknown) => void;
  state.snapshot.mockReset().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  using stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  await using screen = await render(
    <RegistryContext value={registry}>
      <TodoCaptureDialog />
      <ConvertChatToTodoButton
        threadRef={{
          environmentId: EnvironmentId.make("remote"),
          threadId: ThreadId.make("chat-1"),
        }}
      />
    </RegistryContext>,
  );
  await screen.getByRole("button", { name: "Convert chat to todo" }).click();
  expect(state.request).not.toHaveBeenCalled();
  finish({
    _tag: "Success",
    value: {
      thread: { title: "Current title" },
      messages: [
        {
          role: "user",
          text: "New instruction from the closed chat",
          createdAt: DateTime.makeUnsafe("2026-11-01T11:00:00Z"),
        },
      ],
    },
  });
  await expect.element(page.getByRole("heading", { name: "Current title" })).toBeVisible();
  expect(state.request).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Add todo" }).click();
  await vi.waitFor(() => expect(state.request).toHaveBeenCalledOnce());
  expect(JSON.parse(state.request.mock.calls[0]![0].input.request.body).note).toContain(
    "New instruction from the closed chat",
  );
});
