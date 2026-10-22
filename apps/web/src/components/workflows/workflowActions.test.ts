import { EnvironmentId, ProjectId, ThreadId, type WorkflowRun } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { undoLatestThreadAction, useThreadUndoNotice } from "~/hooks/showThreadUndoNotice";
import {
  refinementQueueWithPendingDecisions,
  stageWorkflowDecision,
  useWorkflowDecisions,
} from "./workflowActions";

const environment = EnvironmentId.make("first");
const otherEnvironment = EnvironmentId.make("second");
const run = (id: string): WorkflowRun => ({
  id,
  projectId: ProjectId.make("project"),
  kind: "tickets",
  phase: "review",
  title: id,
  priority: 3,
  blockerIds: [],
  threadId: ThreadId.make(`chat-${id}`),
  implementationThreadId: null,
  issueId: id,
  error: null,
  createdAt: "2026-10-21",
  updatedAt: "2026-10-21",
});
const stage = (id: string, environmentId = environment) => {
  const commit = vi.fn(async () => AsyncResult.success({ ...run(id), phase: "approved" as const }));
  const restore = vi.fn(async () => {});
  const options = { environmentId, run: run(id), decision: "approve" as const, commit, restore };
  expect(stageWorkflowDecision(options)).toBe(true);
  return { commit, restore, options };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
});
afterEach(async () => {
  await vi.runAllTimersAsync();
  useWorkflowDecisions.setState({ decisions: [] });
  vi.useRealTimers();
});

it("undoes consecutive ticket approvals individually, then commits only the remaining decision", async () => {
  const first = stage("first");
  const second = stage("second");
  expect(useThreadUndoNotice.getState().notice?.count).toBe(1);
  expect(undoLatestThreadAction()).toBe(true);
  expect(second.restore).toHaveBeenCalledOnce();
  expect(first.restore).not.toHaveBeenCalled();
  expect(
    refinementQueueWithPendingDecisions(environment, [run("first"), run("second")]).map(
      (entry) => entry.id,
    ),
  ).toEqual(["second"]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(first.commit).toHaveBeenCalledOnce();
  expect(second.commit).not.toHaveBeenCalled();
});

it("isolates identical run IDs across environments and prevents duplicate staging", async () => {
  const first = stage("same");
  expect(refinementQueueWithPendingDecisions(otherEnvironment, [run("same")])).toEqual([
    run("same"),
  ]);
  expect(stageWorkflowDecision(first.options)).toBe(false);
  const second = stage("same", otherEnvironment);
  await useThreadUndoNotice.getState().notice!.undo();
  expect(first.restore).not.toHaveBeenCalled();
  expect(second.restore).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(first.commit).toHaveBeenCalledOnce();
  expect(second.commit).not.toHaveBeenCalled();
});

it("keeps a decision out of the queue while its save is in flight and restores it on failure", async () => {
  let finish!: (result: AsyncResult.Success<WorkflowRun>) => void;
  const commit = vi.fn(
    () =>
      new Promise<AsyncResult.Success<WorkflowRun>>((resolve) => {
        finish = resolve;
      }),
  );
  const restore = vi.fn(async () => {});
  const options = {
    environmentId: environment,
    run: run("current"),
    decision: "approve" as const,
    commit,
    restore,
  };
  expect(stageWorkflowDecision(options)).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(undoLatestThreadAction()).toBe(false);
  expect(stageWorkflowDecision(options)).toBe(false);
  expect(refinementQueueWithPendingDecisions(environment, [run("current")])).toEqual([]);
  finish(AsyncResult.success(run("current")));
  await Promise.resolve();
  expect(restore).toHaveBeenCalledOnce();
  expect(refinementQueueWithPendingDecisions(environment, [run("current")])).toEqual([
    run("current"),
  ]);
});

it("blocks a stale duplicate after saving but accepts a newer review revision", async () => {
  const first = stage("current");
  await vi.advanceTimersByTimeAsync(5_000);
  expect(stageWorkflowDecision(first.options)).toBe(false);
  const newer = { ...run("current"), updatedAt: "2026-10-23" };
  expect(refinementQueueWithPendingDecisions(environment, [newer])).toEqual([newer]);
  expect(stageWorkflowDecision({ ...first.options, run: newer })).toBe(true);
  expect(useWorkflowDecisions.getState().decisions).toHaveLength(1);
  await useThreadUndoNotice.getState().notice!.undo();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(first.commit).toHaveBeenCalledOnce();
});

it("allows a saved delay to expire and be refined again in the same page session", async () => {
  const delayed = {
    ...run("current"),
    delayedAt: new Date().toISOString(),
    updatedAt: "2026-10-22T12:00:00Z",
  };
  const options = {
    environmentId: environment,
    run: run("current"),
    decision: "delay" as const,
    commit: vi.fn(async () => AsyncResult.success(delayed)),
    restore: vi.fn(async () => {}),
  };
  expect(stageWorkflowDecision(options)).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(refinementQueueWithPendingDecisions(environment, [delayed])).toEqual([]);
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  expect(refinementQueueWithPendingDecisions(environment, [delayed])).toEqual([delayed]);
  expect(stageWorkflowDecision({ ...options, run: delayed, decision: "approve" })).toBe(true);
  await useThreadUndoNotice.getState().notice!.undo();
});
