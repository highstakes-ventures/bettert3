import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { planPinnedMove } from "@t3tools/client-runtime/state/thread-sort";
import {
  createPendingThreadOrder,
  createThreadMovePlanner,
  threadOrderAfterMove,
  threadDropLifecycle,
  reconcilePendingThreadOrder,
  type PendingThreadOrder,
  type ThreadMoveAvailability,
} from "./threadOrder";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { makeRawThreadShell, makeThreadShellFixture } from "../../test-fixtures";
import { threadJumpTarget } from "../keyboard/threadKeyboardShortcuts";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  getThreadListV2OrderedSection,
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2Status,
  resolveThreadListV2WokeAt,
  sortThreadsForListV2,
  threadListV2ListItemsAreEqual,
  threadHasUnseenCompletion,
  type ThreadListV2ListItem,
} from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");
const decodeThreadShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShell);

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return makeThreadShellFixture({
    environmentId,
    ...input,
  });
}

const NOW = "2026-06-02T00:00:00.000Z";

describe("resolveThreadListV2SnoozeMenuSelection", () => {
  it("recomputes presets that remain available instead of using old timestamps", () => {
    const displayedPresets = resolveSnoozePresets(new Date(2026, 4, 8, 10));
    const selectedAt = new Date(2026, 4, 8, 10, 30);
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: "snooze:hour",
      displayedPresets,
      now: selectedAt,
    });

    expect(selection._tag).toBe("selected");
    if (selection._tag === "selected") {
      expect(selection.preset.snoozedUntil).toBe(
        new Date(selectedAt.getTime() + 60 * 60 * 1_000).toISOString(),
      );
    }
  });
});

describe("resolveThreadListV2Status", () => {
  it("presents decoded thread waits as Waiting while preserving requests and older servers", () => {
    const raw = makeRawThreadShell({
      status: "running",
      activeRunId: RunId.make("run-wait"),
      latestRunId: RunId.make("run-wait"),
    });
    const present = (shell: unknown) => presentThreadShell(environmentId, decodeThreadShell(shell));

    expect(resolveThreadListV2Status(present(raw))).toBe("working");
    const blocked = present({ ...raw, blockedOnThreadWait: true });
    expect(
      resolveThreadListV2Status({
        ...blocked,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toBe("approval");
    expect(resolveThreadListV2Status({ ...blocked, hasPendingUserInput: true })).toBe("input");
    expect(resolveThreadListV2Status(blocked)).toBe("waiting");
    expect(resolveThreadListV2Status(present({ ...raw, blockedOnThreadWait: false }))).toBe(
      "working",
    );
  });

  it.each([
    { kind: "command", status: "ready" },
    { kind: "monitor", status: "waiting" },
  ] as const)(
    "presents an unseen completion with a $kind roster as $status",
    ({ kind, status }) => {
      const thread = presentThreadShell(
        environmentId,
        makeRawThreadShell({
          latestRunId: RunId.make("run-background-completion"),
          status: "completed",
          latestRunCompletedAt: DateTime.makeUnsafe(NOW),
          lastVisitedAt: DateTime.makeUnsafe("2026-06-01T23:59:00.000Z"),
          pendingBackgroundTasks: [{ taskId: "background-work", kind }],
        }),
      );

      expect(resolveThreadListV2Status(thread)).toBe(status);
      expect(threadHasUnseenCompletion(thread)).toBe(true);
    },
  );
});

describe("queued messages keep a settled thread active", () => {
  const threads = [
    makeThread({ id: ThreadId.make("active"), title: "Active" }),
    makeThread({ id: ThreadId.make("settled"), title: "Settled", settledOverride: "settled" }),
    makeThread({
      id: ThreadId.make("settled-queued"),
      title: "Settled with outbox",
      settledOverride: "settled",
    }),
  ];
  const queuedThreadKeys = new Set([`${environmentId}:settled-queued`]);

  it("lists the thread in the active block instead of the settled shelf", () => {
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      queuedThreadKeys,
    });
    expect(layout.items.map((item) => [item.thread.id, item.variant] as const)).toEqual([
      ["active", "card"],
      ["settled-queued", "card"],
      ["settled", "slim"],
    ]);
    expect(layout.settledCount).toBe(1);
  });
});

describe("sortThreadsForListV2", () => {
  it("honors a saved active order and leaves new threads above it", () => {
    const sorted = sortThreadsForListV2([
      { id: "newer-arranged", createdAt: "2026-06-01T12:00:00.000Z", activeOrderKey: "t" },
      { id: "older-arranged", createdAt: "2026-06-01T08:00:00.000Z", activeOrderKey: "f" },
      { id: "new", createdAt: "2026-06-01T13:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["new", "older-arranged", "newer-arranged"]);
  });
});

describe("getThreadListV2OrderedSection", () => {
  it("uses each saved order and excludes settled, snoozed, and archived rows", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active-later"), title: "Later", activeOrderKey: "t" }),
      makeThread({ id: ThreadId.make("active-first"), title: "First", activeOrderKey: "f" }),
      makeThread({ id: ThreadId.make("active-new"), title: "New" }),
      makeThread({
        id: ThreadId.make("pinned-later"),
        title: "Pinned later",
        pinnedAt: NOW,
        pinOrderKey: "t",
        activeOrderKey: "f",
      }),
      makeThread({
        id: ThreadId.make("pinned-first"),
        title: "Pinned first",
        pinnedAt: NOW,
        pinOrderKey: "f",
        activeOrderKey: "t",
      }),
      makeThread({ id: ThreadId.make("settled"), title: "Settled", settledOverride: "settled" }),
      makeThread({ id: ThreadId.make("archived"), title: "Archived", archivedAt: NOW }),
      makeThread({
        id: ThreadId.make("snoozed"),
        title: "Snoozed",
        snoozedUntil: "2026-06-03T10:00:00.000Z",
        snoozedAt: NOW,
      }),
      makeThread({
        id: ThreadId.make("pinned-snoozed"),
        title: "Pinned snoozed",
        pinnedAt: NOW,
        snoozedUntil: "2026-06-03T10:00:00.000Z",
        snoozedAt: NOW,
      }),
    ];
    expect(
      getThreadListV2OrderedSection({ threads, section: "active", now: NOW }).map(
        (thread) => thread.id,
      ),
    ).toEqual(["active-new", "active-first", "active-later"]);
    expect(
      getThreadListV2OrderedSection({ threads, section: "pinned", now: NOW }).map(
        (thread) => thread.id,
      ),
    ).toEqual(["pinned-first", "pinned-later"]);
  });
});

describe("buildThreadListV2Items", () => {
  it("hides snoozed threads and counts them — visibility parity with web", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("woken"),
          title: "Woken",
          snoozedUntil: "2026-06-01T18:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "woken"]);
    expect(layout.snoozedCount).toBe(1);
  });

  it("moves a settled pinned thread into the settled shelf — parity with web (#7969)", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-settled"),
          title: "Pinned while settled",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          settledOverride: "settled",
          settledAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "pinned-settled"]);
    expect(layout.items.map((item) => item.pinned)).toEqual([false, false]);
    expect(layout.settledCount).toBe(1);
  });

  it("snooze hides a pinned thread and wake restores it to the pinned block", () => {
    const snoozedInput = {
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-snoozed"),
          title: "Pinned and snoozed",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T11:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
    };

    const whileSnoozed = buildThreadListV2Items({ ...snoozedInput, now: NOW });
    expect(whileSnoozed.items.map((item) => item.thread.id)).toEqual(["active"]);
    expect(whileSnoozed.snoozedCount).toBe(1);

    const afterWake = buildThreadListV2Items({ ...snoozedInput, now: "2026-06-03T10:00:00.000Z" });
    expect(afterWake.items.map((item) => item.thread.id)).toEqual(["pinned-snoozed", "active"]);
    expect(afterWake.items[0]?.pinned).toBe(true);
    expect(afterWake.snoozedCount).toBe(0);
  });

  it("builds snoozed rows between active and settled when the shelf is expanded", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("later"),
          title: "Wakes later",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("sooner"),
          title: "Wakes sooner",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "sooner",
      "later",
      "settled",
    ]);
    expect(layout.items.map((item) => item.snoozed)).toEqual([false, true, true, false]);
    expect(layout.snoozedShelfHeaderIndex).toBe(1);
    expect(layout.snoozedCount).toBe(2);
  });

  it("keeps the selected thread on a collapsed shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("open"),
          title: "Open",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("other"),
          title: "Other",
          snoozedUntil: "2026-06-03T10:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      selectedThreadKey: `${environmentId}:open`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["open"]);
    expect(layout.items[0]?.snoozed).toBe(true);
    expect(layout.snoozedCount).toBe(2);
  });

  it("keeps snoozed threads visible on environments without the snooze capability", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      snoozeEnvironmentIds: new Set(),
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["snoozed"]);
    expect(layout.snoozedCount).toBe(0);
  });

  it("partitions settled threads into a slim shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("settled-2"),
          title: "Settled 2",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["active", "card"],
      ["settled", "slim"],
      ["settled-2", "slim"],
    ]);
    expect(layout.items.map((item) => item.isLast)).toEqual([false, false, true]);
    expect(layout.settledCount).toBe(2);
    expect(layout.settledShelfHeaderIndex).toBe(1);
  });

  it("keeps settled threads in the tail and filters by search query", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("match"), title: "Fix login bug" }),
        makeThread({ id: ThreadId.make("miss"), title: "Greeting" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Fix login again",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "login",
      now: NOW,
    });

    expect(items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["match", "card"],
      ["settled", "slim"],
    ]);
  });

  it("scopes the flat list to every environment member of a logical project", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const projectId = ProjectId.make("project-1");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("local"), projectId, title: "Local" }),
        makeThread({
          environmentId: remoteEnvironmentId,
          id: ThreadId.make("remote"),
          projectId,
          title: "Remote",
        }),
      ],
      environmentId: null,
      projectRefs: [
        { environmentId, projectId },
        { environmentId: remoteEnvironmentId, projectId },
      ],
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["local", "remote"]);
  });
});

