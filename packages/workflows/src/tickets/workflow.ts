import type { WorkflowRun, WorkflowTicket, WorkflowDependencyEvidence } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { preparationGoal, implementationGoal } from "./goals.ts";

/** The runtime supplies its durable, idempotent task launch operation. */
export function prepare<A, E, R>(
  request: string,
  launch: (goal: string) => Effect.Effect<A, E, R>,
) {
  return launch(`${preparationGoal}\n\nRequest:\n${request}`);
}

export function implement<A, E, R>(
  ticket: WorkflowTicket,
  launch: (goal: string) => Effect.Effect<A, E, R>,
) {
  return launch(
    `${implementationGoal}\n\n${ticket.identifier}: ${ticket.title}\n${ticket.url}\n\n${ticket.description}`,
  );
}

/** Prerequisites precede dependents. Cyclic tickets stay visible for human resolution. */
export function orderRefinementQueue(runs: ReadonlyArray<WorkflowRun>): WorkflowRun[] {
  const waiting = runs.filter((run) => run.kind === "tickets" && run.phase === "review");
  const byIssue = new Map(
    waiting.flatMap((run) => (run.issueId === null ? [] : [[run.issueId, run] as const])),
  );
  const remaining = new Set(waiting.map((run) => run.id));
  const result: WorkflowRun[] = [];
  const compare = (a: WorkflowRun, b: WorkflowRun) =>
    (a.priority || 5) - (b.priority || 5) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id);
  while (remaining.size > 0) {
    const candidates = waiting
      .filter(
        (run) =>
          remaining.has(run.id) &&
          run.blockerIds.every((id) => {
            const blocker = byIssue.get(id);
            return blocker === undefined || !remaining.has(blocker.id);
          }),
      )
      .sort(compare);
    if (candidates.length === 0) {
      result.push(...waiting.filter((run) => remaining.has(run.id)).sort(compare));
      break;
    }
    const next = candidates[0]!;
    remaining.delete(next.id);
    result.push(next);
  }
  return result;
}

export function ticketApprovalKey(ticket: WorkflowTicket): string {
  return JSON.stringify({
    title: ticket.title,
    description: ticket.description,
    projectId: ticket.project?.id ?? null,
    priority: ticket.priority,
    labels: ticket.labels.map((label) => label.id).sort(),
    blockedBy: ticket.blockedBy.map((issue) => issue.id).sort(),
  });
}

export function refinementQuestions(
  ticket: WorkflowTicket,
  runs: ReadonlyArray<WorkflowRun>,
  evidence: ReadonlyArray<WorkflowDependencyEvidence>,
  dependencies: ReadonlyArray<WorkflowTicket> = [],
): string[] {
  const graph = new Map(
    runs.filter((run) => run.issueId !== null).map((run) => [run.issueId!, run.blockerIds]),
  );
  const managed = new Set(graph.keys());
  for (const dependency of dependencies)
    graph.set(
      dependency.id,
      dependency.blockedBy.map((issue) => issue.id),
    );
  graph.set(
    ticket.id,
    ticket.blockedBy.map((issue) => issue.id),
  );
  const reachesTicket = (id: string, seen: Set<string>): boolean => {
    if (id === ticket.id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (graph.get(id) ?? []).some((blocker) => reachesTicket(blocker, seen));
  };
  const questions: string[] = [];
  if (ticket.blockedBy.some((blocker) => reachesTicket(blocker.id, new Set())))
    questions.push("Resolve the dependency cycle before approval.");
  for (const blocker of ticket.blockedBy) {
    if (!managed.has(blocker.id) && !evidence.some((entry) => entry.issueId === blocker.id))
      questions.push(
        `Classify ${blocker.identifier} as a code or external prerequisite in chat before approval.`,
      );
  }
  return questions;
}
