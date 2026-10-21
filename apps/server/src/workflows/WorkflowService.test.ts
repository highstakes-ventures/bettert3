import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkflowError,
  type WorkflowConfiguration,
  type WorkflowTicket,
  type WorkflowTicketDraft,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Linear from "./LinearClient.ts";
import * as Workflow from "./WorkflowService.ts";

const projectId = ProjectId.make("test-project");
const configuration: WorkflowConfiguration = {
  projectId,
  linearTeamId: "team",
  intakeProjectId: "intake",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "approval-required",
  baseBranch: "main",
  performanceEnabled: false,
  refactorEnabled: false,
};
const projects = [
  { id: "intake", name: "Backlog", teamIds: ["team"], initiatives: [] },
  { id: "target", name: "Building", teamIds: ["team"], initiatives: ["Building"] },
];
const connection = {
  connected: true,
  teams: [
    {
      id: "team",
      name: "Team",
      labels: [],
      refinedStateId: "refined",
      canceledStateId: "canceled",
      completedStateId: "done",
    },
  ],
  projects,
};
const makeTicket = (id: string): WorkflowTicket => ({
  id,
  identifier: `REC-${id}`,
  title: id,
  url: `https://linear.app/issue/${id}`,
  stateType: "unstarted",
  stateId: "todo",
  updatedAt: "revision-1",
  description: "## Problem\nConcrete request",
  teamId: "team",
  project: projects[0]!,
  priority: 3,
  estimate: null,
  dueDate: null,
  labels: [],
  blockedBy: [],
  blocks: [],
  comments: [],
  resources: [],
});
const draft: WorkflowTicketDraft = {
  title: "Implement a concrete change",
  description: "## Problem\nA concrete problem",
  targetProjectId: "intake",
  priority: 3,
  labelIds: [],
  blockedBy: [],
  dependencyEvidence: [],
};
const commit = "a".repeat(40);

const harness = Effect.gen(function* () {
  const tickets = new Map<string, WorkflowTicket>();
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const decisions: string[] = [];
  const gitCalls: ReadonlyArray<string>[] = [];
  const switches = {
    failDecision: false,
    loseDecisionResponse: false,
    editDuringDecision: false,
    loseSaveResponse: false,
    failLaunch: false,
    ancestry: true,
    saves: 0,
  };
  const deps = Layer.mergeAll(
    Sqlite.layerMemory,
    NodeCrypto.layer,
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Project",
            workspaceRoot: "/fixture",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: "2026-10-20T00:00:00Z",
            updatedAt: "2026-10-20T00:00:00Z",
            deletedAt: null,
          }),
        ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
    Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.gen(function* () {
          if (switches.failLaunch)
            return yield* new ThreadLaunch.ThreadLaunchError({
              operation: "create-thread",
              commandId: input.commandId,
              projectId: input.projectId,
              cause: "offline",
            });
          if (!launches.some((entry) => entry.commandId === input.commandId)) launches.push(input);
          // The workflow consumes launch completion, not the projection returned to other callers.
          return { threadId: input.threadId!, resumed: false, projection: undefined! };
        }),
    }),
    Layer.mock(ProcessRunner.ProcessRunner)({
      run: (input) =>
        Effect.sync(() => {
          gitCalls.push(input.args);
          return {
            code: ChildProcessSpawner.ExitCode(
              input.args[0] === "merge-base" && !switches.ancestry ? 1 : 0,
            ),
            stdout: input.args[0] === "rev-parse" ? commit + "\n" : "",
            stderr: "",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }),
    }),
    Layer.mock(Linear.LinearClient)({
      connected: Effect.succeed(true),
      connection: () => Effect.succeed(connection),
      read: (id) =>
        Effect.suspend(() =>
          tickets.has(id)
            ? Effect.succeed(tickets.get(id)!)
            : Effect.fail(new WorkflowError({ message: "Unknown ticket" })),
        ),
      save: ({ id, draft: value }) =>
        Effect.gen(function* () {
          switches.saves++;
          const next = {
            ...(tickets.get(id) ?? makeTicket(id)),
            title: value.title,
            description: value.description,
            priority: value.priority,
            project: projects.find((entry) => entry.id === value.targetProjectId) ?? null,
            blockedBy: value.blockedBy.map((key) => tickets.get(key)!),
            updatedAt: `save-${switches.saves}`,
          };
          tickets.set(id, next);
          if (switches.loseSaveResponse) {
            switches.loseSaveResponse = false;
            return yield* new WorkflowError({ message: "Save response lost" });
          }
          return next;
        }),
      decide: (id, stateId, target) =>
        Effect.gen(function* () {
          if (switches.failDecision)
            return yield* new WorkflowError({ message: "Linear unavailable" });
          decisions.push(stateId);
          const next = {
            ...tickets.get(id)!,
            project:
              target === undefined
                ? tickets.get(id)!.project
                : (projects.find((entry) => entry.id === target) ?? null),
            ...(switches.editDuringDecision ? { description: "Concurrent unapproved scope" } : {}),
            stateId,
            stateType:
              stateId === "done" ? "completed" : stateId === "canceled" ? "canceled" : "unstarted",
            updatedAt: `decision-${decisions.length}`,
          };
          tickets.set(id, next);
          if (switches.loseDecisionResponse) {
            switches.loseDecisionResponse = false;
            return yield* new WorkflowError({ message: "Response lost" });
          }
          return next;
        }),
    }),
  );
  const context = yield* Layer.build(deps);
  const restart = () =>
    Workflow.WorkflowService.pipe(Effect.provide(Workflow.layer), Effect.provideContext(context));
  const service = yield* restart();
  yield* service.configure(configuration);
  const prepare = (id: string, value = draft, existingIssueId?: string) =>
    Effect.gen(function* () {
      yield* service.intake({ projectId, requestId: id, text: `Request ${id}` });
      yield* service.resume();
      const run = (yield* service.list(projectId)).runs.find((entry) => entry.id === id)!;
      return yield* service.submitResult(run.threadId!, {
        type: "prepared",
        ticket: value,
        ...(existingIssueId
          ? { existingIssueId, expectedUpdatedAt: tickets.get(existingIssueId)!.updatedAt }
          : {}),
      });
    });
  return { service, restart, prepare, tickets, launches, decisions, gitCalls, switches, context };
});

