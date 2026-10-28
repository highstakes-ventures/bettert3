// @vitest-environment jsdom
import type { CloudChatSummary } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import * as DateTime from "effect/DateTime";
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
    title?: string;
    archivedAt?: string | null;
    updatedAt?: string;
    lastVisitedAt?: string | null | undefined;
    latestRun?: { completedAt: string | null } | null;
    hasPendingApprovals?: boolean;
    hasPendingUserInput?: boolean;
    pendingSubagentRequest?: null;
    runtime?: { status: string; lastErrorClass?: string } | null;
    source: {
      runDestination?: { accountId: string; existingThreadId: string; origin?: "automatic" };
      automationOrigin?: "t3" | "external" | null;
      backgroundWorkflowId?: string;
      ticketWorkflowId?: string;
      executionDestination?: null;
      status?: string;
      activityRunStatus?: string | null;
      activityRunStartedAt?: DateTime.Utc | null;
      latestRunStartedAt?: DateTime.Utc | null;
      latestRunCompletedAt?: DateTime.Utc | null;
      scheduledTaskId?: string;
      latestRunId?: string | null;
    };
  }[],
  chats: [] as CloudChatSummary[],
  supportsVisits: false,
  visit: vi.fn(),
  hasMore: false,
  cloudError: null as string | null,
  tasks: [] as { threadId: string; enabled: boolean }[],
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => state.params,
  Link: ({
    children,
    params,
    ...props
  }: {
    children: ReactNode;
    params: Record<string, string>;
  }) => (
    <a
      {...props}
      href={
        params.threadId
          ? `/${params.environmentId}/${params.threadId}`
          : `/cloud/${params.cloudEnvironmentId}/${params.cloudThreadId}`
      }
    >
      {children}
    </a>
  ),
}));
vi.mock("../../state/entities", () => ({
  useThreadShells: () => state.threads,
  useProject: () => null,
  readEnvironmentSupportsVisitedTracking: () => state.supportsVisits,
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: { visit: {} } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.visit }));
vi.mock("../../state/cloudChats", () => ({ cloudChats: { list: () => "cloud" } }));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => state.environmentId,
  useEnvironmentMachines: () => new Map([["env", "mac-mini"]]),
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { scheduledTasksLive: () => "local" } }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: string) =>
    query === "local"
      ? { error: null, data: { tasks: state.tasks } }
      : {
          error: state.cloudError,
          data: { accountId: state.accountId, chats: state.chats, hasMore: state.hasMore },
        },
}));
vi.mock("../ui/sidebar", () => ({ useSidebar: () => ({ setOpenMobile: () => {} }) }));

import { cloudChatVisitKey } from "../../lib/cloudChatVisits";
import { useUiStateStore } from "../../uiStateStore";
import { AutomaticChatsSection } from "./AutomaticChatsSection";
import { isAutomaticSidebarThread } from "../Sidebar.logic";

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
  state.cloudError = null;
  state.tasks = [];
  state.supportsVisits = false;
  state.visit.mockReset().mockImplementation(async ({ environmentId, input }) => {
    const thread = state.threads.find(
      (thread) => thread.environmentId === environmentId && thread.id === input.threadId,
    );
    if (thread) thread.lastVisitedAt = input.visitedAt;
    return { _tag: "Success", value: undefined };
  });
  state.chats = [chat("one"), chat("two"), chat("user", "user")];
  onToggle.mockClear();
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps new automatic activity quiet without pretending the user opened it", async () => {
  const visits = { [cloudChatVisitKey("other-env", "account", "one")]: "2026-10-15T08:00:00Z" };
  useUiStateStore.setState({ threadLastVisitedAtById: visits });
  await render(true);
  expect(
    container.querySelector('button[aria-label="Mark all automatic chats as read"]'),
  ).toBeNull();
  expect(container.textContent).not.toMatch(/\d+ new/);
  expect(
    Array.from(container.querySelectorAll("a")).map((row) => row.getAttribute("aria-label")),
  ).toEqual(["one, running", "two, running"]);
  state.chats.push(chat("later"));
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(3);
  expect(useUiStateStore.getState().threadLastVisitedAtById).toEqual(visits);
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')!.click(),
  );
  expect(onToggle).toHaveBeenCalledOnce();
  expect(useUiStateStore.getState().threadLastVisitedAtById).toEqual(visits);
});

