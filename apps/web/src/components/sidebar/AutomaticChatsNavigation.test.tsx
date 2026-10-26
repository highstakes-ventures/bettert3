// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/router-core/isServer", () => ({ isServer: false }));

const state = vi.hoisted(() => ({
  threads: [] as EnvironmentThreadShell[],
  open: vi.fn(),
}));
vi.mock("../../state/entities", () => ({
  useThreadShells: () => state.threads,
  useProject: () => null,
  waitForThreadShell: () => Promise.resolve(true),
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "env",
  useEnvironmentMachines: () => new Map(),
}));
vi.mock("../../state/cloudChats", () => ({
  cloudChats: { list: () => null, open: { permissionAtom: () => null } },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.open }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    error: null,
    data: {
      accountId: "account",
      tasks: [],
      hasMore: false,
      chats: [
        { id: "native", title: "Nightly", origin: "automatic", status: "idle", updatedAt: 1 },
      ],
    },
  }),
}));
vi.mock("../ui/sidebar", () => ({ useSidebar: () => ({ setOpenMobile: () => {} }) }));

import { AutomaticChatsSection } from "./AutomaticChatsSection";
import { Route as CloudRoute } from "../../routes/_chat.cloud.$cloudEnvironmentId.$cloudThreadId";
import { useUiStateStore } from "../../uiStateStore";
import { cloudChatVisitKey } from "../../lib/cloudChatVisits";

it("returns to an imported automatic chat without reopening its Cloud fetch route", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", () => {});
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  state.threads = [];
  state.open.mockReset().mockImplementation(async () => {
    state.threads = [
      {
        environmentId: "env",
        id: "bound-thread",
        source: { runDestination: { accountId: "account", existingThreadId: "native" } },
      },
    ] as EnvironmentThreadShell[];
    return { _tag: "Success", value: { threadId: "bound-thread" } };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const route = createRootRoute({
    component: () => (
      <>
        <ul>
          <AutomaticChatsSection expanded onToggle={() => {}} onLayoutChange={() => {}} />
        </ul>
        <Outlet />
      </>
    ),
  });
  const chatRoute = createRoute({ getParentRoute: () => route, id: "_chat" });
  const cloudRoute = CloudRoute.update({
    getParentRoute: () => chatRoute,
    id: "/cloud/$cloudEnvironmentId/$cloudThreadId",
    path: "/cloud/$cloudEnvironmentId/$cloudThreadId",
  } as never);
  const router = createRouter({
    routeTree: route.addChildren([
      createRoute({ getParentRoute: () => route, path: "/", component: () => null }),
      chatRoute.addChildren([
        cloudRoute,
        createRoute({
          getParentRoute: () => chatRoute,
          path: "/$environmentId/$threadId",
          component: () => <p>Cached normal conversation</p>,
        }),
      ]),
    ]),
    history: createMemoryHistory(),
    defaultPendingMs: 0,
  });
  try {
    await act(async () => {
      await router.load();
      root.render(<RouterProvider router={router} />);
    });
    await act(async () => {
      container.querySelector<HTMLAnchorElement>("a")!.click();
      await router.latestLoadPromise;
    });
    expect(state.open).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Cached normal conversation");
    await act(() => router.navigate({ to: "/" }));
    await act(() => useUiStateStore.setState({ threadLastVisitedAtById: {} }));
    state.open.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      container.querySelector<HTMLAnchorElement>("a")!.click();
      await router.latestLoadPromise;
    });
    expect(container.textContent).toContain("Cached normal conversation");
    expect(container.textContent).not.toContain("Opening Cloud conversation");
    expect(state.open).toHaveBeenCalledOnce();
    expect(useUiStateStore.getState().threadLastVisitedAtById).toHaveProperty(
      cloudChatVisitKey("env", "account", "native"),
    );
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