describe("buildThreadListV2Items settled paging", () => {
  it("caps the settled tail at settledLimit and reports the hidden count", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active"), title: "Active" }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeThread({
          id: ThreadId.make(`settled-${index}`),
          title: `Settled ${index}`,
          settledOverride: "settled",
          settledAt: `2026-06-01T0${index}:10:00.000Z`,
          latestUserMessageAt: `2026-06-01T0${index}:00:00.000Z`,
          latestRun: {
            runId: RunId.make(`run-${index}`),
            status: "completed",
            requestedAt: `2026-06-01T0${index}:00:00.000Z`,
            startedAt: `2026-06-01T0${index}:00:00.000Z`,
            completedAt: `2026-06-01T0${index}:10:00.000Z`,
            assistantMessageId: null,
          },
        }),
      ),
    ];

    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      settledLimit: 2,
      now: NOW,
    });

    expect(layout.hiddenSettledCount).toBe(2);
    expect(layout.items.filter((item) => item.variant === "slim")).toHaveLength(2);
    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "settled-3",
      "settled-2",
    ]);
  });
});

describe("buildThreadListV2Items settled sort reuse", () => {
  const otherEnvironmentId = EnvironmentId.make("environment-2");

  function makeSettled(
    id: string,
    settledAt: string,
    overrides: Partial<EnvironmentThreadShell> = {},
  ): EnvironmentThreadShell {
    return makeThread({
      id: ThreadId.make(id),
      title: id,
      settledOverride: "settled",
      settledAt,
      ...overrides,
    });
  }

  function settledOrder(
    threads: ReadonlyArray<EnvironmentThreadShell>,
    scope: EnvironmentId | null = null,
  ) {
    return buildThreadListV2Items({
      threads,
      environmentId: scope,
      searchQuery: "",
      now: NOW,
    })
      .items.filter((item) => item.variant === "slim")
      .map((item) => `${item.thread.environmentId}:${item.thread.id}`);
  }

  const older = makeSettled("older", "2026-06-01T01:00:00.000Z");
  const newer = makeSettled("newer", "2026-06-01T03:00:00.000Z");
  const middle = makeSettled("middle", "2026-06-01T02:00:00.000Z");

  it("re-sorts when a settled row is replaced, added, or removed", () => {
    expect(settledOrder([older, newer])).toEqual([
      `${environmentId}:newer`,
      `${environmentId}:older`,
    ]);
    const resettledOlder = makeSettled("older", "2026-06-01T04:00:00.000Z");
    expect(settledOrder([resettledOlder, newer])).toEqual([
      `${environmentId}:older`,
      `${environmentId}:newer`,
    ]);
    expect(settledOrder([resettledOlder, newer, middle])).toEqual([
      `${environmentId}:older`,
      `${environmentId}:newer`,
      `${environmentId}:middle`,
    ]);
    expect(settledOrder([newer, middle])).toEqual([
      `${environmentId}:newer`,
      `${environmentId}:middle`,
    ]);
  });

  it("recomputes when builds alternate between environments", () => {
    const remoteOlder = makeSettled("remote-older", "2026-06-01T01:30:00.000Z", {
      environmentId: otherEnvironmentId,
    });
    const remoteNewer = makeSettled("remote-newer", "2026-06-01T05:00:00.000Z", {
      environmentId: otherEnvironmentId,
    });
    const threads = [older, newer, remoteOlder, remoteNewer];

    for (let round = 0; round < 2; round += 1) {
      expect(settledOrder(threads, environmentId)).toEqual([
        `${environmentId}:newer`,
        `${environmentId}:older`,
      ]);
      expect(settledOrder(threads, otherEnvironmentId)).toEqual([
        `${otherEnvironmentId}:remote-newer`,
        `${otherEnvironmentId}:remote-older`,
      ]);
    }
  });
});