it.effect("persists one intake and one preparation task across retries and restart", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.service.intake({ projectId, requestId: "idea", text: "One request" });
    yield* h.service.intake({ projectId, requestId: "idea", text: "One request" });
    yield* h.service.resume();
    const restored = yield* h.restart();
    yield* restored.resume();
    expect(h.launches).toHaveLength(1);
    expect((yield* restored.list(projectId)).runs).toHaveLength(1);
    expect(h.launches[0]?.initialMessage?.text).toContain("t3_workflow_read");
  }).pipe(Effect.scoped),
);

it.effect("rejects by canceling in the original project and removing the review entry", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    yield* h.service.decide({
      runId: run.id,
      decision: "reject",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    expect(h.decisions).toEqual(["canceled"]);
    expect(h.tickets.get(ticket.id)?.project?.id).toBe("intake");
    expect(
      (yield* h.service.list(projectId)).runs.filter((entry) => entry.phase === "review"),
    ).toEqual([]);
    yield* h.service.resume();
    expect(h.launches).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect.each(["completed", "canceled", "started"])(
  "starts implementation only for completed prerequisites (%s)",
  (stateType) =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.tickets.set("blocker", { ...makeTicket("blocker"), stateType });
      const run = yield* h.prepare("dependent", {
        ...draft,
        blockedBy: ["blocker"],
        dependencyEvidence: [{ issueId: "blocker", kind: "external" }],
      });
      const ticket = (yield* h.service.read(run.id)).ticket!;
      yield* h.service.decide({
        runId: run.id,
        decision: "approve",
        expectedUpdatedAt: ticket.updatedAt,
        targetProjectId: "target",
      });
      yield* h.service.resume();
      const restored = yield* h.restart();
      yield* restored.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(stateType === "completed" ? 1 : 0);
      expect(h.tickets.get(ticket.id)?.project?.id).toBe("target");
      if (stateType === "completed")
        expect(h.gitCalls[0]).toEqual([
          "fetch",
          "origin",
          "refs/heads/main:refs/remotes/origin/main",
        ]);
    }).pipe(Effect.scoped),
);

it.effect("waits for code prerequisites to exist on the fetched implementation base", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    h.switches.ancestry = false;
    h.tickets.set("blocker", { ...makeTicket("blocker"), stateType: "completed" });
    const run = yield* h.prepare("dependent", {
      ...draft,
      blockedBy: ["blocker"],
      dependencyEvidence: [{ issueId: "blocker", kind: "code", commit }],
    });
    const ticket = (yield* h.service.read(run.id)).ticket!;
    yield* h.service.decide({
      runId: run.id,
      decision: "approve",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    yield* h.service.resume();
    expect(h.launches).toHaveLength(1);
    h.switches.ancestry = true;
    yield* h.service.resume();
    expect(h.launches).toHaveLength(2);
  }).pipe(Effect.scoped),
);

it.effect("withdraws a pending approval if the native project changed while offline", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    h.switches.failDecision = true;
    yield* h.service
      .decide({
        runId: run.id,
        decision: "approve",
        expectedUpdatedAt: ticket.updatedAt,
        targetProjectId: "target",
      })
      .pipe(Effect.flip);
    h.tickets.set(ticket.id, { ...ticket, project: null, updatedAt: "external-edit" });
    h.switches.failDecision = false;
    yield* (yield* h.restart()).resume();
    expect((yield* h.service.list(projectId)).runs[0]?.phase).toBe("review");
    expect(h.decisions).toEqual([]);
    expect(h.launches).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect("recovers an approval whose Linear response was lost", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    h.switches.loseDecisionResponse = true;
    yield* h.service
      .decide({
        runId: run.id,
        decision: "approve",
        expectedUpdatedAt: ticket.updatedAt,
        targetProjectId: "target",
      })
      .pipe(Effect.flip);
    const restored = yield* h.restart();
    yield* restored.resume();
    yield* restored.resume();
    yield* restored.resume();
    expect(h.launches).toHaveLength(2);
    expect((yield* restored.list(projectId)).runs[0]?.phase).toBe("implementing");
  }).pipe(Effect.scoped),
);

