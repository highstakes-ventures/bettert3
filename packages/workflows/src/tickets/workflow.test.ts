import { describe, expect, it } from "vite-plus/test";
import { ProjectId, type WorkflowRun, type WorkflowTicket } from "@t3tools/contracts";
import { orderRefinementQueue, refinementQuestions, ticketApprovalKey } from "./workflow.ts";
const run = (id: string, blockers: string[] = [], priority = 3): WorkflowRun => ({
  id,
  issueId: id,
  blockerIds: blockers,
  priority,
  projectId: ProjectId.make("project"),
  kind: "tickets",
  phase: "review",
  title: id,
  threadId: null,
  implementationThreadId: null,
  error: null,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
});
const ticket: WorkflowTicket = {
  id: "ticket",
  identifier: "REC-1",
  title: "Ticket",
  url: "https://linear.app/issue/REC-1",
  stateType: "unstarted",
  stateId: "todo",
  updatedAt: "now",
  description: "Problem",
  teamId: "team",
  project: null,
  priority: 3,
  estimate: null,
  dueDate: null,
  labels: [],
  blockedBy: [],
  blocks: [],
  comments: [],
  resources: [],
};

describe("refinement ordering and approval", () => {
  it("moves delayed tickets and their dependents behind ready work while preserving dependencies", () =>
    expect(
      orderRefinementQueue([
        { ...run("delayed", [], 1), delayedAt: "2026-10-21T09:00:00Z" },
        run("dependent", ["delayed"], 1),
        { ...run("older-delay", [], 4), delayedAt: "2026-10-20T09:00:00Z" },
        run("ready", [], 4),
      ]).map((entry) => entry.id),
    ).toEqual(["ready", "older-delay", "delayed", "dependent"]));
  it("puts prerequisites first even when their dependents have higher priority", () =>
    expect(
      orderRefinementQueue([
        run("c", ["b"], 1),
        run("b", ["a"], 2),
        run("a", [], 4),
        run("d", [], 3),
      ]).map((entry) => entry.id),
    ).toEqual(["d", "a", "b", "c"]));
  it("keeps cycle members visible and excludes approved work from the counter", () =>
    expect(
      orderRefinementQueue([
        run("a", ["b"]),
        run("b", ["a"]),
        { ...run("done"), phase: "approved" },
      ]).map((entry) => entry.id),
    ).toEqual(["a", "b"]));
  it("detects a dependency cycle through several tickets", () =>
    expect(
      refinementQuestions(
        { ...ticket, blockedBy: [{ ...ticket, id: "b" }] },
        [run("b", ["c"]), run("c", [ticket.id])],
        [],
      ),
    ).toContain("Resolve the dependency cycle before approval."));
  it("requires explicit classification of unmanaged prerequisites", () => {
    const blocked = { ...ticket, blockedBy: [{ ...ticket, id: "external", identifier: "REC-2" }] };
    expect(refinementQuestions(blocked, [], [])).toHaveLength(1);
    expect(refinementQuestions(blocked, [], [{ issueId: "external", kind: "external" }])).toEqual(
      [],
    );
  });
  it("invalidates approval on scope, target, labels or dependency changes", () => {
    const key = ticketApprovalKey(ticket);
    for (const changed of [
      { ...ticket, description: "New scope" },
      { ...ticket, project: { id: "another", name: "Another", teamIds: [], initiatives: [] } },
      { ...ticket, labels: [{ id: "label", name: "Feature" }] },
      { ...ticket, blockedBy: [{ ...ticket, id: "blocker" }] },
    ])
      expect(ticketApprovalKey(changed)).not.toBe(key);
    expect(
      ticketApprovalKey({
        ...ticket,
        comments: [{ id: "comment", body: "Thanks", author: "Joe", createdAt: "now" }],
      }),
    ).toBe(key);
  });
});