function makePendingTask(id: string): PendingNewTask {
  const creation = {
    projectId: ProjectId.make("project-1"),
    workspaceMode: "worktree" as const,
    branch: null,
    worktreePath: null,
  };
  return {
    kind: "pending",
    key: `pending-task:${id}`,
    environmentId,
    projectId: creation.projectId,
    projectTitle: undefined,
    projectCwd: undefined,
    branch: null,
    title: id,
    createdAt: NOW,
    message: {
      environmentId,
      threadId: ThreadId.make(`thread-${id}`),
      messageId: MessageId.make(id),
      commandId: CommandId.make(`command-${id}`),
      text: id,
      attachments: [],
      createdAt: NOW,
      creation,
    },
    creation,
  };
}

describe("buildThreadListV2ListItems", () => {
  const layout = buildThreadListV2Items({
    threads: [
      makeThread({ id: ThreadId.make("active"), title: "active" }),
      makeThread({
        id: ThreadId.make("settled"),
        title: "settled",
        settledOverride: "settled",
        settledAt: NOW,
      }),
    ],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });

  it("leads the list with unsent drafts and queued tasks, preserving section dividers", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [
        {
          kind: "draft",
          key: "draft-task:new-task:unsent",
          environmentId,
          projectId: ProjectId.make("project-1"),
          projectTitle: undefined,
          projectCwd: undefined,
          branch: null,
          title: "unsent",
          createdAt: NOW,
          draftKey: "new-task:unsent",
          draft: {
            text: "unsent",
            attachments: [],
            project: { environmentId, projectId: ProjectId.make("project-1"), createdAt: NOW },
          },
        },
        makePendingTask("queued-1"),
        makePendingTask("queued-2"),
      ],
      settledCount: layout.settledCount,
      settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    });

    expect(
      items.map((item) =>
        item.type === "v2-pending"
          ? item.pendingTask.title
          : item.type === "v2-thread"
            ? item.item.thread.id
            : item.type === "v2-snoozed-shelf"
              ? "snoozed-shelf"
              : "settled-shelf",
      ),
    ).toEqual(["unsent", "queued-1", "queued-2", "active", "settled-shelf", "settled"]);
    expect(
      items.flatMap((item) => (item.type === "v2-pending" ? [item.showPendingDivider] : [])),
    ).toEqual([true, false, false]);
    expect(
      items.map((item) =>
        item.type === "v2-thread" || item.type === "v2-pending" ? item.showTrailingDivider : null,
      ),
    ).toEqual([true, true, true, false, null, false]);
  });

  it("places queued tasks above active rows and a collapsed snoozed shelf", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [makePendingTask("queued")],
      snoozedCount: snoozedLayout.snoozedCount,
      snoozedShelfExpanded: false,
      snoozedShelfHeaderIndex: snoozedLayout.snoozedShelfHeaderIndex,
      settledCount: snoozedLayout.settledCount,
      settledShelfHeaderIndex: snoozedLayout.settledShelfHeaderIndex,
    });

    expect(items.map((item) => item.type)).toEqual([
      "v2-pending",
      "v2-thread",
      "v2-snoozed-shelf",
      "v2-settled-shelf",
      "v2-thread",
    ]);
    expect(threadJumpTarget(items, "thread.jump.1")?.id).toBe("active");
    expect(threadJumpTarget(items, "thread.jump.2")?.id).toBe("settled");
    expect(threadJumpTarget(items, "thread.jump.3")).toBeNull();
  });
});

describe("pending mobile thread moves", () => {
  function fixture(section: "active" | "pinned" = "active") {
    const rows = ["a", "b", "c"].map((id, index) =>
      makeThread({
        id: ThreadId.make(id),
        title: id === "a" ? "hidden" : "match",
        createdAt: `2026-06-01T0${3 - index}:00:00.000Z`,
        pinnedAt: section === "pinned" ? `2026-06-01T0${3 - index}:00:00.000Z` : null,
      }),
    );
    const ordered = getThreadListV2OrderedSection({ threads: rows, section, now: NOW });
    const orderedIds = ordered.map((row) => `${row.environmentId}:${row.id}`);
    const movedId = orderedIds[2]!;
    const assignments = planPinnedMove({
      orderedIds,
      keysById: new Map(orderedIds.map((id) => [id, null])),
      movedId,
      direction: "up",
    })!;
    const pending = createPendingThreadOrder({
      section,
      ordered,
      movedId,
      direction: "up",
      assignments,
    });
    const update = (current: EnvironmentThreadShell[], assignment: (typeof assignments)[number]) =>
      current.map((row) =>
        `${row.environmentId}:${row.id}` === assignment.id
          ? {
              ...row,
              [section === "pinned" ? "pinOrderKey" : "activeOrderKey"]: assignment.orderKey,
            }
          : row,
      );
    return { rows, assignments, pending, update };
  }

  function layout(
    rows: EnvironmentThreadShell[],
    pendingOrder: PendingThreadOrder | null,
    searchQuery = "",
  ) {
    return buildThreadListV2Items({
      threads: rows,
      pendingOrder,
      environmentId: null,
      searchQuery,
      now: NOW,
    }).items.map((item) => item.thread.id);
  }

  it.each(["active", "pinned"] as const)(
    "holds %s order through every intermediate key upsert",
    (section) => {
      const { rows, assignments, pending, update } = fixture(section);
      let current = rows;
      let hold: PendingThreadOrder | null = pending;
      const desired = pending.orderedIds.map((id) => id.split(":")[1]);
      expect(layout(current, hold)).toEqual(desired);
      for (const assignment of assignments) {
        current = update(current, assignment);
        hold = reconcilePendingThreadOrder(
          hold!,
          getThreadListV2OrderedSection({ threads: current, section, now: NOW }),
        );
        expect(hold).not.toBeNull();
        expect(layout(current, hold)).toEqual(desired);
      }
      expect(reconcilePendingThreadOrder({ ...hold!, commandsComplete: true }, current)).toBeNull();
      expect(layout(current, null)).toEqual(desired);
    },
  );

  it("keeps the action guard pending when receipts precede canonical shells", () => {
    const { rows, assignments, pending, update } = fixture();
    let hold: PendingThreadOrder | null = { ...pending, commandsComplete: true };
    let current = rows;
    expect(reconcilePendingThreadOrder(hold, current)).toBe(hold);
    for (const [index, assignment] of assignments.entries()) {
      current = update(current, assignment);
      hold = reconcilePendingThreadOrder(hold!, current);
      expect(hold === null).toBe(index === assignments.length - 1);
      expect(layout(current, hold)).toEqual(["a", "c", "b"]);
    }
  });

  it("releases for real section membership and foreign key changes", () => {
    const { rows, pending } = fixture();
    expect(reconcilePendingThreadOrder(pending, rows.slice(1))).toBeNull();
    const newRow = makeThread({ id: ThreadId.make("new"), title: "new" });
    expect(reconcilePendingThreadOrder(pending, [...rows, newRow])).toBeNull();
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row, index) => (index === 0 ? { ...row, activeOrderKey: "zz" } : row)),
      ),
    ).toBeNull();
    const settled = rows.map((row, index) =>
      index === 0 ? { ...row, settledOverride: "settled" as const } : row,
    );
    expect(layout(settled, pending)).toEqual(layout(settled, null));
  });

  it("does not hide a concurrent return to a previously confirmed key", () => {
    const { rows, assignments, pending, update } = fixture();
    const confirmed = reconcilePendingThreadOrder(pending, update(rows, assignments[0]!))!;
    expect(reconcilePendingThreadOrder(confirmed, rows)).toBeNull();
  });

  it("preserves the hold for activity but releases for a reopened sort anchor", () => {
    const { rows, pending } = fixture();
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row) => ({ ...row, updatedAt: NOW })),
      ),
    ).toBe(pending);
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row, index) => (index === 0 ? { ...row, unsettledAt: NOW } : row)),
      ),
    ).toBeNull();
  });
});

