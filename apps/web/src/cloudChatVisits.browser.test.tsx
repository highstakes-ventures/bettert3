import { act, render } from "../test/render";
import type { CloudChatListResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  list: {} as { data: typeof CloudChatListResult.Type | null; error: string | null },
  permitted: true,
  open: vi.fn(),
  waitForShell: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.permitted,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ cloudEnvironmentId: "env", cloudThreadId: "thread-1" }),
  }),
}));
vi.mock("./state/entities", () => ({ waitForThreadShell: state.waitForShell }));
vi.mock("./state/cloudChats", () => ({
  cloudChats: { list: () => "list", open: { permissionAtom: () => null } },
}));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.open }));
vi.mock("./state/query", () => ({
  useEnvironmentQuery: () => ({ ...state.list, refresh: () => {} }),
}));

import { cloudChatVisitKey } from "./lib/cloudChatVisits";
import { useUiStateStore } from "./uiStateStore";
import { Route } from "./routes/_chat.cloud.$cloudEnvironmentId.$cloudThreadId";

const visitKey = cloudChatVisitKey("env", "account", "thread-1");
const CloudChatView = Route.options.component!;
await CloudChatView.preload?.();

describe("opening an automatic Cloud conversation", () => {
  it("marks the device-local visit and navigates only after a successful binding", async () => {
    using _state = setup();

    let complete!: (result: unknown) => void;
    state.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await using _screen = await render(<CloudChatView />, { router: false });
    expect(state.open).toHaveBeenCalledWith({
      environmentId: "env",
      input: { accountId: "account", threadId: "thread-1" },
    });
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
    await act(() => complete({ _tag: "Success", value: { threadId: "bound-thread" } }));
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeDefined();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env", threadId: "bound-thread" },
      replace: true,
    });
  });
  it("keeps a failed import unopened and stays on its retry view", async () => {
    using _state = setup();

    state.open.mockResolvedValue({ _tag: "Failure" });
    await using _screen = await render(<CloudChatView />, { router: false });
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("waits for the normal thread shell before navigating or marking the conversation read", async () => {
    using _state = setup();

    let ready!: (value: boolean) => void;
    state.open.mockResolvedValue({ _tag: "Success", value: { threadId: "bound-thread" } });
    state.waitForShell.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    await using _screen = await render(<CloudChatView />, { router: false });
    expect(state.waitForShell).toHaveBeenCalledWith({
      environmentId: "env",
      threadId: "bound-thread",
    });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    await act(async () => ready(false));
    expect(state.navigate).not.toHaveBeenCalled();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
  });
  it("ignores an obsolete import after the account changes", async () => {
    using _state = setup();

    const completions: Array<(result: unknown) => void> = [];
    state.open.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
    await using screen = await render(<CloudChatView />, { router: false });
    state.list = { data: { accountId: "other-account", hasMore: false, chats: [] }, error: null };
    await screen.rerender(<CloudChatView />);
    await act(() =>
      completions[0]!({ _tag: "Success", value: { threadId: "old-account-thread" } }),
    );
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("does not import without operation permission or a verified account", async () => {
    using _state = setup();

    state.permitted = false;
    await using screen = await render(<CloudChatView />, { router: false });
    state.permitted = true;
    state.list.error = "Account unavailable";
    await screen.rerender(<CloudChatView />);
    expect(state.open).not.toHaveBeenCalled();
  });
});

function setup() {
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  state.list = { data: { accountId: "account", hasMore: true, chats: [] }, error: null };
  state.permitted = true;
  state.open.mockReset();
  state.waitForShell.mockReset().mockResolvedValue(true);
  state.navigate.mockReset();

  return {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
}
