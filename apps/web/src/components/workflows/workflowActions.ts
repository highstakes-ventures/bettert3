import type { EnvironmentId, WorkflowDecisionInput, WorkflowRun } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { orderRefinementQueue } from "@t3tools/workflows/tickets";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";
import { showThreadUndoNotice } from "~/hooks/showThreadUndoNotice";
import * as ThreadUndo from "~/hooks/threadUndo";
import { toastManager } from "../ui/toast";

export const WORKFLOW_ACTION_EVENT = "t3:ticket-workflow";
// Navigation memory lasts for this page session and is separate for each environment.
export const lastOpenedRefinementRunByEnvironment = new Map<EnvironmentId, string>();
let pendingAction: "ticket" | "refine" | null = null;
export function requestWorkflowAction(action: "ticket" | "refine") {
  pendingAction = action;
  window.dispatchEvent(new CustomEvent(WORKFLOW_ACTION_EVENT, { detail: action }));
}

// A closed mobile sidebar mounts its controls after the action opens the sheet.
export function takeWorkflowAction() {
  const action = pendingAction;
  pendingAction = null;
  return action;
}

/** Keep the original position when a decision removes the current ticket or its dependents. */
export function nextRefinementRun(
  runs: ReadonlyArray<WorkflowRun>,
  currentRunId: string,
  eligibleRuns = runs,
) {
  const current = runs.findIndex((run) => run.id === currentRunId);
  const eligible = new Map(
    eligibleRuns.filter((run) => run.threadId !== null).map((run) => [run.id, run]),
  );
  for (let offset = 1; offset <= runs.length; offset++) {
    const run = eligible.get(runs[(current + offset) % runs.length]!.id);
    if (run) return run;
  }
}

type TicketDecision = {
  environmentId: EnvironmentId;
  runId: string;
  decision: WorkflowDecisionInput["decision"];
  stagedAt: string;
  result?: WorkflowRun;
};

// Ephemeral on purpose. Reloading during the Undo window cancels the decision.
export const useWorkflowDecisions = create<{ decisions: ReadonlyArray<TicketDecision> }>(() => ({
  decisions: [],
}));

export function refinementQueueWithPendingDecisions(
  environmentId: EnvironmentId,
  runs: ReadonlyArray<WorkflowRun>,
  receipts = useWorkflowDecisions.getState().decisions,
) {
  const decisions = receipts.filter((entry) => entry.environmentId === environmentId);
  if (decisions.length === 0) return runs.filter((run) => run.phase === "review");
  const projected = runs.flatMap((run) => {
    const entry = decisions.find((entry) => entry.runId === run.id);
    if (!entry) return [run];
    if (entry.result) return [run.updatedAt > entry.result.updatedAt ? run : entry.result];
    return entry.decision === "delay" ? [{ ...run, delayedAt: entry.stagedAt }] : [];
  });
  const eligible = new Set(orderRefinementQueue(projected, Date.now()).map((run) => run.id));
  // The server owns ordering. Locally project eligibility without changing that order.
  return projected.filter((run) => eligible.has(run.id));
}

export function useRefinementQueue(environmentId: EnvironmentId, runs: ReadonlyArray<WorkflowRun>) {
  const decisions = useWorkflowDecisions((state) => state.decisions);
  return refinementQueueWithPendingDecisions(environmentId, runs, decisions);
}

export function hasPendingWorkflowDecision(
  environmentId: EnvironmentId,
  run: WorkflowRun,
  decisions = useWorkflowDecisions.getState().decisions,
) {
  const entry = decisions.find(
    (entry) => entry.environmentId === environmentId && entry.runId === run.id,
  );
  if (!entry) return false;
  if (!entry.result) return true;
  if (run.updatedAt > entry.result.updatedAt) return false;
  // A delayed ticket can be revisited once this detail has acknowledged the save.
  return run.phase !== entry.result.phase || run.delayedAt !== entry.result.delayedAt;
}

/** Stages one decision and lets the existing Undo notice own its commit timer. */
export function stageWorkflowDecision(options: {
  environmentId: EnvironmentId;
  run: WorkflowRun;
  decision: WorkflowDecisionInput["decision"];
  commit: () => Promise<AtomCommandResult<WorkflowRun, unknown>>;
  restore: () => Promise<void>;
}) {
  const { environmentId, run, decision } = options;
  if (run.phase !== "review" || hasPendingWorkflowDecision(environmentId, run)) return false;
  const previous = useWorkflowDecisions
    .getState()
    .decisions.find((item) => item.environmentId === environmentId && item.runId === run.id);
  const entry: TicketDecision = {
    environmentId,
    runId: run.id,
    decision,
    stagedAt: new Date().toISOString(),
  };
  useWorkflowDecisions.setState((state) => ({
    decisions: [
      ...state.decisions.filter(
        (item) => item.environmentId !== environmentId || item.runId !== run.id,
      ),
      entry,
    ],
  }));
  const remove = () =>
    useWorkflowDecisions.setState((state) => ({
      decisions: state.decisions.flatMap((item) =>
        item !== entry ? [item] : previous ? [previous] : [],
      ),
    }));
  const restore = async () => {
    remove();
    await options.restore();
  };
  showThreadUndoNotice({
    action: decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Delayed",
    group: false,
    claim: ThreadUndo.begin("ticket-decision", JSON.stringify([environmentId, run.id])),
    failureTitle: "Could not reopen ticket",
    undo: async () => {
      await restore();
      return AsyncResult.success(undefined);
    },
    commit: () => {
      const reportFailure = (error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not save ticket decision",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      void (async () => {
        let result;
        try {
          result = await options.commit();
        } catch (error) {
          reportFailure(error);
        }
        if (
          !result ||
          result._tag !== "Success" ||
          (result.value.phase === "review" && decision !== "delay") ||
          result.value.phase === "approving" ||
          result.value.phase === "rejecting"
        ) {
          await restore();
        } else {
          // Retain one receipt per ticket for this page session. Independent query caches
          // can still lag after another consumer acknowledges the save. Newer server
          // revisions take precedence, and a later decision replaces this receipt.
          useWorkflowDecisions.setState((state) => ({
            decisions: state.decisions.map((item) =>
              item === entry ? { ...entry, result: result.value } : item,
            ),
          }));
        }
      })().catch(reportFailure);
    },
  });
  return true;
}
