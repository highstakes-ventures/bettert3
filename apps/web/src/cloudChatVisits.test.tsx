import type { CloudChatListResult, CloudChatReadResult } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  list: {} as { data: typeof CloudChatListResult.Type | null; error: string | null },
  history: {} as {
    data: typeof CloudChatReadResult.Type | null;
    error: string | null;
    isSuccess: boolean;
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ cloudEnvironmentId: "env", cloudThreadId: "thread-1" }),
  }),
}));
vi.mock("./state/cloudChats", () => ({
  cloudChats: { list: () => "list", read: () => "history" },
}));
vi.mock("./state/query", () => ({
  useEnvironmentQuery: (query: string | null) => ({
    data: null,
    error: null,
    refresh: () => {},
    ...(query === "list" ? state.list : query === "history" ? state.history : {}),
  }),
}));
vi.mock("./components/chat/MessagesTimeline", () => ({ MessagesTimeline: () => null }));
vi.mock("./components/WorkspacePageHeader", () => ({ WorkspacePageHeader: () => null }));
vi.mock("./hooks/useSettings", () => ({ useClientSettings: () => "locale" }));
vi.mock("./hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

import { cloudChatVisitKey } from "./lib/cloudChatVisits";
import { useUiStateStore } from "./uiStateStore";
import { Route } from "./routes/_chat.cloud.$cloudEnvironmentId.$cloudThreadId";

let renderer: ReactTestRenderer | undefined;
const visitKey = cloudChatVisitKey("env", "account", "thread-1");
const CloudChatView = Route.options.component!;
await CloudChatView.preload?.();

async function render() {
  await act(() => {
    if (renderer) renderer.update(<CloudChatView />);
    else renderer = create(<CloudChatView />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  state.list = {
    data: {
      accountId: "account",
      hasMore: false,
      chats: [
        {
          id: "thread-1",
          title: "Nightly run",
          origin: "automatic",
          status: "active",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
          githubRunUrl: null,
        },
      ],
    },
    error: null,
  };
  state.history = { data: null, error: null, isSuccess: false };
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("opening an automatic cloud conversation", () => {
  it("remembers an opened conversation outside the latest list page", async () => {
    state.list.data = { accountId: "account", hasMore: true, chats: [] };
    state.history = {
      data: { threadId: "thread-1", messages: [], nextCursor: null },
      error: null,
      isSuccess: true,
    };
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeDefined();
  });
  it("keeps it new through loading and failure, then marks it opened once history loads", async () => {
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    state.history = { data: null, error: "Connection failed", isSuccess: false };
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    state.history = {
      data: { threadId: "thread-1", messages: [], nextCursor: null },
      error: null,
      isSuccess: true,
    };
    await render();
    const visitedAt = useUiStateStore.getState().threadLastVisitedAtById[visitKey];
    expect(visitedAt).toBeDefined();
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBe(visitedAt);
  });

  it("does not clear a visit for another conversation or a failed account list", async () => {
    state.history = {
      data: { threadId: "other-thread", messages: [], nextCursor: null },
      error: null,
      isSuccess: true,
    };
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
    state.history.data = { threadId: "thread-1", messages: [], nextCursor: null };
    state.list.error = "Account changed";
    await render();
    expect(useUiStateStore.getState().threadLastVisitedAtById[visitKey]).toBeUndefined();
  });
});
