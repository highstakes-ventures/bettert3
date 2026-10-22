import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  WorkflowError,
  type WorkflowConfiguration,
  type WorkflowTicket,
  type WorkflowTicketDraft,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
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

const shell = (
  id: ThreadId,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  id,
  projectId,
  title: "Implementation",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: configuration.modelSelection,
  runtimeMode: "approval-required",
  interactionMode: "default",
  createdBy: "system",
  creationSource: "server",
  branch: null,
  worktreePath: null,
  lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: RunId.make(`run:${id}`),
  latestRunCompletedAt: null,
  activeRunId: RunId.make(`run:${id}`),
  status: "running",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 1,
  visibleItemCount: 1,
  createdAt: DateTime.makeUnsafe(0),
  updatedAt: DateTime.makeUnsafe(0),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  pinnedAt: null,
  deletedAt: null,
  ...overrides,
});

const harness = Effect.gen(function* () {
  const tickets = new Map<string, WorkflowTicket>();
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const decisions: string[] = [];
  const gitCalls: ReadonlyArray<string>[] = [];
  const shells = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const shellReads: ThreadId[] = [];
  const switches = {
    failDecision: false,
    loseDecisionResponse: false,
    editDuringDecision: false,
    loseSaveResponse: false,
    failLaunch: false,
    ancestry: true,
    baseCommit: commit,
    historicalCommit: null as string | null,
    saves: 0,
    beforeBase: Effect.void,
    beforeUuid: Effect.void,
    beforeSave: Effect.void,
  };
  const deps = Layer.mergeAll(
    Sqlite.layerMemory,
    Layer.effect(
      Crypto.Crypto,
      Effect.gen(function* () {
        const live = yield* Crypto.Crypto;
        return Crypto.Crypto.of({
          ...live,
          randomUUIDv4: () =>
            Effect.suspend(() => switches.beforeUuid.pipe(Effect.andThen(live.randomUUIDv4()))),
        });
      }),
    ).pipe(Layer.provide(NodeCrypto.layer)),
    ServerSettings.layerTest(),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: (id) =>
        Effect.succeed(
          Option.some({
            projectId: id,
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
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (id) =>
        Effect.sync(() => {
          shellReads.push(id);
          return shells.get(id) ?? null;
        }),
    }),
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
        Effect.gen(function* () {
          if (input.args[0] === "rev-parse") yield* switches.beforeBase;
          gitCalls.push(input.args);
          return {
            code: ChildProcessSpawner.ExitCode(
              input.args[0] === "merge-base" &&
                !(input.args[3] === commit && input.args[2] !== commit
                  ? input.args[2] === switches.historicalCommit
                  : switches.ancestry)
                ? 1
                : 0,
            ),
            stdout: input.args[0] === "rev-parse" ? switches.baseCommit + "\n" : "",
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
          yield* switches.beforeSave;
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
  const settings = yield* ServerSettings.ServerSettingsService.pipe(Effect.provideContext(context));
  yield* service.configure(configuration);
  const prepare = (
    id: string,
    value = draft,
    existingIssueId?: string,
    workflowProjectId = projectId,
  ) =>
    Effect.gen(function* () {
      yield* service.intake({ projectId: workflowProjectId, requestId: id, text: `Request ${id}` });
      yield* service.resume();
      const run = (yield* service.list(workflowProjectId)).runs.find((entry) => entry.id === id)!;
      return yield* service.submitResult(run.threadId!, {
        type: "prepared",
        ticket: value,
        ...(existingIssueId
          ? { existingIssueId, expectedUpdatedAt: tickets.get(existingIssueId)!.updatedAt }
          : {}),
      });
    });
  const approve = (id: string) =>
    Effect.gen(function* () {
      const ticket = (yield* service.read(id)).ticket!;
      return yield* service.decide({
        runId: id,
        decision: "approve",
        expectedUpdatedAt: ticket.updatedAt,
        targetProjectId: "target",
      });
    });
  return {
    service,
    restart,
    prepare,
    approve,
    settings,
    shells,
    shellReads,
    tickets,
    launches,
    decisions,
    gitCalls,
    switches,
    context,
  };
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
      targetProjectId: null,
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

it.effect("keeps prepared tickets with no delivery project in intake for refinement", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const run = yield* h.prepare("unresolved", { ...draft, targetProjectId: null });
    const detail = yield* h.service.read(run.id);
    expect(detail.run.phase).toBe("review");
    expect(detail.ticket?.project?.id).toBe("intake");
    expect(h.decisions).toEqual([]);
    expect(h.launches).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect.each([{ targetProjectId: null }, { targetProjectId: "intake" }])(
  "requires a delivery project before approval when the selected target is $targetProjectId",
  ({ targetProjectId }) =>
    Effect.gen(function* () {
      const h = yield* harness;
      const run = yield* h.prepare("unresolved");
      const ticket = (yield* h.service.read(run.id)).ticket!;
      const error = yield* h.service
        .decide({
          runId: run.id,
          decision: "approve",
          expectedUpdatedAt: ticket.updatedAt,
          targetProjectId,
        })
        .pipe(Effect.flip);
      expect(error.message).toContain("delivery project");
      expect((yield* h.service.read(run.id)).run.phase).toBe("review");
      expect(h.tickets.get(ticket.id)).toEqual(ticket);
      expect(h.decisions).toEqual([]);
      yield* h.approve(run.id);
      expect(h.tickets.get(ticket.id)?.project?.id).toBe("target");
      expect(h.decisions).toEqual(["refined"]);
    }).pipe(Effect.scoped),
);

it.effect("hides refinement for five days across restart without changing the Linear ticket", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const first = yield* h.prepare("first");
    yield* h.prepare("second");
    const ticket = (yield* h.service.read(first.id)).ticket!;
    const delayed = yield* h.service.decide({
      runId: first.id,
      decision: "delay",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: null,
    });
    expect(delayed.phase).toBe("review");
    expect(delayed.delayedAt).toBeDefined();
    expect(h.tickets.get(ticket.id)).toEqual(ticket);
    expect(h.decisions).toEqual([]);
    expect(h.switches.saves).toBe(2);
    const restored = yield* h.restart();
    yield* restored.resume();
    expect(
      (yield* restored.list(projectId)).runs
        .filter((run) => run.phase === "review")
        .map((run) => run.id),
    ).toEqual(["second"]);
    expect((yield* restored.read(first.id)).run.delayedAt).toBe(delayed.delayedAt);
    // Activity retains delayed history without returning it to the refinement queue.
    expect((yield* restored.list(projectId, true)).runs.map((run) => run.id)).toEqual([
      "first",
      "second",
    ]);
    yield* TestClock.adjust(5 * 24 * 60 * 60 * 1_000 - 1);
    expect((yield* restored.list(projectId)).runs.map((run) => run.id)).toEqual(["second"]);
    yield* TestClock.adjust(1);
    expect((yield* restored.list(projectId)).runs.map((run) => run.id)).toEqual([
      "second",
      "first",
    ]);
    expect(h.launches).toHaveLength(2);
  }).pipe(Effect.scoped),
);

it.effect(
  "lists one environment refinement queue across repositories while retaining scoped lists",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      const other = ProjectId.make("other-repository");
      yield* h.service.configure({ ...configuration, projectId: other });
      const prerequisite = yield* h.prepare(
        "prerequisite",
        { ...draft, priority: 4 },
        undefined,
        other,
      );
      yield* h.prepare("dependent", { ...draft, priority: 1, blockedBy: [prerequisite.issueId!] });
      const delayed = yield* h.prepare("delayed");
      const ticket = (yield* h.service.read(delayed.id)).ticket!;
      yield* h.service.decide({
        runId: delayed.id,
        decision: "delay",
        expectedUpdatedAt: ticket.updatedAt,
        targetProjectId: "target",
      });
      yield* h.prepare("waiting-on-delayed", { ...draft, blockedBy: [delayed.issueId!] });

      const global = Option.getOrThrow(
        yield* h.service.subscribe(projectId, false, true).pipe(Stream.runHead),
      );
      expect(global.configuration?.projectId).toBe(projectId);
      expect(global.runs.map((run) => [run.id, run.projectId])).toEqual([
        ["prerequisite", other],
        ["dependent", projectId],
      ]);
      expect((yield* h.service.list(other)).runs.map((run) => run.id)).toEqual(["prerequisite"]);
      const withoutConfiguration = yield* h.service.list(
        ProjectId.make("unconfigured"),
        false,
        true,
      );
      expect(withoutConfiguration.configuration).toBeNull();
      expect(withoutConfiguration.runs.map((run) => run.id)).toEqual(["prerequisite", "dependent"]);
      expect((yield* h.service.list(projectId, true, true)).runs).toHaveLength(4);
    }).pipe(Effect.scoped),
);

it.effect("preserves a delayed ticket's deadline when preparation merges new intake into it", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const first = yield* h.prepare("first");
    const ticket = (yield* h.service.read(first.id)).ticket!;
    const delayed = yield* h.service.decide({
      runId: first.id,
      decision: "delay",
      expectedUpdatedAt: ticket.updatedAt,
      targetProjectId: "target",
    });
    yield* TestClock.adjust(24 * 60 * 60 * 1_000);
    yield* h.prepare(
      "duplicate",
      { ...draft, description: "Additional intake evidence" },
      ticket.id,
    );
    expect((yield* h.service.read(first.id)).run.delayedAt).toBe(delayed.delayedAt);
    expect((yield* h.service.list(projectId)).runs.some((run) => run.phase === "review")).toBe(
      false,
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "shares ticket slots across projects, releases idle snoozes, and excludes unrelated chats",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.settings.updateSettings({ ticketImplementationSlots: 1 });
      const other = ProjectId.make("other");
      yield* h.service.configure({ ...configuration, projectId: other });
      for (const [id, target] of [
        ["first", projectId],
        ["second", other],
        ["third", projectId],
      ] as const) {
        yield* h.prepare(id, draft, undefined, target);
        // Approve after all preparation, so preparation sweeps cannot start work early.
      }
      for (const id of ["first", "second", "third"]) yield* h.approve(id);
      for (const id of ["manual-chat", "sales-automation"]) {
        const threadId = ThreadId.make(id);
        h.shells.set(threadId, shell(threadId));
      }
      yield* h.service.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(1);
      const active = (yield* h.service.read("first")).run;
      const id = active.implementationThreadId!;
      h.shells.set(id, shell(id, { snoozedUntil: DateTime.makeUnsafe("2099-01-01T00:00:00Z") }));
      yield* h.service.resume();
      expect((yield* h.service.list(other)).implementationSlots).toEqual({ used: 1, limit: 1 });
      expect((yield* h.service.read("second")).run.phase).toBe("approved");
      expect(h.gitCalls.filter((args) => args[0] === "fetch")).toHaveLength(1);
      h.shells.set(
        id,
        shell(id, {
          activeRunId: null,
          status: "interrupted",
          snoozedUntil: DateTime.makeUnsafe("2099-01-01T00:00:00Z"),
        }),
      );
      const restored = yield* h.restart();
      yield* restored.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(2);
      expect((yield* restored.read("second")).run.phase).toBe("implementing");
      // Resuming an existing chat is allowed to exceed the launch limit.
      h.shells.set(id, shell(id));
      expect((yield* restored.list(projectId)).implementationSlots).toEqual({ used: 2, limit: 1 });
      yield* restored.resume();
      expect((yield* restored.read("third")).run.phase).toBe("approved");
      expect(h.shellReads).not.toContain("manual-chat");
      expect(h.shellReads).not.toContain("sales-automation");
      yield* h.settings.updateSettings({ ticketImplementationSlots: 3 });
      yield* restored.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(3);
      yield* h.settings.updateSettings({ ticketImplementationSlots: 0 });
      yield* h.prepare("paused");
      yield* h.approve("paused");
      yield* restored.resume();
      expect((yield* restored.read("paused")).run.phase).toBe("approved");
      expect((yield* restored.list(projectId)).implementationSlots).toEqual({ used: 3, limit: 0 });
    }).pipe(Effect.scoped),
);

it.effect(
  "keeps failed launch reservations across restart without filling the queue with agents",
  () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.settings.updateSettings({ ticketImplementationSlots: 1 });
      yield* h.prepare("first");
      yield* h.prepare("second");
      yield* h.approve("first");
      yield* h.approve("second");
      h.switches.failLaunch = true;
      yield* h.service.resume();
      expect((yield* h.service.read("first")).run.phase).toBe("implementing");
      expect((yield* h.service.read("second")).run.phase).toBe("approved");
      h.switches.failLaunch = false;
      const restored = yield* h.restart();
      yield* restored.resume();
      yield* restored.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(1);
      expect((yield* restored.list(projectId)).implementationSlots).toEqual({ used: 1, limit: 1 });
    }).pipe(Effect.scoped),
);

it.effect.each(["completed", "failed", "interrupted", "cancelled"] as const)(
  "releases an inactive %s implementation even while a pull request watch remains",
  (status) =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.settings.updateSettings({ ticketImplementationSlots: 1 });
      yield* h.prepare("first");
      yield* h.prepare("second");
      yield* h.approve("first");
      yield* h.approve("second");
      yield* h.service.resume();
      const id = (yield* h.service.read("first")).run.implementationThreadId!;
      h.shells.set(
        id,
        shell(id, {
          status,
          activeRunId: null,
          pendingBackgroundTasks: [
            { taskId: "pr-watch", kind: "monitor" },
            { taskId: "dev-server", kind: "command" },
          ],
        }),
      );
      yield* h.service.resume();
      expect(
        h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree"),
      ).toHaveLength(2);
      expect((yield* h.service.list(projectId)).implementationSlots.used).toBe(1);
    }).pipe(Effect.scoped),
);

