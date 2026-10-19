import type { CloudChatListResult } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  list: {} as { data: typeof CloudChatListResult.Type | null; error: string | null },
  permitted: true,
  open: vi.fn(),
  waitForShell: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.permitted }));
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

let renderer: ReactTestRenderer | undefined;
const visitKey = cloudChatVisitKey("env", "account", "thread-1");
const CloudChatView = Route.options.component!;
await CloudChatView.preload?.();
async function render() {
  await act(async () => {
    if (renderer) renderer.update(<CloudChatView />);
    else renderer = create(<CloudChatView />);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  state.list = { data: { accountId: "account", hasMore: true, chats: [] }, error: null };
  state.permitted = true;
  state.open.mockReset();
  state.waitForShell.mockReset().mockResolvedValue(true);
  state.navigate.mockReset();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("opening an automatic Cloud conversation", () => {
  it("marks the device-local visit and navigates only after a successful binding", async () => {
    let complete!: (result: unknown) => void;
    state.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await render();
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
    state.open.mockResolvedValue({ _tag: "Failure" });
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("waits for the normal thread shell before navigating or marking the conversation read", async () => {
    let ready!: (value: boolean) => void;
    state.open.mockResolvedValue({ _tag: "Success", value: { threadId: "bound-thread" } });
    state.waitForShell.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    await render();
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
    const completions: Array<(result: unknown) => void> = [];
    state.open.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
    await render();
    state.list = { data: { accountId: "other-account", hasMore: false, chats: [] }, error: null };
    await render();
    await act(() =>
      completions[0]!({ _tag: "Success", value: { threadId: "old-account-thread" } }),
    );
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("does not import without operation permission or a verified account", async () => {
    state.permitted = false;
    await render();
    state.permitted = true;
    state.list.error = "Account unavailable";
    await render();
    expect(state.open).not.toHaveBeenCalled();
  });
});