describe("mobile move availability", () => {
  const oldEnvironment = EnvironmentId.make("older-server");
  function rows(section: "active" | "pinned", keys: readonly (string | null)[]) {
    return keys.map((key, index) =>
      makeThread({
        id: ThreadId.make(`move-${index}`),
        title: `Move ${index}`,
        environmentId: index === 1 ? oldEnvironment : environmentId,
        activeOrderKey: section === "active" ? key : null,
        pinOrderKey: section === "pinned" ? key : null,
        pinnedAt: section === "pinned" ? NOW : null,
      }),
    );
  }

  it.each(["active", "pinned"] as const)(
    "keeps unsupported keyed %s neighbors as usable anchors",
    (section) => {
      const ordered = rows(section, ["bb", "dd", "ff"]);
      const plan = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      });
      const assignments = plan(`${environmentId}:move-0`, "down");
      expect(assignments).toHaveLength(1);
      expect(assignments![0]!.id).toBe(`${environmentId}:move-0`);
      expect(assignments![0]!.orderKey > "dd").toBe(true);
      expect(assignments![0]!.orderKey < "ff").toBe(true);
      expect(plan(`${oldEnvironment}:move-1`, "up")).toBeNull();
      expect(plan(`${environmentId}:move-0`, "up")).toBeNull();
    },
  );

  it.each(["active", "pinned"] as const)(
    "disables %s moves requiring unsupported keyless materialization",
    (section) => {
      const ordered = rows(section, [null, null, null]);
      const plan = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      });
      expect(plan(`${environmentId}:move-0`, "down")).toBeNull();
      expect(plan(`${environmentId}:move-2`, "up")).toBeNull();
      const supported = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId, oldEnvironment]),
      });
      expect(supported(`${environmentId}:move-0`, "down")).toHaveLength(3);
    },
  );

  it.each(["active", "pinned"] as const)(
    "reserves snoozed %s keys when moving visible rows",
    (section) => {
      const ordered = rows(section, ["bb", "dd", "ff"]);
      const input = { ordered, section, reorderableEnvironmentIds: new Set([environmentId]) };
      const collision = createThreadMovePlanner(input)(`${environmentId}:move-0`, "down")![0]!
        .orderKey;
      const hidden = {
        ...ordered[0]!,
        id: ThreadId.make("snoozed"),
        snoozedAt: NOW,
        snoozedUntil: "2099-01-01T00:00:00.000Z",
        pinOrderKey: section === "pinned" ? collision : null,
        activeOrderKey: section === "active" ? collision : null,
      };
      const assignments = createThreadMovePlanner({ ...input, allThreads: [...ordered, hidden] })(
        `${environmentId}:move-0`,
        "down",
      );
      expect(assignments).toHaveLength(1);
      expect(assignments![0]!.orderKey).not.toBe(collision);
      expect(assignments![0]!.orderKey > "dd" && assignments![0]!.orderKey < "ff").toBe(true);
    },
  );
});

describe("thread drag destinations", () => {
  it("moves across multiple rows while keeping hidden anchors in place", () => {
    expect(
      threadOrderAfterMove(["a", "hidden", "b", "c"], "c", {
        targetId: "a",
        placement: "before",
      }),
    ).toEqual(["c", "a", "hidden", "b"]);
    expect(
      threadOrderAfterMove(["a", "hidden", "b", "c"], "a", {
        targetId: "b",
        placement: "after",
      }),
    ).toEqual(["hidden", "b", "a", "c"]);
  });

  it.each(["active", "pinned"] as const)(
    "persists a dropped %s row and holds its order until confirmed",
    (section) => {
      const ordered = ["a", "b", "c", "d"].map((id) =>
        makeThread({
          id: ThreadId.make(id),
          title: id,
          pinnedAt: section === "pinned" ? NOW : null,
        }),
      );
      const ids = ordered.map((row) => `${row.environmentId}:${row.id}`);
      const direction = { targetId: ids[0]!, placement: "before" as const };
      const assignments = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      })(ids[3]!, direction)!;
      const pending = createPendingThreadOrder({
        section,
        ordered,
        movedId: ids[3]!,
        direction,
        assignments,
      });
      expect(pending.orderedIds).toEqual([ids[3], ids[0], ids[1], ids[2]]);
      const confirmed = ordered.map((row) => ({
        ...row,
        [section === "pinned" ? "pinOrderKey" : "activeOrderKey"]: assignments.find(
          (a) => a.id === `${row.environmentId}:${row.id}`,
        )!.orderKey,
      }));
      expect(
        getThreadListV2OrderedSection({ threads: confirmed, section, now: NOW }).map(
          (row) => `${row.environmentId}:${row.id}`,
        ),
      ).toEqual(pending.orderedIds);
      expect(
        reconcilePendingThreadOrder({ ...pending, commandsComplete: true }, confirmed),
      ).toBeNull();
    },
  );

  it("refuses a drop that would need to rewrite an old server's keyless row", () => {
    const old = EnvironmentId.make("old-server");
    const ordered = [environmentId, old, environmentId].map((env, index) =>
      makeThread({
        id: ThreadId.make(String(index)),
        title: String(index),
        environmentId: env,
      }),
    );
    expect(
      createThreadMovePlanner({
        ordered,
        section: "active",
        reorderableEnvironmentIds: new Set([environmentId]),
      })(`${environmentId}:2`, { targetId: `${environmentId}:0`, placement: "before" }),
    ).toBeNull();
  });
});

it("allows a long drop past an old server even when both adjacent moves fail", () => {
  const old = EnvironmentId.make("old-server");
  const ordered = [
    makeThread({ id: ThreadId.make("a"), title: "a" }),
    makeThread({ id: ThreadId.make("b"), title: "b", environmentId: old }),
    makeThread({ id: ThreadId.make("c"), title: "c", activeOrderKey: "h" }),
    makeThread({ id: ThreadId.make("d"), title: "d", activeOrderKey: "p" }),
  ];
  const planner = createThreadMovePlanner({
    ordered,
    section: "active",
    reorderableEnvironmentIds: new Set([environmentId]),
  });
  const movedId = `${environmentId}:a`;
  expect(planner(movedId, "up")).toBeNull();
  expect(planner(movedId, "down")).toBeNull();
  const assignments = planner(movedId, { targetId: `${environmentId}:d`, placement: "after" });
  expect(assignments).toHaveLength(1);
  expect(assignments![0]!.id).toBe(movedId);
  expect(assignments![0]!.orderKey > "p").toBe(true);
});

