import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  createInboxReturnTracker,
  createTimerThreadKeysAtom,
  sortWorkingThreadsBySend,
} from "./threadInbox.ts";

const environmentId = EnvironmentId.make("environment-1");

it("tracks enabled timed schedules per environment and removes paused or deleted timers", () => {
  const otherEnvironmentId = EnvironmentId.make("environment-2");
  const sharedThreadId = ThreadId.make("shared");
  const timer = {
    threadId: sharedThreadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 60_000 },
  } as const;
  type Tasks = {
    readonly tasks: ReadonlyArray<Pick<ScheduledTask, "threadId" | "enabled" | "schedule">>;
  };
  const tasks = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(AsyncResult.success<Tasks>({ tasks: [] })),
  );
  const environments = Atom.make<ReadonlyArray<EnvironmentId>>([environmentId, otherEnvironmentId]);
  const timers = createTimerThreadKeysAtom({
    environmentIdsAtom: environments,
    getTasksAtom: tasks,
  });
  const registry = AtomRegistry.make();
  const unmount = registry.mount(timers);
  try {
    registry.set(
      tasks(environmentId),
      AsyncResult.success({
        tasks: [
          timer,
          timer,
          { ...timer, threadId: ThreadId.make("paused"), enabled: false },
          {
            ...timer,
            threadId: ThreadId.make("webhook"),
            schedule: { type: "webhook", signature: null },
          },
          { ...timer, threadId: null },
        ],
      }),
    );
    registry.set(
      tasks(otherEnvironmentId),
      AsyncResult.success({
        tasks: [{ ...timer, schedule: { type: "fixed_time", timeOfDay: "09:00" } }],
      }),
    );
    expect([...registry.get(timers)]).toEqual([
      `${environmentId}:shared`,
      `${otherEnvironmentId}:shared`,
    ]);

    registry.set(
      tasks(environmentId),
      AsyncResult.success({ tasks: [{ ...timer, enabled: false }] }),
    );
    expect([...registry.get(timers)]).toEqual([`${otherEnvironmentId}:shared`]);
    registry.set(tasks(otherEnvironmentId), AsyncResult.success({ tasks: [] }));
    expect(registry.get(timers).size).toBe(0);
    registry.set(tasks(environmentId), AsyncResult.success({ tasks: [timer] }));
    registry.set(environments, [otherEnvironmentId]);
    expect(registry.get(timers).size).toBe(0);
  } finally {
    unmount();
    registry.dispose();
  }
});

function thread(id: string, working: boolean) {
  return {
    id: ThreadId.make(id),
    environmentId,
    createdAt: "2026-06-01T00:00:00.000Z",
    unsettledAt: null,
    latestRun: null,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default" as const,
    runtime: working
      ? {
          status: "running" as const,
          activeRunId: null,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: "Codex",
          lastError: null,
          updatedAt: "2026-06-01T00:00:00.000Z",
        }
      : null,
  };
}

describe("createInboxReturnTracker", () => {
  it("stamps a thread when it stops working, but never on the first observation", () => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", true), thread("b", false)]);
    expect(tracker.returnedAt(thread("a", true))).toBeUndefined();
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();

    tracker.observe([thread("a", false), thread("b", false)]);
    expect(tracker.returnedAt(thread("a", false))).toBeDefined();
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();
  });

  it("forgets deleted threads and resets when the beta turns off", () => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", true), thread("b", true)]);
    tracker.observe([thread("a", false), thread("b", false)]);
    tracker.observe([thread("b", false)]);
    expect(tracker.returnedAt(thread("a", false))).toBeUndefined();
    expect(tracker.returnedAt(thread("b", false))).toBeDefined();

    tracker.observe(null);
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();
    // After a reset the next call is a fresh baseline again.
    tracker.observe([thread("b", true)]);
    tracker.observe([thread("b", false)]);
    expect(tracker.returnedAt(thread("b", false))).toBeDefined();
  });
});

describe("sortWorkingThreadsBySend", () => {
  it("orders by the last message the user sent, not by later runs", () => {
    const sentFirst = {
      ...thread("sent-first", true),
      latestUserAuthoredMessageAt: "2026-06-01T01:00:00.000Z",
      // A wake run requested after the other thread's send.
      latestRun: {
        runId: RunId.make("run:wake"),
        status: "running" as const,
        requestedAt: "2026-06-01T04:00:00.000Z",
        startedAt: "2026-06-01T04:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    };
    const sentLast = {
      ...thread("sent-last", true),
      latestUserAuthoredMessageAt: "2026-06-01T02:00:00.000Z",
    };
    // Launched by an agent: no user message, so creation time is the send.
    const launched = { ...thread("launched", true), latestUserAuthoredMessageAt: null };
    expect(
      sortWorkingThreadsBySend([launched, sentFirst, sentLast]).map((thread) => thread.id),
    ).toEqual(["sent-last", "sent-first", "launched"]);
  });
});