it("does not report zero running when an automatic chat's activity is unavailable", async () => {
  state.chats = [{ ...chat("one"), status: "unknown" }];
  await render();
  expect(container.querySelector('[aria-label="Activity unavailable"]')).not.toBeNull();
  expect(container.textContent).not.toContain("0 running");

  state.chats.push(chat("running"));
  await render();
  expect(container.querySelector('[aria-label="At least 1 running"]')).not.toBeNull();
  expect(container.textContent).toContain("1+ running");

  state.chats[0] = { ...chat("one"), status: "idle" };
  await render();
  expect(container.textContent).toContain("1 running");
  expect(container.textContent).not.toContain("At least");

  state.hasMore = true;
  await render(true);
  expect(container.textContent).toContain("Recent ·");
  expect(container.querySelector('[aria-label="At least 1 running"]')).not.toBeNull();
  expect(container.textContent).toContain("1+ running");
});

it("keeps the running lower bound visible when collapsed without counting user chats", async () => {
  state.hasMore = true;
  state.chats = [chat("one"), chat("two"), chat("user", "user")];
  await render();
  expect(container.querySelector('[aria-label="At least 2 running"]')).not.toBeNull();
  expect(container.textContent).toContain("2+ running");
  expect(container.querySelectorAll("a")).toHaveLength(0);

  state.chats = [{ ...chat("idle"), status: "idle" }, chat("user", "user")];
  await render();
  expect(container.querySelector('[aria-label="Activity unavailable"]')).not.toBeNull();
  expect(container.textContent).not.toContain("0 running");

  state.hasMore = false;
  await render();
  expect(container.querySelector('[aria-label="0 running"]')).not.toBeNull();
  expect(container.textContent).toContain("0 running");
});

it("opens the collapsed history without an unread obligation", async () => {
  await render(false);
  expect(
    container.querySelector('button[aria-label="Mark all automatic chats as read"]'),
  ).toBeNull();
  expect(container.textContent).not.toMatch(/\d+ new/);
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(),
  );
  expect(onToggle).toHaveBeenCalledOnce();
  expect(useUiStateStore.getState().threadLastVisitedAtById).toEqual({});
});

it("pages automatic history independently of visits", async () => {
  state.chats = Array.from({ length: 40 }, (_, index) => chat(`automatic-${index}`));
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
  expect(container.textContent).not.toContain("automatic-39");

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

  state.params = { ...state.params, cloudEnvironmentId: "other-env" };
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

it("uses the latest run's timestamps for elapsed time and freezes completed runs", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-26T12:02:00Z"));
    const startedAt = Date.parse("2026-10-26T12:00:00Z") / 1000;
    state.chats = [
      {
        ...chat("timed"),
        createdAt: startedAt - 86400,
        latestTurn: { startedAt, completedAt: null },
      },
    ];
    await render(true);
    const row = container.querySelector("a")!;
    expect(row.querySelector('[aria-label="Codex Cloud"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="Current run duration"]')?.textContent).toBe("2m");
    await act(() => vi.advanceTimersByTime(60_000));
    expect(row.querySelector('[aria-label="Current run duration"]')?.textContent).toBe("3m");

    state.chats = [
      {
        ...state.chats[0]!,
        status: "idle",
        latestTurn: { startedAt, completedAt: startedAt + 150 },
      },
    ];
    await render(true);
    expect(row.querySelector('[aria-label="Last run duration"]')?.textContent).toBe("2m");
    await act(() => vi.advanceTimersByTime(60_000));
    expect(row.querySelector('[aria-label="Last run duration"]')?.textContent).toBe("2m");
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { status: "active", latestTurn: undefined },
  { status: "idle", latestTurn: { startedAt: 100, completedAt: null } },
  { status: "unknown", latestTurn: null },
  { status: "active", latestTurn: { startedAt: null, completedAt: null } },
])("does not substitute chat age for unavailable run timing: %j", async (timing) => {
  state.chats = [{ ...chat("untimed"), ...timing }];
  await render(true);
  const row = container.querySelector("a")!;
  expect(row.querySelector('[aria-label="Codex Cloud"]')).not.toBeNull();
  expect(row.querySelector('[aria-label$="run duration"]')).toBeNull();
});

const localThread = (id: string, environmentId = "env") => ({
  id,
  environmentId,
  title: `Local ${id}`,
  archivedAt: null,
  updatedAt: "2026-10-26T12:00:00Z",
  lastVisitedAt: "2026-10-26T12:00:00Z",
  source: {},
  runtime: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
});

it("keeps local automation quiet through completion without writing visit timestamps", async () => {
  state.chats = [];
  state.threads = [{ ...localThread("worker"), source: { automationOrigin: "t3" } }];
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.textContent).not.toMatch(/\d+ new/);
  state.threads[0] = {
    ...state.threads[0]!,
    updatedAt: "2026-10-27T13:00:00Z",
    latestRun: { completedAt: "2026-10-27T13:00:00Z" },
  };
  await render(true);
  expect(
    container.querySelector('button[aria-label="Mark all automatic chats as read"]'),
  ).toBeNull();
  expect(state.visit).not.toHaveBeenCalled();
  expect(useUiStateStore.getState().threadLastVisitedAtById).toEqual({});
});