describe("cross-section thread drops", () => {
  it.each(["pinned", "active"] as const)("inserts into an empty %s section", (section) => {
    const thread = makeThread({ id: ThreadId.make("source"), title: "source" });
    const id = `${thread.environmentId}:${thread.id}`;
    const destination = { section, targetId: null, placement: "before" as const };
    expect(threadOrderAfterMove([], id, destination)).toEqual([id]);
    const plan = createThreadMovePlanner({
      ordered: [],
      allThreads: [thread],
      section,
      reorderableEnvironmentIds: new Set([environmentId]),
    })(id, destination);
    expect(plan).toHaveLength(1);
    expect(plan![0]!.id).toBe(id);
  });
  it("places an incoming row between existing anchors without rewriting them", () => {
    const a = makeThread({ id: ThreadId.make("a"), title: "a", pinOrderKey: "h" });
    const b = makeThread({ id: ThreadId.make("b"), title: "b", pinOrderKey: "z" });
    const source = makeThread({ id: ThreadId.make("source"), title: "source" });
    const id = `${environmentId}:source`;
    const destination = {
      section: "pinned" as const,
      targetId: `${environmentId}:b`,
      placement: "before" as const,
    };
    const plan = createThreadMovePlanner({
      ordered: [a, b],
      allThreads: [a, b, source],
      section: "pinned",
      reorderableEnvironmentIds: new Set([environmentId]),
    })(id, destination);
    expect(plan).toHaveLength(1);
    expect(plan![0]!.orderKey > "h" && plan![0]!.orderKey < "z").toBe(true);
    expect(
      threadOrderAfterMove([`${environmentId}:a`, `${environmentId}:b`], id, destination),
    ).toEqual([`${environmentId}:a`, id, `${environmentId}:b`]);
  });
  it("rejects removed targets and unsupported incoming sources", () => {
    expect(
      threadOrderAfterMove(["a"], "source", {
        section: "active",
        targetId: "gone",
        placement: "before",
      }),
    ).toBeNull();
    const source = makeThread({ id: ThreadId.make("source"), title: "source" });
    expect(
      createThreadMovePlanner({
        ordered: [],
        allThreads: [source],
        section: "active",
        reorderableEnvironmentIds: new Set(),
      })(`${environmentId}:source`, { section: "active", targetId: null, placement: "before" }),
    ).toBeNull();
  });
  it("clears pinning, settlement and snooze when returning a parked thread to Active", () => {
    const thread = makeThread({
      id: ThreadId.make("parked"),
      title: "parked",
      pinnedAt: NOW,
      settledOverride: "settled",
      snoozedAt: NOW,
      snoozedUntil: "2099-01-01T00:00:00.000Z",
    });
    expect(threadDropLifecycle(thread, "active", NOW)).toEqual({
      pin: false,
      unpin: true,
      unsettle: true,
      unsnooze: true,
    });
    expect(threadDropLifecycle(thread, "pinned", NOW)).toEqual({
      pin: true,
      unpin: false,
      unsettle: false,
      unsnooze: false,
    });
  });
});

it("excludes subagents from navigation, search and ordering while retaining user forks", () => {
  const root = makeThread({ id: ThreadId.make("root"), title: "Root" });
  const child = makeThread({
    id: ThreadId.make("child"),
    title: "Child",
    lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "subagent" },
  });
  const fork = makeThread({
    id: ThreadId.make("fork"),
    title: "Fork",
    lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "fork" },
  });
  const workflow = {
    ...root,
    id: ThreadId.make("scan"),
    source: { ...root.source, backgroundWorkflowId: "daily-scan" },
  };
  const automatic = {
    ...root,
    id: ThreadId.make("automatic"),
    source: { ...root.source, automationOrigin: "t3" as const },
  };
  const external = {
    ...root,
    id: ThreadId.make("external"),
    source: { ...root.source, automationOrigin: "external" as const },
  };
  const threads = [root, child, fork, workflow, automatic, external];
  expect(
    buildThreadListV2Items({ threads, environmentId: null, searchQuery: "", now: NOW }).items.map(
      (item) => item.thread.id,
    ),
  ).toEqual([fork.id, root.id]);
  expect(
    buildThreadListV2Items({ threads, environmentId: null, searchQuery: "Child", now: NOW }).items,
  ).toEqual([]);
  expect(
    getThreadListV2OrderedSection({ threads, section: "active", now: NOW }).map(
      (thread) => thread.id,
    ),
  ).toEqual([fork.id, root.id]);
});

const BASE_MS = Date.parse(NOW);
const isoAt = (ms: number) => new Date(ms).toISOString();
const MINUTE_MS = 60_000;

function buildTickList(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  clockMs: number,
  pendingTasks: ReadonlyArray<PendingNewTask>,
  options?: {
    readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
    readonly queuedThreadKeys?: ReadonlySet<string>;
    readonly moveAvailability?: ReadonlyMap<string, ThreadMoveAvailability>;
    readonly shelfPreferencesLoading?: boolean;
  },
): ThreadListV2ListItem[] {
  const now = isoAt(clockMs);
  const layout = buildThreadListV2Items({
    threads,
    environmentId: null,
    searchQuery: "",
    now,
    snoozedShelfExpanded: true,
  });
  return buildThreadListV2ListItems({
    items: layout.items,
    pendingTasks,
    snoozedCount: layout.snoozedCount,
    snoozedShelfExpanded: true,
    snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
    settledCount: layout.settledCount,
    settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    snoozeLabelNow: now,
    ...(options?.snoozeEnvironmentIds
      ? { snoozeEnvironmentIds: options.snoozeEnvironmentIds }
      : {}),
    ...(options?.queuedThreadKeys ? { queuedThreadKeys: options.queuedThreadKeys } : {}),
    ...(options?.moveAvailability ? { moveAvailability: options.moveAvailability } : {}),
    ...(options?.shelfPreferencesLoading !== undefined
      ? { shelfPreferencesLoading: options.shelfPreferencesLoading }
      : {}),
  });
}

function itemsByThreadKey(items: ReadonlyArray<ThreadListV2ListItem>) {
  const byKey = new Map<string, ThreadListV2ListItem>();
  for (const item of items) byKey.set(item.key, item);
  return byKey;
}