it.effect("reserves shared capacity atomically when two projects become ready concurrently", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.settings.updateSettings({ ticketImplementationSlots: 1 });
    const other = ProjectId.make("other");
    yield* h.service.configure({ ...configuration, projectId: other });
    yield* h.prepare("first", draft, undefined, other);
    yield* h.prepare("second");
    yield* h.approve("second");
    const firstAtBase = yield* Deferred.make<void>();
    const secondAtBase = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    h.switches.beforeUuid = Effect.yieldNow;
    let checks = 0;
    h.switches.beforeBase = Effect.gen(function* () {
      yield* Deferred.succeed(++checks === 1 ? firstAtBase : secondAtBase, undefined);
      yield* Deferred.await(release);
    });
    const first = yield* h.service.resume().pipe(Effect.forkChild);
    yield* Deferred.await(firstAtBase);
    yield* h.approve("first");
    const second = yield* h.service.resume().pipe(Effect.forkChild);
    yield* Deferred.await(secondAtBase);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree")).toHaveLength(
      1,
    );
    expect((yield* h.service.list(other)).implementationSlots).toEqual({ used: 1, limit: 1 });
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

it.effect("rejects a merge owned by another project's implementation before changing Linear", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const other = ProjectId.make("other");
    yield* h.service.configure({ ...configuration, projectId: other });
    const first = yield* h.prepare("first");
    yield* h.approve(first.id);
    yield* h.service.resume();
    const ticket = h.tickets.get(first.issueId!)!;
    const saves = h.switches.saves;
    const result = yield* h
      .prepare("second", { ...draft, description: "Unapproved replacement" }, ticket.id, other)
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(h.tickets.get(ticket.id)).toEqual(ticket);
    expect(h.switches.saves).toBe(saves);
    expect((yield* h.service.list(other)).runs.every((run) => run.issueId !== ticket.id)).toBe(
      true,
    );
  }).pipe(Effect.scoped),
);