it("keeps paused and running local workflows visible when Cloud fails and isolates environments", async () => {
  state.cloudError = "Cloud unavailable";
  state.threads = [
    localThread("paused"),
    { ...localThread("running"), runtime: { status: "running" } },
    localThread("other", "other-env"),
    { ...localThread("archived"), archivedAt: "2026-10-26T13:00:00Z" },
    localThread("manual"),
  ];
  state.tasks = ["paused", "running", "other", "archived"].map((threadId) => ({
    threadId,
    enabled: false,
  }));
  await render(true);
  expect(
    container.querySelector('a[aria-label="Local paused, paused"]')?.getAttribute("href"),
  ).toBe("/env/paused");
  expect(container.querySelector('a[aria-label="Local running, running"]')).not.toBeNull();
  expect(container.textContent).toContain("Cloud unavailable");
  expect(container.textContent).not.toContain("Local other");
  expect(container.textContent).not.toContain("Local archived");
  expect(container.textContent).not.toContain("Local manual");
  state.tasks[0]!.enabled = true;
  await render(true);
  expect(container.querySelector('a[aria-label="Local paused, waiting"]')).not.toBeNull();
});

it("keeps the selected local workflow visible beyond the first page in its own environment", async () => {
  state.chats = [];
  state.threads = Array.from({ length: 40 }, (_, index) => localThread(`workflow-${index}`));
  state.tasks = state.threads.map((thread) => ({ threadId: thread.id, enabled: true }));
  state.params = { threadId: "workflow-39", environmentId: "env" };
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(11);
  expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
    "/env/workflow-39",
  );
  expect(container.textContent).not.toContain("Local workflow-38");
  state.params = { ...state.params, environmentId: "other-env" };
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(10);
  expect(container.querySelector('a[aria-current="page"]')).toBeNull();
});