it.effect("returns to refinement if Linear changes scope during approval", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    h.switches.editDuringDecision = true;
    const decided = yield* h.service.decide({
      runId: run.id,
      decision: "approve",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    expect(decided.phase).toBe("review");
    expect((yield* h.service.read(run.id)).ticket?.description).toBe("Concurrent unapproved scope");
    yield* (yield* h.restart()).resume();
    expect(h.launches).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect("rechecks scope after a crash before implementation dispatch", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    yield* h.service.decide({
      runId: run.id,
      decision: "approve",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    h.switches.failLaunch = true;
    yield* h.service.resume();
    const current = h.tickets.get(ticket.id)!;
    h.tickets.set(ticket.id, {
      ...current,
      description: "Unapproved new scope",
      updatedAt: "external",
    });
    h.switches.failLaunch = false;
    yield* (yield* h.restart()).resume();
    expect(h.launches).toHaveLength(1);
    expect((yield* h.service.list(projectId)).runs[0]?.phase).toBe("review");
  }).pipe(Effect.scoped),
);

it.effect("keeps one canonical issue owner when duplicate intakes merge", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const first = yield* h.prepare("first");
    yield* h.prepare("second", draft, first.issueId!);
    const runs = (yield* h.service.list(projectId)).runs;
    expect(runs.filter((entry) => entry.phase === "review")).toHaveLength(1);
    expect(runs.filter((entry) => entry.issueId === first.issueId)).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect(
  "preserves native edits on a persisted merge retry and accepts a freshly read correction",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const first = yield* h.prepare("first");
      h.switches.loseSaveResponse = true;
      yield* h
        .prepare("second", { ...draft, description: "Prepared merge" }, first.issueId!)
        .pipe(Effect.flip);
      const live = h.tickets.get(first.issueId!)!;
      h.tickets.set(live.id, {
        ...live,
        description: "Human's newer scope",
        updatedAt: "human-revision",
      });
      const restored = yield* h.restart();
      yield* restored.resume();
      expect(h.switches.saves).toBe(2);
      expect(h.tickets.get(live.id)?.description).toBe("Human's newer scope");
      const pending = (yield* restored.list(projectId)).runs.find((run) => run.id === "second")!;
      expect(pending.error).toContain("current revision");
      expect((yield* restored.agentRead(pending.threadId!)).detail.ticket?.description).toBe(
        "Human's newer scope",
      );
      yield* restored.submitResult(pending.threadId!, {
        type: "prepared",
        existingIssueId: live.id,
        expectedUpdatedAt: "human-revision",
        ticket: { ...draft, description: "Human's newer scope with the reconciled request" },
      });
      expect(h.tickets.get(live.id)?.description).toBe(
        "Human's newer scope with the reconciled request",
      );
      expect(
        (yield* restored.list(projectId)).runs.filter((run) => run.phase === "review"),
      ).toHaveLength(1);
    }).pipe(Effect.scoped),
);

it.effect("waits for a distinct implementation commit to land before completing Linear", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    yield* h.service.decide({
      runId: run.id,
      decision: "approve",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    yield* h.service.resume();
    const implementation = (yield* h.service.list(projectId)).runs[0]!;
    yield* h.service
      .submitResult(implementation.implementationThreadId!, { type: "implementation", commit })
      .pipe(Effect.flip);
    yield* h.service.submitResult(implementation.implementationThreadId!, {
      type: "implementation",
      commit: "b".repeat(40),
    });
    h.switches.ancestry = false;
    yield* h.service.resume();
    expect(h.decisions).toEqual(["refined"]);
    h.switches.ancestry = true;
    yield* (yield* h.restart()).resume();
    expect(h.decisions).toEqual(["refined", "done"]);
    expect((yield* h.service.list(projectId)).runs[0]?.phase).toBe("done");
  }).pipe(Effect.scoped),
);

it.effect("does not reassign an active workflow to another Linear team", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.prepare("idea");
    const error = yield* h.service
      .configure({ ...configuration, linearTeamId: "other-team" })
      .pipe(Effect.flip);
    expect(error.message).toContain("Finish the active workflows");
    expect((yield* h.service.list(projectId)).configuration?.linearTeamId).toBe("team");
  }).pipe(Effect.scoped),
);