describe("threadListV2ListItemsAreEqual", () => {
  const thread = makeThread({
    id: ThreadId.make("eq"),
    title: "eq",
    latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
  });
  const layout = buildThreadListV2Items({
    threads: [thread],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });
  const queued = makePendingTask("eq-queued");
  const build = () =>
    buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [queued],
      snoozeLabelNow: NOW,
    });

  it("treats rebuilt wrappers over identical rows as equal", () => {
    const first = build();
    const second = build();
    expect(first.length).toBe(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).not.toBe(second[index]);
      expect(threadListV2ListItemsAreEqual(first[index]!, second[index]!)).toBe(true);
    }
  });

  it("notices a changed wake countdown label", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("wake"),
          title: "wake",
          snoozedAt: NOW,
          snoozedUntil: isoAt(BASE_MS + 61 * MINUTE_MS),
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
    });
    const earlier = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [],
      snoozedShelfExpanded: true,
      snoozeLabelNow: NOW,
    });
    const later = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [],
      snoozedShelfExpanded: true,
      snoozeLabelNow: isoAt(BASE_MS + MINUTE_MS),
    });
    const rows = (items: ThreadListV2ListItem[]) => {
      const row = items.find((item) => item.key === `v2-thread:${environmentId}:wake`);
      expect(row?.type).toBe("v2-thread");
      if (row?.type !== "v2-thread") throw new Error("missing snoozed row");
      return row;
    };
    expect(rows(earlier).snoozeWakeLabelText).toBe("2h");
    expect(rows(later).snoozeWakeLabelText).toBe("1h");
    expect(threadListV2ListItemsAreEqual(rows(earlier), rows(later))).toBe(false);
  });

  it("notices a trailing-divider flip caused by a neighbour change", () => {
    const threadA = makeThread({ id: ThreadId.make("flip-a"), title: "flip a" });
    const threadB = makeThread({ id: ThreadId.make("flip-b"), title: "flip b" });
    const bare = buildThreadListV2ListItems({
      items: buildThreadListV2Items({
        threads: [threadA, threadB],
        environmentId: null,
        searchQuery: "",
        now: NOW,
      }).items,
      pendingTasks: [],
      snoozeLabelNow: NOW,
    });
    const settledB = makeThread({
      id: ThreadId.make("flip-b"),
      title: "flip b",
      settledOverride: "settled",
      settledAt: NOW,
    });
    const withSettled = buildThreadListV2ListItems({
      items: buildThreadListV2Items({
        threads: [threadA, settledB],
        environmentId: null,
        searchQuery: "",
        now: NOW,
      }).items,
      pendingTasks: [],
      settledCount: 1,
      settledShelfHeaderIndex: 1,
      snoozeLabelNow: NOW,
    });
    const firstA = bare[0]!;
    const secondA = withSettled[0]!;
    expect(firstA.type === "v2-thread" && firstA.showTrailingDivider).toBe(true);
    expect(secondA.type === "v2-thread" && secondA.showTrailingDivider).toBe(false);
    expect(threadListV2ListItemsAreEqual(firstA, secondA)).toBe(false);
  });
});

describe("thread list Woke marker", () => {
  const wokeAt = isoAt(BASE_MS - MINUTE_MS);
  const thread = makeThread({
    id: ThreadId.make("woke"),
    title: "Woke",
    latestUserMessageAt: isoAt(BASE_MS - 90 * MINUTE_MS),
    snoozedAt: isoAt(BASE_MS - 60 * MINUTE_MS),
    snoozedUntil: wokeAt,
    lastVisitedAt: null,
  });

  it("keeps a timer wake through a plain visit until acknowledgement reaches its timestamp", () => {
    expect(resolveThreadListV2WokeAt(thread, { now: NOW })).toBe(wokeAt);
    expect(
      resolveThreadListV2WokeAt(
        { ...thread, lastVisitedAt: isoAt(BASE_MS - 30 * MINUTE_MS) },
        { now: NOW },
      ),
    ).toBe(wokeAt);
    expect(
      resolveThreadListV2WokeAt({ ...thread, lastVisitedAt: wokeAt }, { now: NOW }),
    ).toBeNull();
    expect(resolveThreadListV2WokeAt({ ...thread, lastVisitedAt: "invalid" }, { now: NOW })).toBe(
      wokeAt,
    );
  });

  it("stays hidden while snoozed, after settling, and on servers without visited tracking", () => {
    expect(resolveThreadListV2WokeAt(thread, { now: isoAt(BASE_MS - 2 * MINUTE_MS) })).toBeNull();
    expect(
      resolveThreadListV2WokeAt({ ...thread, settledOverride: "settled" }, { now: NOW }),
    ).toBeNull();
    expect(
      resolveThreadListV2WokeAt({ ...thread, lastVisitedAt: undefined }, { now: NOW }),
    ).toBeNull();
    expect(resolveThreadListV2WokeAt({ ...thread, snoozedUntil: null }, { now: NOW })).toBeNull();
  });

  it("keeps an early failure wake acknowledged after the scheduled time passes", () => {
    const completedAt = isoAt(BASE_MS - 2 * MINUTE_MS);
    const failed = makeThread({
      ...thread,
      snoozedUntil: isoAt(BASE_MS + MINUTE_MS),
      runtime: {
        status: "failed",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: "Run failed",
        updatedAt: completedAt,
      },
      latestRun: {
        runId: RunId.make("woke-run"),
        status: "failed",
        requestedAt: isoAt(BASE_MS - 3 * MINUTE_MS),
        startedAt: isoAt(BASE_MS - 3 * MINUTE_MS),
        completedAt,
        assistantMessageId: null,
      },
    });
    expect(resolveThreadListV2WokeAt(failed, { now: NOW })).toBe(completedAt);
    expect(
      resolveThreadListV2WokeAt(
        { ...failed, lastVisitedAt: completedAt },
        { now: isoAt(BASE_MS + 2 * MINUTE_MS) },
      ),
    ).toBeNull();
  });

  it("updates a recycled row at the wake boundary even without a new shell or minute tick", () => {
    const waking = { ...thread, snoozedUntil: isoAt(BASE_MS + 30_000) };
    const layout = (now: string) =>
      buildThreadListV2Items({
        threads: [waking],
        environmentId: null,
        searchQuery: "",
        now,
        snoozeEnvironmentIds: new Set<EnvironmentId>(),
      });
    const list = (now: string) =>
      buildThreadListV2ListItems({
        items: layout(now).items,
        pendingTasks: [],
        snoozeLabelNow: isoAt(BASE_MS),
      });
    const before = list(NOW)[0]!;
    const after = list(isoAt(BASE_MS + 37_500))[0]!;
    expect(before.type === "v2-thread" && before.item.wokeAt).toBeNull();
    expect(after.type === "v2-thread" && after.item.wokeAt).toBe(waking.snoozedUntil);
    expect(after.type === "v2-thread" && after.timeLabel).toBe("");
    expect(threadListV2ListItemsAreEqual(before, after)).toBe(false);
  });
});