it.effect("serializes concurrent claims of one external issue across projects", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const other = ProjectId.make("other");
    yield* h.service.configure({ ...configuration, projectId: other });
    const ticket = makeTicket("shared");
    h.tickets.set(ticket.id, ticket);
    for (const [requestId, target] of [
      ["first", projectId],
      ["second", other],
    ] as const)
      yield* h.service.intake({ projectId: target, requestId, text: requestId });
    yield* h.service.resume();
    const runs = [
      ...(yield* h.service.list(projectId)).runs,
      ...(yield* h.service.list(other)).runs,
    ];
    h.switches.beforeSave = Effect.yieldNow;
    const results = yield* Effect.all(
      runs.map((run) =>
        h.service
          .submitResult(run.threadId!, {
            type: "prepared",
            existingIssueId: ticket.id,
            expectedUpdatedAt: ticket.updatedAt,
            ticket: draft,
          })
          .pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    );
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
    expect(h.switches.saves).toBe(1);
    const owners = [
      ...(yield* h.service.list(projectId)).runs,
      ...(yield* h.service.list(other)).runs,
    ].filter((run) => run.issueId === ticket.id);
    expect(owners).toHaveLength(1);
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
    h.switches.baseCommit = "c".repeat(40);
    h.switches.ancestry = true;
    yield* (yield* h.restart()).resume();
    expect(h.decisions).toEqual(["refined", "done"]);
    expect((yield* h.service.list(projectId)).runs[0]?.phase).toBe("done");
  }).pipe(Effect.scoped),
);

