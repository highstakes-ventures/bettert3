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
  resolveInboxThreadSection,
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

describe("inbox activity sections", () => {
  const options = { hasTimer: false, workingShelfEnabled: true };
  const running = thread("active", true);
  const waiting = { ...running, runtime: { ...running.runtime!, status: "idle" as const } };

  it("moves stopped background work and explicit thread waits to Waiting", () => {
    expect(resolveInboxThreadSection(running, options)).toBe("working");
    expect(resolveInboxThreadSection(waiting, options)).toBe("timer");
    expect(resolveInboxThreadSection({ ...running, blockedOnThreadWait: true }, options)).toBe(
      "timer",
    );
    expect(resolveInboxThreadSection(running, { ...options, workingShelfEnabled: false })).toBe(
      "active",
    );
    expect(resolveInboxThreadSection(waiting, { ...options, workingShelfEnabled: false })).toBe(
      "timer",
    );
    expect(resolveInboxThreadSection({ ...waiting, runtime: null }, options)).toBe("active");
    expect(
      resolveInboxThreadSection({ ...waiting, runtime: null }, { ...options, hasTimer: true }),
    ).toBe("timer");
  });

  it("keeps attention requests and errors in the inbox even with a timer", () => {
    for (const attention of [
      { ...waiting, hasPendingApprovals: true },
      { ...waiting, hasPendingUserInput: true },
      { ...waiting, pendingSubagentRequest: "user_input" as const },
      { ...waiting, interactionMode: "plan" as const, hasActionableProposedPlan: true },
      { ...waiting, runtime: { ...waiting.runtime, status: "failed" as const } },
    ]) {
      expect(resolveInboxThreadSection(attention, { ...options, hasTimer: true })).toBe("active");
    }
  });
});

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
});

describe("sortWorkingThreadsBySend", () => {
  it("orders by the last message the user sent, not by later runs", () => {
    const sentFirst = {
      ...thread("sent-first", true),
      latestUserAuthoredMessageAt: "2026-06-01T01:00:00.000Z",
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
    const launched = { ...thread("launched", true), latestUserAuthoredMessageAt: null };
    expect(
      sortWorkingThreadsBySend([launched, sentFirst, sentLast]).map((thread) => thread.id),
    ).toEqual(["sent-last", "sent-first", "launched"]);
  });
});