it.effect("blocks stale decisions, cross-task updates, and moved-team writes", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("idea");
    const ticket = (yield* h.service.read(run.id)).ticket!;
    yield* h.service
      .decide({
        runId: run.id,
        decision: "approve",
        expectedUpdatedAt: "old",
        targetProjectId: null,
      })
      .pipe(Effect.flip);
    yield* h.service
      .agentUpdate(ThreadId.make("another-task"), {
        expectedUpdatedAt: ticket.updatedAt,
        ticket: draft,
      })
      .pipe(Effect.flip);
    h.tickets.set(ticket.id, { ...ticket, teamId: "other-team" });
    yield* h.service
      .agentUpdate(run.threadId!, { expectedUpdatedAt: ticket.updatedAt, ticket: draft })
      .pipe(Effect.flip);
    expect(h.decisions).toEqual([]);
    expect(h.switches.saves).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect("launches one fresh task per enabled scanner and local day after resume", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-10-20T04:00:00Z"));
    const h = yield* harness;
    yield* h.service.configure({
      ...configuration,
      performanceEnabled: true,
      refactorEnabled: true,
    });
    yield* TestClock.setTime(Date.parse("2026-10-23T09:00:00Z"));
    yield* h.service.resume();
    yield* (yield* h.restart()).resume();
    expect(h.launches).toHaveLength(2);
    expect((yield* h.service.list(projectId)).runs.map((entry) => entry.id).sort()).toEqual([
      "performance:test-project:2026-10-23",
      "refactor:test-project:2026-10-23",
    ]);
    yield* TestClock.setTime(Date.parse("2026-10-24T09:00:00Z"));
    yield* h.service.resume();
    expect(h.launches).toHaveLength(4);
    expect(new Set(h.launches.map((entry) => entry.threadId)).size).toBe(4);
  }).pipe(Effect.scoped),
);

it.effect("recovers persisted scanner findings without creating duplicate intakes", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-10-20T04:00:00Z"));
    const h = yield* harness;
    yield* h.service.configure({ ...configuration, performanceEnabled: true });
    yield* TestClock.setTime(Date.parse("2026-10-20T08:00:00Z"));
    yield* h.service.resume();
    const scanner = (yield* h.service.list(projectId)).runs[0]!;
    const result = {
      type: "scan",
      findings: [{ key: "slow-query", request: "Fix this slow query" }],
    } as const;
    // Simulate a restart after result acceptance but before inserting findings.
    const sql = yield* Effect.serviceOption(SqlClient.SqlClient).pipe(
      Effect.provideContext(h.context),
    );
    const database = Option.getOrThrow(sql);
    const rows = yield* database<{
      run_json: string;
    }>`SELECT run_json FROM workflow_runs WHERE id = ${scanner.id}`;
    const record = JSON.parse(rows[0]!.run_json);
    record.pendingResult = result;
    record.findingIds = [{ key: "slow-query", id: "durable-finding" }];
    yield* database`UPDATE workflow_runs SET run_json = ${JSON.stringify(record)} WHERE id = ${scanner.id}`;
    const restored = yield* h.restart();
    yield* restored.resume();
    yield* restored.resume();
    expect(
      (yield* restored.list(projectId)).runs.filter((entry) => entry.kind === "tickets"),
    ).toHaveLength(1);
  }).pipe(Effect.scoped),
);
