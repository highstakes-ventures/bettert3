// @vitest-environment jsdom
import type { CloudChatSummary } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  accountId: "account",
  chats: [] as CloudChatSummary[],
  hasMore: false,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../state/cloudChats", () => ({ cloudChats: { list: () => null } }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => "env" }));
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

it("marks the current automatic chats read without expanding the section or clearing other scopes", async () => {
  const otherKey = cloudChatVisitKey("other-env", "account", "one");
  useUiStateStore.setState({ threadLastVisitedAtById: { [otherKey]: "2026-10-15T08:00:00Z" } });
  await render();
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
  expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull();
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
  expect(container.querySelector('[aria-label="Activity unavailable"]')).not.toBeNull();
  expect(container.textContent).not.toContain("1 running");

  state.chats[0] = { ...chat("one"), status: "idle" };
  await render();
  expect(container.textContent).toContain("· 1 running");
  expect(container.textContent).not.toContain("At least");

  state.hasMore = true;
  await render(true);
  expect(container.textContent).toContain("Recent ·");
  expect(container.textContent).not.toContain("1 running");
  const action = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Mark all automatic chats as read"]',
  )!;
  await act(() => action.click());
  expect(useUiStateStore.getState().threadLastVisitedAtById).toHaveProperty(
    cloudChatVisitKey("env", "account", "running"),
  );
});