it("keeps fresh webhook workers in Automatic after the task is disabled or removed", async () => {
  state.chats = [];
  state.threads = [
    { ...localThread("fresh"), source: { scheduledTaskId: "webhook" } },
    {
      ...localThread("active"),
      source: { scheduledTaskId: "webhook" },
      runtime: { status: "running" },
    },
    { ...localThread("other", "other-env"), source: { scheduledTaskId: "webhook" } },
    localThread("manual"),
  ];
  state.tasks = [];
  await render(true);
  expect(container.querySelector('a[aria-label="Local fresh, completed"]')).not.toBeNull();
  expect(container.querySelector('a[aria-label="Local active, running"]')).not.toBeNull();
  expect(container.querySelector('a[href="/other-env/other"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Local manual");
});

it("includes recorded scans and automatic origins without exposing ticket preparation or ordinary system chats", async () => {
  state.chats = [];
  state.threads = [
    {
      ...localThread("scan"),
      source: { automationOrigin: "t3", backgroundWorkflowId: "performance" },
    },
    {
      ...localThread("ticket"),
      source: {
        automationOrigin: "t3",
        backgroundWorkflowId: "ticket",
        ticketWorkflowId: "ticket",
      },
    },
    { ...localThread("refining"), source: { automationOrigin: "t3", ticketWorkflowId: "ticket" } },
    { ...localThread("crm"), source: { automationOrigin: "external", executionDestination: null } },
    { ...localThread("legacy"), source: { scheduledTaskId: "old-hook" } },
    localThread("manual"),
  ];
  await render(true);
  expect(
    Array.from(container.querySelectorAll("a")).map((row) => row.getAttribute("href")),
  ).toEqual(["/env/scan", "/env/crm", "/env/legacy"]);
  const crm = container.querySelector('a[href="/env/crm"]')!;
  expect(crm.querySelector('[aria-label="Triggered externally"]')).not.toBeNull();
  expect(crm.querySelector('[aria-label="T3 host"]')).not.toBeNull();
  const legacy = container.querySelector('a[href="/env/legacy"]')!;
  expect(legacy.querySelector('[aria-label="Origin unknown"]')).not.toBeNull();
  expect(legacy.querySelector('[aria-label="Execution location unknown"]')).not.toBeNull();
  expect(legacy.querySelector('[aria-label$="run duration"]')).toBeNull();
});

it("uses native provenance once for a matching automatic Cloud chat and isolates account and environment", async () => {
  state.chats = [chat("native")];
  state.threads = [
    {
      ...localThread("imported"),
      lastVisitedAt: undefined,
      source: {
        automationOrigin: "t3",
        runDestination: { accountId: "account", existingThreadId: "native", origin: "automatic" },
      },
    },
  ];
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.textContent).not.toContain(" new");
  expect(container.textContent).toContain("1 running");
  const row = container.querySelector("a")!;
  expect(row.getAttribute("href")).toBe("/env/imported");
  expect(row.querySelector('[aria-label="Started by T3"]')).not.toBeNull();
  expect(row.querySelector('[aria-label="Codex Cloud"]')).not.toBeNull();
  await act(() => row.click());
  expect(container.textContent).not.toContain(" new");
  expect(useUiStateStore.getState().threadLastVisitedAtById).toHaveProperty(
    cloudChatVisitKey("env", "account", "native"),
  );

  state.threads[0]!.source = {
    ...state.threads[0]!.source,
    latestRunStartedAt: DateTime.makeUnsafe("2026-10-26T12:00:00Z"),
    latestRunCompletedAt: DateTime.makeUnsafe("2026-10-26T12:01:00Z"),
    executionDestination: null,
  };
  await render(true);
  expect(container.querySelector('a[href="/env/imported"] [aria-label="T3 host"]')).not.toBeNull();
  expect(container.querySelector('a[href="/env/imported"] [aria-label="Codex Cloud"]')).toBeNull();

  state.threads[0]!.source.automationOrigin = null;
  await render(true);
  expect(
    container.querySelector('a[href="/env/imported"] [aria-label="Origin unknown"]'),
  ).not.toBeNull();

  state.accountId = "other-account";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(2);
  const otherAccount = container.querySelector('a[href="/cloud/env/native"]')!;
  expect(otherAccount.querySelector('[aria-label="Triggered externally"]')).not.toBeNull();
  state.environmentId = "other-env";
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(2);
  expect(container.querySelector('a[href="/cloud/other-env/native"]')).not.toBeNull();
});

it("times native runs from recorded execution and freezes completed scans instead of using chat age", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-26T12:02:00Z"));
    state.chats = [];
    const startedAt = DateTime.makeUnsafe("2026-10-26T12:00:00Z");
    state.threads = [
      {
        ...localThread("timed-scan"),
        runtime: { status: "running" },
        source: {
          automationOrigin: "t3",
          executionDestination: null,
          activityRunStatus: "running",
          activityRunStartedAt: startedAt,
        },
      },
    ];
    await render(true);
    const row = container.querySelector("a")!;
    expect(row.querySelector('[aria-label="Current run duration"]')?.textContent).toBe("2m");
    await act(() => vi.advanceTimersByTime(60_000));
    expect(row.querySelector('[aria-label="Current run duration"]')?.textContent).toBe("3m");
    state.threads[0] = {
      ...state.threads[0]!,
      runtime: { status: "completed" },
      source: {
        automationOrigin: "t3",
        executionDestination: null,
        status: "completed",
        latestRunStartedAt: startedAt,
        latestRunCompletedAt: DateTime.makeUnsafe("2026-10-26T12:02:30Z"),
      },
    };
    await render(true);
    expect(row.querySelector('[aria-label="Last run duration"]')?.textContent).toBe("2m");
    await act(() => vi.advanceTimersByTime(60_000));
    expect(row.querySelector('[aria-label="Last run duration"]')?.textContent).toBe("2m");
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a selected imported Cloud route visible after deduplication beyond the native first page", async () => {
  state.threads = Array.from({ length: 20 }, (_, index) => ({
    ...localThread(`scan-${index}`),
    source: {
      automationOrigin: "t3" as const,
      runDestination: {
        accountId: "account",
        existingThreadId: `cloud-${index}`,
        origin: "automatic" as const,
      },
    },
  }));
  state.chats = state.threads.map((_, index) => chat(`cloud-${index}`));
  state.params = { cloudThreadId: "cloud-19", cloudEnvironmentId: "env" };
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(11);
  expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
    "/env/scan-19",
  );
  expect(container.querySelector('a[href="/cloud/env/cloud-19"]')).toBeNull();
  expect(container.querySelector('a[href="/env/scan-18"]')).toBeNull();
});

