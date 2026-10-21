// @vitest-environment jsdom
import type { CloudChatSummary } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  accountId: "account",
  environmentId: "env",
  params: {} as {
    cloudThreadId?: string;
    cloudEnvironmentId?: string;
    threadId?: string;
    environmentId?: string;
  },
  threads: [] as {
    id: string;
    environmentId: string;
    source: { runDestination: { accountId: string; existingThreadId: string } };
  }[],
  chats: [] as CloudChatSummary[],
  hasMore: false,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => state.params,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../state/entities", () => ({ useThreadShells: () => state.threads }));
vi.mock("../../state/cloudChats", () => ({ cloudChats: { list: () => null } }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => state.environmentId }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    error: null,
    data: { accountId: state.accountId, chats: state.chats, hasMore: state.hasMore },
  }),
}));
vi.mock("../ui/sidebar", () => ({ useSidebar: () => ({ setOpenMobile: () => {} }) }));

import { cloudChatVisitKey, isUnopenedAutomaticChat } from "../../lib/cloudChatVisits";
import { useUiStateStore } from "../../uiStateStore";
import { AutomaticChatsSection } from "./AutomaticChatsSection";

let root: Root;
let container: HTMLDivElement;
const onToggle = vi.fn();
const onLayoutChange = () => {};
const chat = (id: string, origin: CloudChatSummary["origin"] = "automatic"): CloudChatSummary => ({
  id,
  origin,
  title: id,
  createdAt: 1,
  updatedAt: 2,
  status: "active",
  repository: null,
  githubRunUrl: null,
});
async function render(expanded = false) {
  await act(() =>
    root.render(
      <ul>
        <AutomaticChatsSection
          expanded={expanded}
          onToggle={onToggle}
          onLayoutChange={onLayoutChange}
        />
      </ul>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.accountId = "account";
  state.environmentId = "env";
  state.params = {};
  state.threads = [];
  state.hasMore = false;
  state.chats = [chat("one"), chat("two"), chat("user", "user")];
  onToggle.mockClear();
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("marks the expanded automatic chats read without collapsing the section or clearing other scopes", async () => {
  const otherKey = cloudChatVisitKey("other-env", "account", "one");
  useUiStateStore.setState({ threadLastVisitedAtById: { [otherKey]: "2026-10-15T08:00:00Z" } });
  await render(true);
  const action = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Mark all automatic chats as read"]',
  )!;
  expect(action).not.toBeNull();
  expect(container.querySelector("button button")).toBeNull();
  await act(() => action.click());

  const visits = useUiStateStore.getState().threadLastVisitedAtById;
  expect(isUnopenedAutomaticChat(chat("one"), "env", "account", visits)).toBe(false);
  expect(isUnopenedAutomaticChat(chat("two"), "env", "account", visits)).toBe(false);
  expect(visits[cloudChatVisitKey("env", "account", "user")]).toBeUndefined();
  expect(visits[otherKey]).toBe("2026-10-15T08:00:00Z");
  expect(
    container.querySelector('button[aria-label="Mark all automatic chats as read"]'),
  ).toBeNull();
  expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  expect(onToggle).not.toHaveBeenCalled();

  state.chats.push(chat("later"));
  await render();
  expect(
    isUnopenedAutomaticChat(
      chat("later"),
      "env",
      "account",
      useUiStateStore.getState().threadLastVisitedAtById,
    ),
  ).toBe(true);
  state.accountId = "other-account";
  await render();
  expect(isUnopenedAutomaticChat(chat("one"), "env", "other-account", visits)).toBe(true);
});

it("keeps the section toggle independent from its read action", async () => {
  await render(true);
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')!.click(),
  );
  expect(onToggle).toHaveBeenCalledOnce();
  expect(
    isUnopenedAutomaticChat(
      chat("one"),
      "env",
      "account",
      useUiStateStore.getState().threadLastVisitedAtById,
    ),
  ).toBe(true);
});

it("does not report zero running when an automatic chat's activity is unavailable", async () => {
  state.chats = [{ ...chat("one"), status: "unknown" }];
  await render();
  expect(container.querySelector('[aria-label="Activity unavailable"]')).not.toBeNull();
  expect(container.textContent).not.toContain("0 running");

  state.chats.push(chat("running"));
  await render();
  expect(container.querySelector('[aria-label="At least 1 running"]')).not.toBeNull();
  expect(container.textContent).toContain("· 1+ running");

  state.chats[0] = { ...chat("one"), status: "idle" };
  await render();
  expect(container.textContent).toContain("· 1 running");
  expect(container.textContent).not.toContain("At least");

  state.hasMore = true;
  await render(true);
  expect(container.textContent).toContain("Recent ·");
  expect(container.querySelector('[aria-label="At least 1 running"]')).not.toBeNull();
  expect(container.textContent).toContain("· 1+ running");
  const action = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Mark all automatic chats as read"]',
  )!;
  await act(() => action.click());
  expect(useUiStateStore.getState().threadLastVisitedAtById).toHaveProperty(
    cloudChatVisitKey("env", "account", "running"),
  );
});