it.effect("rejects a historical ancestor of the launch base as implementation evidence", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.prepare("idea");
    yield* h.approve("idea");
    yield* h.service.resume();
    const run = (yield* h.service.read("idea")).run;
    h.switches.historicalCommit = "f".repeat(40);
    const result = yield* h.service
      .submitResult(run.implementationThreadId!, {
        type: "implementation",
        commit: h.switches.historicalCommit,
      })
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    yield* h.service.resume();
    expect((yield* h.service.read("idea")).run.phase).toBe("implementing");
    expect(h.decisions).toEqual(["refined"]);
    // A rejected result must not prevent the agent from reporting its actual work.
    yield* h.service.submitResult(run.implementationThreadId!, {
      type: "implementation",
      commit: "b".repeat(40),
    });
  }).pipe(Effect.scoped),
);

it.effect("keeps a completed ticket's running chat and subagents in capacity until idle", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.settings.updateSettings({ ticketImplementationSlots: 1 });
    yield* h.prepare("first");
    yield* h.prepare("second");
    yield* h.approve("first");
    yield* h.approve("second");
    yield* h.service.resume();
    const id = (yield* h.service.read("first")).run.implementationThreadId!;
    h.shells.set(id, shell(id));
    yield* h.service.submitResult(id, { type: "implementation", commit: "b".repeat(40) });
    h.switches.baseCommit = "c".repeat(40);
    yield* h.service.resume();
    expect((yield* h.service.read("first")).run.phase).toBe("done");
    expect((yield* h.service.list(projectId)).implementationSlots.used).toBe(1);
    expect((yield* h.service.read("second")).run.phase).toBe("approved");
    h.shells.set(
      id,
      shell(id, {
        status: "completed",
        activeRunId: null,
        pendingBackgroundTasks: [{ taskId: "review", kind: "subagent" }],
      }),
    );
    yield* h.service.resume();
    expect((yield* h.service.read("second")).run.phase).toBe("approved");
    h.shells.set(id, shell(id, { status: "completed", activeRunId: null }));
    yield* h.service.resume();
    expect((yield* h.service.read("second")).run.phase).toBe("implementing");
    expect(h.launches.filter((entry) => entry.workspaceStrategy?.type === "worktree")).toHaveLength(
      2,
    );
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