it.each([
  {
    status: "idle" as const,
    latestTurn: { startedAt: 100, completedAt: null },
    runStatus: "completed",
  },
  {
    status: "active" as const,
    latestTurn: { startedAt: null, completedAt: null },
    runStatus: "running",
  },
])(
  "keeps unknown Cloud timing omitted after opening an imported $runStatus turn",
  async ({ status, latestTurn, runStatus }) => {
    state.chats = [{ ...chat("untimed-import"), status, latestTurn }];
    await render(true);
    expect(container.querySelector('[aria-label$="run duration"]')).toBeNull();
    // CloudThreadService uses these fallback timestamps to order imported records.
    // Their presence must not turn an unknown runtime into a measurement.
    const fallbackStart = DateTime.makeUnsafe(100_000);
    state.threads = [
      {
        ...localThread("imported-untimed"),
        runtime: { status: runStatus },
        source: {
          latestRunId: "cloud-run:imported-untimed:external-turn",
          runDestination: {
            accountId: "account",
            existingThreadId: "untimed-import",
            origin: "automatic",
          },
          status: runStatus,
          latestRunStartedAt: fallbackStart,
          latestRunCompletedAt: status === "idle" ? fallbackStart : null,
          activityRunStartedAt: status === "active" ? fallbackStart : null,
        },
      },
    ];
    await render(true);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/env/imported-untimed");
    expect(container.querySelector('[aria-label$="run duration"]')).toBeNull();
    state.cloudError = "Cloud unavailable";
    await render(true);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector('[aria-label$="run duration"]')).toBeNull();
    state.cloudError = null;
    state.chats = [
      {
        ...chat("untimed-import"),
        status: "idle",
        latestTurn: { startedAt: 100, completedAt: 220 },
      },
    ];
    await render(true);
    expect(container.querySelector('[aria-label="Last run duration"]')?.textContent).toBe("2m");
  },
);

it("keeps an imported email review out of Automatic and suppresses its matching cloud row", async () => {
  state.chats = [chat("native")];
  state.threads = [
    {
      ...localThread("email-review"),
      source: {
        automationOrigin: "external",
        hasEmailReview: true,
        runDestination: { accountId: "account", existingThreadId: "native", origin: "automatic" },
      } as (typeof state.threads)[number]["source"],
    },
  ];
  await render(true);
  expect(container.querySelectorAll("a")).toHaveLength(0);
});

it("shows secondary-environment automation once and moves human attention to its normal roster", async () => {
  state.chats = [];
  const secondary = {
    ...localThread("secondary", "other-env"),
    source: { automationOrigin: "external" as const },
  };
  state.threads = [{ ...localThread("primary"), source: { automationOrigin: "t3" } }, secondary];
  await render(true);
  expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
    "/env/primary",
    "/other-env/secondary",
  ]);
  const normal = () =>
    state.threads.filter((t) => !isAutomaticSidebarThread(t as never, false)).map((t) => t.id);
  expect(normal()).toEqual([]);
  for (const attention of [
    { hasEmailReview: true },
    {
      pendingRuntimeRequest: {
        id: "request",
        kind: "user_input",
        createdAt: DateTime.makeUnsafe("2026-10-28T10:00:00Z"),
      },
    },
  ]) {
    state.threads[1] = { ...secondary, source: { ...secondary.source, ...attention } };
    await render(true);
    expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/env/primary",
    ]);
    expect(normal()).toEqual(["secondary"]);
  }
  state.threads[1] = secondary;
  await render(true);
  expect(container.querySelector('a[href="/other-env/secondary"]')).not.toBeNull();
  expect(normal()).toEqual([]);
});