it("keeps the running lower bound visible when collapsed without counting user chats", async () => {
  state.hasMore = true;
  state.chats = [chat("one"), chat("two"), chat("user", "user")];
  await render();
  expect(container.querySelector('[aria-label="At least 2 running"]')).not.toBeNull();
  expect(container.textContent).toContain("· 2+ running");
  expect(container.querySelectorAll("a")).toHaveLength(0);

  state.chats = [{ ...chat("idle"), status: "idle" }, chat("user", "user")];
  await render();
  expect(container.querySelector('[aria-label="Activity unavailable"]')).not.toBeNull();
  expect(container.textContent).not.toContain("0 running");

  state.hasMore = false;
  await render();
  expect(container.querySelector('[aria-label="0 running"]')).not.toBeNull();
  expect(container.textContent).toContain("· 0 running");
});

it("keeps the collapsed count non-interactive while opening the section", async () => {
  await render(false);
  expect(
    container.querySelector('button[aria-label="Mark all automatic chats as read"]'),
  ).toBeNull();
  expect(container.textContent).toContain("2 new");
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(),
  );
  expect(onToggle).toHaveBeenCalledOnce();
  expect(useUiStateStore.getState().threadLastVisitedAtById).toEqual({});
});

it("pages automatic history while keeping unread actions scoped to the whole fetched list", async () => {
  state.chats = Array.from({ length: 40 }, (_, index) => chat(`automatic-${index}`));
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
  expect(container.textContent).not.toContain("automatic-39");

  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Mark all automatic chats as read"]')!
      .click(),
  );
  expect(
    isUnopenedAutomaticChat(
      chat("automatic-39"),
      "env",
      "account",
      useUiStateStore.getState().threadLastVisitedAtById,
    ),
  ).toBe(false);

  const showMore = () =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Show "),
    )!;
  await act(() => showMore().click());
  expect(container.querySelectorAll("a")).toHaveLength(35);
  await act(() => showMore().click());
  expect(container.querySelectorAll("a")).toHaveLength(40);
  expect(showMore()).toBeUndefined();

  state.accountId = "other-account";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);

  await act(() => showMore().click());
  state.environmentId = "other-env";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
});

it("keeps an opened chat beyond the first page visible only in its destination environment", async () => {
  state.chats = Array.from({ length: 40 }, (_, index) => chat(`automatic-${index}`));
  state.params = { cloudThreadId: "automatic-39", cloudEnvironmentId: "env" };
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(11);
  expect(container.textContent).toContain("automatic-39");
  expect(container.textContent).not.toContain("automatic-38");

  state.params.cloudEnvironmentId = "other-env";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
  expect(container.textContent).not.toContain("automatic-39");
});

it("keeps an imported automatic chat visible on its normal thread route within the same account", async () => {
  state.chats = Array.from({ length: 40 }, (_, index) => chat(`automatic-${index}`));
  state.threads = [
    {
      id: "normal-thread",
      environmentId: "env",
      source: { runDestination: { accountId: "account", existingThreadId: "automatic-39" } },
    },
  ];
  state.params = { threadId: "normal-thread", environmentId: "env" };
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(11);
  expect(container.textContent).toContain("automatic-39");

  state.accountId = "other-account";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
  expect(container.textContent).not.toContain("automatic-39");
});