describe("buildThreadListV2ListItems row-state stamps", () => {
  const readyThread = makeThread({
    id: ThreadId.make("stamp-ready"),
    title: "stamp ready",
    latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
  });
  const settledThread = makeThread({
    id: ThreadId.make("stamp-settled"),
    title: "stamp settled",
    settledOverride: "settled",
    settledAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
  });
  const allEnvironments = new Set<EnvironmentId>([environmentId]);

  it("stamps queued outbox messages onto the matching row and notices removal", () => {
    const queued = buildTickList([readyThread, settledThread], BASE_MS, [], {
      queuedThreadKeys: new Set([`${environmentId}:stamp-ready`]),
      snoozeEnvironmentIds: allEnvironments,
    });
    const plain = buildTickList([readyThread, settledThread], BASE_MS, [], {
      queuedThreadKeys: new Set<string>(),
      snoozeEnvironmentIds: allEnvironments,
    });
    const byKey = (items: ThreadListV2ListItem[]) => itemsByThreadKey(items);
    const readyQueued = byKey(queued).get(`v2-thread:${environmentId}:stamp-ready`)!;
    const readyPlain = byKey(plain).get(`v2-thread:${environmentId}:stamp-ready`)!;
    const settledQueued = byKey(queued).get(`v2-thread:${environmentId}:stamp-settled`)!;
    const settledPlain = byKey(plain).get(`v2-thread:${environmentId}:stamp-settled`)!;
    expect(readyQueued.type === "v2-thread" && readyQueued.hasQueuedMessages).toBe(true);
    expect(readyPlain.type === "v2-thread" && readyPlain.hasQueuedMessages).toBe(false);
    expect(threadListV2ListItemsAreEqual(readyQueued, readyPlain)).toBe(false);
    expect(threadListV2ListItemsAreEqual(settledQueued, settledPlain)).toBe(true);
  });

  it("notices move-availability changes on card rows without a shell update", () => {
    const permissive = new Map([
      [`${environmentId}:stamp-ready`, { canMoveUp: true, canMoveDown: true }],
      [`${environmentId}:stamp-settled`, { canMoveUp: true, canMoveDown: true }],
    ]);
    const blocked = new Map([
      [`${environmentId}:stamp-settled`, { canMoveUp: true, canMoveDown: true }],
    ]);
    const open = buildTickList([readyThread, settledThread], BASE_MS, [], {
      moveAvailability: permissive,
      snoozeEnvironmentIds: allEnvironments,
    });
    const closed = buildTickList([readyThread, settledThread], BASE_MS, [], {
      moveAvailability: blocked,
      snoozeEnvironmentIds: allEnvironments,
    });
    const readyOpen = itemsByThreadKey(open).get(`v2-thread:${environmentId}:stamp-ready`)!;
    const readyClosed = itemsByThreadKey(closed).get(`v2-thread:${environmentId}:stamp-ready`)!;
    expect(readyOpen.type === "v2-thread" && readyOpen.canMoveUp).toBe(true);
    expect(readyClosed.type === "v2-thread" && readyClosed.canMoveUp).toBe(false);
    expect(threadListV2ListItemsAreEqual(readyOpen, readyClosed)).toBe(false);
    const settledOpen = itemsByThreadKey(open).get(`v2-thread:${environmentId}:stamp-settled`)!;
    const settledClosed = itemsByThreadKey(closed).get(`v2-thread:${environmentId}:stamp-settled`)!;
    expect(settledOpen.type === "v2-thread" && settledOpen.canMoveUp).toBe(false);
    expect(threadListV2ListItemsAreEqual(settledOpen, settledClosed)).toBe(true);
  });
});

describe("Working section beta", () => {
  const running = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: NOW,
  };
  const finishedAt = (id: string, completedAt: string) =>
    makeThread({
      id: ThreadId.make(id),
      title: id,
      createdAt: "2026-06-01T00:00:00.000Z",
      latestRun: {
        runId: RunId.make(`run-${id}`),
        status: "completed",
        requestedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:00.000Z",
        completedAt,
        assistantMessageId: null,
      },
    });
  const threads = [
    finishedAt("finished-early", "2026-06-01T01:00:00.000Z"),
    finishedAt("finished-late", "2026-06-01T03:00:00.000Z"),
    makeThread({ id: ThreadId.make("working"), title: "working", runtime: running }),
    makeThread({
      id: ThreadId.make("asks-approval"),
      title: "asks-approval",
      createdAt: "2026-06-01T02:00:00.000Z",
      runtime: running,
      hasPendingApprovals: true,
    }),
    makeThread({
      id: ThreadId.make("pinned-working"),
      title: "pinned-working",
      runtime: running,
      pinnedAt: "2026-06-01T00:00:00.000Z",
    }),
  ];
  const build = (input: Partial<Parameters<typeof buildThreadListV2Items>[0]> = {}) =>
    buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      workingShelfEnabled: true,
      ...input,
    });
  const ids = (layout: ReturnType<typeof buildThreadListV2Items>) =>
    layout.items.map((item) => item.thread.id);

  it("places timed chats above Working, preserves parked chats, and returns chats when their timers stop", () => {
    const timed = makeThread({ id: ThreadId.make("timed"), title: "timed" });
    const pinned = makeThread({ ...timed, id: ThreadId.make("pinned"), pinnedAt: NOW });
    const settled = makeThread({
      ...timed,
      id: ThreadId.make("settled"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    const snoozed = makeThread({
      ...timed,
      id: ThreadId.make("snoozed"),
      snoozedAt: NOW,
      snoozedUntil: "2026-06-03T00:00:00.000Z",
    });
    const timerThreadKeys = new Set(
      [timed, pinned, settled, snoozed].map((thread) => `${thread.environmentId}:${thread.id}`),
    );
    const input = { threads: [...threads, timed, pinned, settled, snoozed], timerThreadKeys };
    const collapsed = build(input);
    expect(collapsed.timerCount).toBe(1);
    expect(ids(collapsed)).not.toContain("timed");
    expect(ids(collapsed)).toContain("pinned");
    expect(collapsed.snoozedCount).toBe(1);
    expect(collapsed.settledCount).toBe(1);
    expect(ids(build({ ...input, selectedThreadKey: `${environmentId}:timed` }))).toContain(
      "timed",
    );

    const expanded = build({ ...input, timerShelfExpanded: true, workingShelfExpanded: true });
    const items = buildThreadListV2ListItems({
      items: expanded.items,
      pendingTasks: [],
      timerCount: expanded.timerCount,
      timerShelfExpanded: true,
      timerShelfHeaderIndex: expanded.timerShelfHeaderIndex,
      workingCount: expanded.workingCount,
      workingShelfExpanded: true,
      workingShelfHeaderIndex: expanded.workingShelfHeaderIndex,
      snoozedCount: expanded.snoozedCount,
      snoozedShelfHeaderIndex: expanded.snoozedShelfHeaderIndex,
      settledCount: expanded.settledCount,
      settledShelfHeaderIndex: expanded.settledShelfHeaderIndex,
    });
    const timerIndex = items.findIndex((item) => item.type === "v2-timer-shelf");
    expect(items[timerIndex + 1]).toMatchObject({
      type: "v2-thread",
      item: { thread: { id: "timed" } },
    });
    expect(items[timerIndex + 2]?.type).toBe("v2-working-shelf");
    expect(build({ ...input, timerThreadKeys: new Set() }).timerCount).toBe(0);
    expect(build({ ...input, timerThreadKeys: new Set() }).workingCount).toBe(1);
    expect(build({ ...input, workingShelfEnabled: false }).timerCount).toBe(1);
  });

  it("keeps a scheduled chat out of Timer while it works, then returns it when work ends", () => {
    const timed = makeThread({ id: ThreadId.make("timed"), title: "timed", runtime: running });
    const input = {
      threads: [timed],
      timerThreadKeys: new Set([`${environmentId}:timed`]),
      timerShelfExpanded: true,
      workingShelfExpanded: true,
    };
    const busy = build(input);
    expect(busy.timerCount).toBe(0);
    expect(busy.workingCount).toBe(1);
    expect(ids(busy)).toEqual(["timed"]);
    const betaOff = build({ ...input, workingShelfEnabled: false });
    expect(betaOff.timerCount).toBe(0);
    expect(betaOff.workingCount).toBe(0);
    expect(ids(betaOff)).toEqual(["timed"]);
    const waiting = build({
      ...input,
      threads: [{ ...timed, runtime: { ...running, status: "idle" } }],
    });
    expect(waiting.timerCount).toBe(1);
    expect(waiting.workingCount).toBe(0);
    const stopped = build({ ...input, threads: [{ ...timed, runtime: null }] });
    expect(stopped.timerCount).toBe(1);
    expect(stopped.workingCount).toBe(0);
    expect(ids(stopped)).toEqual(["timed"]);
  });

  it("moves background and thread waits into Waiting and back to Working when activity resumes", () => {
    const active = makeThread({ id: ThreadId.make("active"), title: "active", runtime: running });
    for (const waiting of [
      { ...active, runtime: { ...running, status: "idle" as const } },
      { ...active, blockedOnThreadWait: true },
    ]) {
      const layout = build({
        threads: [waiting],
        timerShelfExpanded: true,
        workingShelfExpanded: true,
      });
      expect(layout.timerCount).toBe(1);
      expect(layout.workingCount).toBe(0);
      expect(ids(layout)).toEqual(["active"]);
      expect(build({ threads: [waiting], workingShelfEnabled: false }).timerCount).toBe(1);
    }
    const resumed = build({
      threads: [active],
      timerShelfExpanded: true,
      workingShelfExpanded: true,
    });
    expect(resumed.timerCount).toBe(0);
    expect(resumed.workingCount).toBe(1);
  });

  it("keeps timed chats with questions, approvals, plans or errors in the inbox", () => {
    const timed = makeThread({ id: ThreadId.make("timed-attention"), title: "timed-attention" });
    for (const attention of [
      { ...timed, runtime: { ...running, status: "idle" as const }, hasPendingApprovals: true },
      { ...timed, hasPendingUserInput: true },
      { ...timed, pendingSubagentRequest: "user_input" as const },
      { ...timed, interactionMode: "plan" as const, hasActionableProposedPlan: true },
      { ...timed, runtime: { ...running, status: "failed" as const } },
    ]) {
      const layout = build({
        threads: [attention],
        timerThreadKeys: new Set([`${environmentId}:timed-attention`]),
        timerShelfExpanded: true,
        workingShelfExpanded: true,
      });
      expect(layout.timerCount).toBe(0);
      expect(layout.workingCount).toBe(0);
      expect(ids(layout)).toEqual(["timed-attention"]);
    }
  });

  it("folds unpinned working threads into a collapsed shelf", () => {
    const layout = build();
    expect(ids(layout)).toEqual([
      "pinned-working",
      "finished-late",
      "asks-approval",
      "finished-early",
    ]);
    expect(layout.workingCount).toBe(1);
    expect(layout.workingShelfHeaderIndex).toBe(4);

    const off = build({ workingShelfEnabled: false });
    expect(ids(off)).toContain("working");
    expect(off.workingCount).toBe(0);
  });

  it("orders the inbox by the latest return this device observed", () => {
    const layout = build({
      inboxReturnAt: (thread) =>
        thread.id === "finished-early" ? Date.parse("2026-06-01T04:00:00.000Z") : undefined,
    });
    expect(ids(layout).slice(1)).toEqual(["finished-early", "finished-late", "asks-approval"]);
  });

  it("places the shelf after queued tasks and before snoozed and settled threads", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({ id: ThreadId.make("working"), title: "working", runtime: running }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          runtime: running,
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      workingShelfEnabled: true,
      workingShelfExpanded: true,
      snoozedShelfExpanded: true,
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued")],
      workingCount: layout.workingCount,
      workingShelfExpanded: true,
      workingShelfHeaderIndex: layout.workingShelfHeaderIndex,
      snoozedCount: layout.snoozedCount,
      snoozedShelfExpanded: true,
      snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
      settledCount: layout.settledCount,
      settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    });
    expect(
      items.map((item) =>
        item.type === "v2-thread"
          ? item.item.thread.id
          : item.type === "v2-pending"
            ? item.pendingTask.title
            : item.type,
      ),
    ).toEqual([
      "queued",
      "active",
      "v2-working-shelf",
      "working",
      "v2-snoozed-shelf",
      "snoozed",
      "v2-settled-shelf",
      "settled",
    ]);
  });
});

describe("project section grouping", () => {
  const project = {
    environmentId,
    id: ProjectId.make("project-test"),
    title: "Platform",
    workspaceRoot: "/platform",
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    sections: [
      { id: "research", name: "Research", color: "violet" as const },
      { id: "build", name: "Build", color: "blue" as const },
    ],
  };
  const thread = (
    id: string,
    sectionId: string | null,
    extra: Partial<EnvironmentThreadShell> = {},
  ) => makeThread({ id: ThreadId.make(id), title: id, projectId: project.id, sectionId, ...extra });
  const threads = [
    thread("build-first", "build"),
    thread("research", "research"),
    thread("build-second", "build"),
    thread("removed", "deleted-section"),
    thread("pinned", "build", { pinnedAt: NOW }),
    thread("snoozed", "build", { snoozedAt: NOW, snoozedUntil: "2026-06-03T00:00:00.000Z" }),
    thread("settled", "research", { settledOverride: "settled", settledAt: NOW }),
  ];
  const layout = buildThreadListV2Items({
    threads,
    environmentId: null,
    searchQuery: "",
    now: NOW,
    snoozedShelfExpanded: true,
    settledShelfExpanded: true,
  });
  const build = (collapsedThreadSections: readonly string[] = []) =>
    buildThreadListV2ListItems({
      ...layout,
      sectionProjects: [project],
      sectionGrouping: true,
      collapsedThreadSections,
      pendingTasks: [makePendingTask("queued")],
      snoozedShelfExpanded: true,
      settledShelfExpanded: true,
    });
  const labels = (items: ThreadListV2ListItem[]) =>
    items.map((item) =>
      item.type === "v2-thread"
        ? item.item.thread.id
        : item.type === "v2-section"
          ? `section:${item.section?.id ?? "none"}`
          : item.type,
    );

  it("groups the active rows and leaves pins and parked shelves outside sections", () => {
    const items = build();
    expect(labels(items)).toEqual([
      "v2-pending",
      "v2-section-view",
      "pinned",
      "section:research",
      "research",
      "section:build",
      "build-first",
      "build-second",
      "section:none",
      "removed",
      "v2-snoozed-shelf",
      "snoozed",
      "v2-settled-shelf",
      "settled",
    ]);
    expect(items.filter((item) => item.type === "v2-thread")).toHaveLength(threads.length);
  });

  it("collapses only the selected project's section and keeps its count", () => {
    const items = build([JSON.stringify([environmentId, project.id, "build"])]);
    expect(labels(items)).not.toContain("build-first");
    expect(labels(items)).not.toContain("build-second");
    expect(labels(items)).toContain("pinned");
    expect(labels(items)).toContain("snoozed");
    expect(labels(items)).toContain("settled");
    expect(
      items.find((item) => item.type === "v2-section" && item.section?.id === "build"),
    ).toMatchObject({ count: 2, collapsed: true });
  });
});
