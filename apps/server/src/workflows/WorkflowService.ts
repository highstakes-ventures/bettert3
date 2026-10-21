import {
  CommandId,
  MessageId,
  ThreadId,
  WorkflowAgentResult,
  WorkflowConfiguration,
  WorkflowDependencyEvidence,
  WorkflowError,
  WorkflowRun,
  WorkflowTicket,
  type WorkflowConnection,
  type WorkflowAgentContext,
  type ProjectId,
  type WorkflowDecisionInput,
  type WorkflowDetail,
  type WorkflowListResult,
  type WorkflowTicketUpdateInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Performance from "@t3tools/workflows/performance";
import * as Refactor from "@t3tools/workflows/refactor";
import * as Tickets from "@t3tools/workflows/tickets";
import { dueScannerDate, scannerTriggers } from "@t3tools/workflows/triggers";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as LinearClient from "./LinearClient.ts";

const Record = Schema.Struct({
  ...WorkflowRun.fields,
  request: Schema.String,
  ticket: Schema.NullOr(WorkflowTicket),
  dependencyEvidence: Schema.Array(WorkflowDependencyEvidence),
  approvalKey: Schema.NullOr(Schema.String),
  originalApprovalKey: Schema.NullOr(Schema.String),
  pendingResult: Schema.NullOr(WorkflowAgentResult),
  findingIds: Schema.Array(Schema.Struct({ key: Schema.String, id: Schema.String })),
  implementationCommit: Schema.NullOr(Schema.String),
  baseCommit: Schema.NullOr(Schema.String),
  implementationLaunched: Schema.Boolean,
});
type Record = typeof Record.Type;
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(Record));
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(Record));
const decodeConfiguration = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WorkflowConfiguration),
);
const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(WorkflowConfiguration));

export class WorkflowService extends Context.Service<
  WorkflowService,
  {
    readonly connection: () => Effect.Effect<WorkflowConnection, WorkflowError>;
    readonly connect: (key: string) => Effect.Effect<WorkflowConnection, WorkflowError>;
    readonly disconnect: Effect.Effect<void, WorkflowError>;
    readonly list: (projectId: ProjectId) => Effect.Effect<WorkflowListResult, WorkflowError>;
    readonly subscribe: (projectId: ProjectId) => Stream.Stream<WorkflowListResult, WorkflowError>;
    readonly configure: (
      input: WorkflowConfiguration,
    ) => Effect.Effect<WorkflowListResult, WorkflowError>;
    readonly intake: (input: {
      projectId: ProjectId;
      requestId: string;
      text: string;
    }) => Effect.Effect<WorkflowRun, WorkflowError>;
    readonly read: (runId: string) => Effect.Effect<WorkflowDetail, WorkflowError>;
    readonly decide: (input: WorkflowDecisionInput) => Effect.Effect<WorkflowRun, WorkflowError>;
    readonly agentRead: (
      threadId: ThreadId,
    ) => Effect.Effect<typeof WorkflowAgentContext.Type, WorkflowError>;
    readonly agentSearch: (
      threadId: ThreadId,
      query: string,
    ) => Effect.Effect<ReadonlyArray<WorkflowTicket>, WorkflowError>;
    readonly agentUpdate: (
      threadId: ThreadId,
      input: WorkflowTicketUpdateInput,
    ) => Effect.Effect<WorkflowDetail, WorkflowError>;
    readonly submitResult: (
      threadId: ThreadId,
      result: WorkflowAgentResult,
    ) => Effect.Effect<WorkflowRun, WorkflowError>;
    readonly resume: () => Effect.Effect<void, WorkflowError>;
  }
>()("t3/workflows/WorkflowService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto
    .randomUUIDv4()
    .pipe(
      Effect.mapError(
        (cause) => new WorkflowError({ message: "Could not allocate a workflow identity.", cause }),
      ),
    );
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const launch = yield* ThreadLaunchService.ThreadLaunchService;
  const linear = yield* LinearClient.LinearClient;
  const processes = yield* ProcessRunner.ProcessRunner;
  const scheduler = yield* Scheduler.Scheduler;
  const settings = yield* ServerSettings.ServerSettingsService;
  const locks = yield* KeyedLock.make<ProjectId>();
  const admission = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<void>(1);
  const lastTick = yield* Ref.make(0);
  const changed = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const storageError = (cause: unknown) =>
    new WorkflowError({ message: "Could not persist the workflow.", cause });
  const all = (projectId?: ProjectId) =>
    Effect.gen(function* () {
      const rows = yield* (
        projectId === undefined
          ? sql<{ run_json: string }>`SELECT run_json FROM workflow_runs`
          : sql<{
              run_json: string;
            }>`SELECT run_json FROM workflow_runs WHERE project_id = ${projectId}`
      ).pipe(Effect.mapError(storageError));
      return yield* Effect.forEach(rows, (row) =>
        decodeRecord(row.run_json).pipe(Effect.mapError(storageError)),
      );
    });
  const load = (id: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        run_json: string;
      }>`SELECT run_json FROM workflow_runs WHERE id = ${id}`.pipe(Effect.mapError(storageError));
      if (!rows[0]) return yield* new WorkflowError({ message: "This workflow was not found." });
      return yield* decodeRecord(rows[0].run_json).pipe(Effect.mapError(storageError));
    });
  const save = (record: Record) =>
    Effect.gen(function* () {
      const value = { ...record, updatedAt: yield* now };
      const json = yield* encodeRecord(value).pipe(Effect.mapError(storageError));
      yield* sql`INSERT INTO workflow_runs(id, project_id, run_json) VALUES(${value.id}, ${value.projectId}, ${json}) ON CONFLICT(id) DO UPDATE SET run_json = excluded.run_json WHERE workflow_runs.project_id = excluded.project_id`.pipe(
        Effect.mapError(storageError),
      );
      yield* changed;
      return value;
    });
  const configuration = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        configuration_json: string;
      }>`SELECT configuration_json FROM workflow_configurations WHERE project_id = ${projectId}`.pipe(
        Effect.mapError(storageError),
      );
      return rows[0]
        ? yield* decodeConfiguration(rows[0].configuration_json).pipe(Effect.mapError(storageError))
        : null;
    });
  const requireConfiguration = (projectId: ProjectId) =>
    configuration(projectId).pipe(
      Effect.flatMap((value) =>
        value === null
          ? Effect.fail(
              new WorkflowError({ message: "Set up this project's ticket workflow first." }),
            )
          : Effect.succeed(value),
      ),
    );
  const requireProject = (id: ProjectId) =>
    projects.get(id).pipe(
      Effect.mapError(
        (cause) => new WorkflowError({ message: "Could not read the workflow project.", cause }),
      ),
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.fail(new WorkflowError({ message: "The workflow's project no longer exists." }))
          : Effect.succeed(value.value),
      ),
    );
  const summary = (record: Record): WorkflowRun => ({
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    phase: record.phase,
    title: record.title,
    priority: record.priority,
    blockerIds: record.blockerIds,
    threadId: record.threadId,
    implementationThreadId: record.implementationThreadId,
    issueId: record.issueId,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.delayedAt === undefined ? {} : { delayedAt: record.delayedAt }),
  });
  const implementationSlots = () =>
    Effect.gen(function* () {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) => new WorkflowError({ message: "Could not read ticket slot settings.", cause }),
        ),
      );
      let used = 0;
      for (const record of yield* all()) {
        if (record.phase !== "implementing") continue;
        if (!record.implementationLaunched || record.implementationThreadId === null) {
          used++;
          continue;
        }
        const shell = yield* projections.getThreadShell(record.implementationThreadId).pipe(
          Effect.mapError(
            (cause) =>
              new WorkflowError({
                message: "Could not read a ticket implementation chat.",
                cause,
              }),
          ),
        );
        // Snooze changes visibility, not execution. Keep running and reserved
        // work counted even while hidden, and release idle chats awaiting landing.
        if (
          shell === null ||
          shell.latestRunId === null ||
          shell.activeRunId !== null ||
          shell.status === "queued" ||
          shell.pendingRuntimeRequest !== null ||
          shell.pendingBackgroundTasks?.some(
            (task) => task.kind !== "command" && task.kind !== "monitor",
          )
        )
          used++;
      }
      return { used, limit: current.ticketImplementationSlots };
    });
  const list = (projectId: ProjectId) =>
    Effect.gen(function* () {
      yield* requireProject(projectId);
      const records = yield* all(projectId);
      const runs = records.map(summary);
      const waiting = Tickets.orderRefinementQueue(runs);
      return {
        configuration: yield* configuration(projectId),
        connected: yield* linear.connected,
        implementationSlots: yield* implementationSlots(),
        runs: [...waiting, ...runs.filter((run) => run.phase !== "review")],
      } satisfies WorkflowListResult;
    });
  const ticketRecord = (record: Record, ticket: WorkflowTicket): Record => ({
    ...record,
    ticket,
    title: ticket.title,
    priority: ticket.priority,
    blockerIds: ticket.blockedBy.map((issue) => issue.id),
  });
  const questions = (record: Record, ticket: WorkflowTicket) =>
    Effect.gen(function* () {
      const seen = new Set([ticket.id]);
      const dependencies: WorkflowTicket[] = [];
      const waiting = ticket.blockedBy.map((issue) => issue.id);
      while (waiting.length) {
        const id = waiting.shift()!;
        if (seen.has(id)) continue;
        if (seen.size >= 64)
          return [
            "The dependency graph exceeds 64 tickets. Narrow the prerequisites before approval.",
          ];
        seen.add(id);
        const dependency = yield* linear
          .read(id)
          .pipe(Effect.catchTags({ WorkflowError: () => Effect.succeed(null) }));
        if (dependency === null)
          return [
            "A prerequisite could not be verified in Linear. Resolve it in chat before approval.",
          ];
        dependencies.push(dependency);
        waiting.push(...dependency.blockedBy.map((issue) => issue.id));
      }
      return Tickets.refinementQuestions(
        ticket,
        (yield* all(record.projectId)).map(summary),
        record.dependencyEvidence,
        dependencies,
      );
    });
  const read = (id: string) =>
    Effect.gen(function* () {
      const record = yield* load(id);
      const ticket =
        record.issueId !== null && record.ticket !== null
          ? yield* linear.read(record.issueId)
          : record.pendingResult?.type === "prepared"
            ? yield* linear
                .read(record.pendingResult.existingIssueId ?? record.issueId!)
                .pipe(Effect.catchTags({ WorkflowError: () => Effect.succeed(null) }))
            : null;
      return {
        run: summary(record),
        ticket,
        dependencyEvidence: record.dependencyEvidence,
        questions: ticket ? yield* questions(record, ticket) : [],
      } satisfies WorkflowDetail;
    });
  const create = (input: {
    id: string;
    projectId: ProjectId;
    kind: typeof WorkflowRun.Type.kind;
    request: string;
    title: string;
  }) =>
    Effect.gen(function* () {
      const existing = yield* sql<{
        run_json: string;
      }>`SELECT run_json FROM workflow_runs WHERE id = ${input.id}`.pipe(
        Effect.mapError(storageError),
      );
      if (existing[0]) {
        const record = yield* decodeRecord(existing[0].run_json).pipe(
          Effect.mapError(storageError),
        );
        if (
          record.projectId !== input.projectId ||
          record.request !== input.request ||
          record.kind !== input.kind
        )
          return yield* new WorkflowError({
            message: "This request identifier already belongs to different work.",
          });
        return record;
      }
      const timestamp = yield* now;
      return yield* save({
        id: input.id,
        projectId: input.projectId,
        kind: input.kind,
        phase: "queued",
        request: input.request,
        title: input.title,
        priority: 0,
        blockerIds: [],
        threadId: ThreadId.make(yield* uuid),
        implementationThreadId: null,
        issueId: input.kind === "tickets" ? yield* uuid : null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ticket: null,
        dependencyEvidence: [],
        approvalKey: null,
        originalApprovalKey: null,
        pendingResult: null,
        findingIds: [],
        implementationCommit: null,
        baseCommit: null,
        implementationLaunched: false,
      });
    });
  const validateTarget = (config: WorkflowConfiguration, target: string | null) =>
    linear.connection().pipe(
      Effect.flatMap((connection) =>
        target === null ||
        connection.projects.some(
          (project) => project.id === target && project.teamIds.includes(config.linearTeamId),
        )
          ? Effect.void
          : Effect.fail(
              new WorkflowError({
                message: "Choose a target project available to this ticket's Linear team.",
              }),
            ),
      ),
    );
  const launchTask = (
    record: Record,
    config: WorkflowConfiguration,
    text: string,
    implementation = false,
  ) =>
    launch
      .launch({
        commandId: CommandId.make(
          `workflow:${record.id}:${implementation ? "implementation" : "preparation"}`,
        ),
        threadId: (implementation ? record.implementationThreadId : record.threadId)!,
        projectId: record.projectId,
        title: `${implementation ? "Implement" : record.kind === "tickets" ? "Refine" : "Scan"}: ${record.title}`,
        modelSelection: config.modelSelection,
        runtimeMode: config.runtimeMode,
        interactionMode: "default",
        workspaceStrategy: implementation
          ? { type: "worktree", baseRef: record.baseCommit!, startFromOrigin: false }
          : { type: "root" },
        initialMessage: {
          messageId: MessageId.make(
            `workflow:${record.id}:${implementation ? "implementation" : "preparation"}`,
          ),
          text,
          attachments: [],
        },
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError(
          (cause) => new WorkflowError({ message: "Could not launch this workflow task.", cause }),
        ),
      );
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    processes
      .run({ command: "git", args, cwd, timeout: "60 seconds", maxOutputBytes: 16_384 })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkflowError({
              message: "Could not check the implementation's base branch.",
              cause,
            }),
        ),
      );
  const base = (config: WorkflowConfiguration) =>
    Effect.gen(function* () {
      const project = yield* requireProject(config.projectId);
      const fetched = yield* git(project.workspaceRoot, [
        "fetch",
        "origin",
        `refs/heads/${config.baseBranch}:refs/remotes/origin/${config.baseBranch}`,
      ]);
      if (fetched.code !== 0)
        return yield* new WorkflowError({
          message: "Could not fetch the workflow's base branch. Implementation remains waiting.",
        });
      const resolved = yield* git(project.workspaceRoot, [
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${config.baseBranch}^{commit}`,
      ]);
      if (resolved.code !== 0 || !/^[a-f0-9]{40}$/.test(resolved.stdout.trim()))
        return yield* new WorkflowError({
          message: "The workflow base branch does not resolve to a commit.",
        });
      return { cwd: project.workspaceRoot, commit: resolved.stdout.trim() };
    });
  const isAncestor = (cwd: string, commit: string, target: string) =>
    git(cwd, ["merge-base", "--is-ancestor", commit, target]).pipe(
      Effect.map((result) => result.code === 0),
    );
  const callerRecord = (threadId: ThreadId) =>
    all().pipe(
      Effect.flatMap((records) => {
        const record = records.find(
          (run) => run.threadId === threadId || run.implementationThreadId === threadId,
        );
        return record
          ? Effect.succeed(record)
          : Effect.fail(new WorkflowError({ message: "This task does not belong to a workflow." }));
      }),
    );
  const finishResult = (
    record: Record,
    config: WorkflowConfiguration,
  ): Effect.Effect<Record, WorkflowError> =>
    Effect.gen(function* () {
      const result = record.pendingResult;
      if (result === null) return record;
      if (result.type === "scan") {
        for (const finding of result.findings) {
          const id = record.findingIds.find((entry) => entry.key === finding.key)?.id;
          if (id === undefined)
            return yield* new WorkflowError({
              message: "The scanner result has no persisted finding identity.",
            });
          yield* create({
            id,
            projectId: record.projectId,
            kind: "tickets",
            request: finding.request,
            title: finding.request.slice(0, 100),
          });
        }
        return yield* save({ ...record, phase: "done", pendingResult: null, error: null });
      }
      if (result.type === "implementation")
        return yield* save({
          ...record,
          implementationCommit: result.commit,
          pendingResult: null,
          error: "Waiting for the implementation commit to reach the base branch.",
        });
      yield* validateTarget(config, result.ticket.targetProjectId);
      const issueId = result.existingIssueId ?? record.issueId!;
      const others = yield* all(record.projectId);
      const existing = others.find(
        (run) => run.id !== record.id && run.issueId === issueId && run.phase !== "rejected",
      );
      if (existing && existing.phase !== "review")
        return yield* new WorkflowError({
          message:
            "This issue already has approved or active work. Prepare a distinct follow-up instead.",
        });
      if (result.existingIssueId) {
        const issue = yield* linear.read(issueId);
        if (
          issue.teamId !== config.linearTeamId ||
          ["completed", "canceled"].includes(issue.stateType)
        )
          return yield* new WorkflowError({
            message: "Only open issues in this workflow's Linear team can be merged.",
          });
        if (result.expectedUpdatedAt === undefined || issue.updatedAt !== result.expectedUpdatedAt)
          return yield* new WorkflowError({
            message:
              "The existing ticket changed. Read it and submit a corrected result with its current revision.",
          });
      }
      for (const id of result.ticket.blockedBy) {
        const dependency = yield* linear.read(id);
        if (dependency.id === issueId)
          return yield* new WorkflowError({ message: "A ticket cannot depend on itself." });
      }
      const ticket = yield* linear.save({
        id: issueId,
        teamId: config.linearTeamId,
        draft: result.ticket,
        create: result.existingIssueId === undefined,
        ...(result.expectedUpdatedAt === undefined
          ? {}
          : { expectedUpdatedAt: result.expectedUpdatedAt }),
      });
      if (existing) {
        yield* save({
          ...ticketRecord(existing, ticket),
          dependencyEvidence: result.ticket.dependencyEvidence,
        });
        return yield* save({
          ...record,
          phase: "done",
          issueId: null,
          pendingResult: null,
          error: null,
        });
      }
      return yield* save({
        ...ticketRecord(record, ticket),
        issueId,
        phase: "review",
        dependencyEvidence: result.ticket.dependencyEvidence,
        pendingResult: null,
        error: null,
      });
    });
  const applyDecision = (record: Record, config: WorkflowConfiguration) =>
    Effect.gen(function* () {
      const connection = yield* linear.connection();
      const team = connection.teams.find((value) => value.id === config.linearTeamId);
      const rejecting = record.phase === "rejecting";
      const stateId = rejecting ? team?.canceledStateId : team?.refinedStateId;
      if (!stateId)
        return yield* new WorkflowError({
          message: rejecting
            ? "This Linear team needs a canceled state before rejecting tickets."
            : "Add a Refined state to this Linear team before approving tickets.",
        });
      const ticket = yield* linear.read(record.issueId!);
      if (ticket.teamId !== config.linearTeamId)
        return yield* new WorkflowError({
          message: "The ticket moved to another Linear team. No decision was applied.",
        });
      // Recovery accepts the original snapshot or the desired result after a lost response.
      if (
        !rejecting &&
        record.approvalKey !== Tickets.ticketApprovalKey(ticket) &&
        record.originalApprovalKey !== Tickets.ticketApprovalKey(ticket)
      ) {
        return yield* save({
          ...ticketRecord(record, ticket),
          phase: "review",
          approvalKey: null,
          error: "The ticket changed after approval. Review it again.",
        });
      }
      const updated = yield* linear.decide(
        ticket.id,
        stateId,
        rejecting ? undefined : (record.ticket?.project?.id ?? null),
      );
      if (!rejecting && Tickets.ticketApprovalKey(updated) !== record.approvalKey)
        return yield* save({
          ...ticketRecord(record, updated),
          phase: "review",
          approvalKey: null,
          error: "The ticket changed during approval. Review it again.",
        });
      return yield* save({
        ...ticketRecord(record, updated),
        phase: rejecting ? "rejected" : "approved",
        approvalKey: rejecting ? null : record.approvalKey,
        error: null,
      });
    });
  const advance = (record: Record): Effect.Effect<void, WorkflowError> =>
    Effect.gen(function* () {
      const config = yield* requireConfiguration(record.projectId);
      if (record.pendingResult !== null) {
        yield* finishResult(record, config);
        return;
      }
      if (
        record.phase === "preparing" ||
        (record.phase === "implementing" &&
          record.implementationLaunched &&
          !record.implementationCommit)
      ) {
        const threadId =
          record.phase === "preparing" ? record.threadId : record.implementationThreadId;
        const shell = threadId
          ? yield* projections
              .getThreadShell(threadId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new WorkflowError({ message: "Could not read the workflow task.", cause }),
                ),
              )
          : null;
        const error =
          shell && shell.latestRunId !== null && shell.activeRunId === null
            ? "The task ended without a workflow result. Continue its chat to finish this stage."
            : null;
        if (record.error !== error) yield* save({ ...record, error });
        return;
      }
      if (record.phase === "review") {
        const ticket = yield* linear.read(record.issueId!);
        if (
          ticket.updatedAt !== record.ticket?.updatedAt ||
          ticket.blockedBy.some(
            (issue, index) => issue.stateType !== record.ticket?.blockedBy[index]?.stateType,
          ) ||
          record.error !== null
        )
          yield* save({ ...ticketRecord(record, ticket), error: null });
        return;
      }
      if (record.phase === "queued") {
        const start = (goal: string) => launchTask(record, config, goal);
        if (record.kind === "tickets")
          yield* Tickets.prepare(
            `${record.request}\n\nUse t3_workflow_read first for this workflow's configuration, available target projects and labels. Intake project: ${config.intakeProjectId ?? "none"}.`,
            start,
          );
        else if (record.kind === "performance") yield* Performance.start(start);
        else yield* Refactor.start(start);
        yield* save({ ...record, phase: "preparing", error: null });
        return;
      }
      if (record.phase === "approving" || record.phase === "rejecting") {
        yield* applyDecision(record, config);
        return;
      }
      if (
        record.phase === "approved" ||
        (record.phase === "implementing" && !record.implementationLaunched)
      ) {
        if (record.phase === "approved") {
          const slots = yield* implementationSlots();
          if (slots.used >= slots.limit) {
            if (record.error !== "Waiting for a ticket implementation slot.")
              yield* save({ ...record, error: "Waiting for a ticket implementation slot." });
            return;
          }
        }
        const ticket = yield* linear.read(record.issueId!);
        if (ticket.teamId !== config.linearTeamId)
          return yield* new WorkflowError({
            message: "The ticket moved to another Linear team. Implementation remains waiting.",
          });
        if (ticket.stateType === "canceled") {
          yield* save({ ...ticketRecord(record, ticket), phase: "rejected", error: null });
          return;
        }
        if (Tickets.ticketApprovalKey(ticket) !== record.approvalKey) {
          yield* save({
            ...ticketRecord(record, ticket),
            phase: "review",
            approvalKey: null,
            error: "The ticket changed after approval. Review it again.",
          });
          return;
        }
        const connection = yield* linear.connection();
        if (
          ticket.stateId !==
          connection.teams.find((team) => team.id === config.linearTeamId)?.refinedStateId
        )
          return yield* new WorkflowError({
            message:
              "The ticket is no longer in Refined. Review its state in Linear before implementation can start.",
          });
        const unresolved = ticket.blockedBy.filter(
          (dependency) => dependency.stateType !== "completed",
        );
        if (unresolved.length) {
          const error = `Waiting for ${unresolved.map((dependency) => dependency.identifier).join(", ")} to complete.`;
          if (record.error !== error) yield* save({ ...ticketRecord(record, ticket), error });
          return;
        }
        const baseline = yield* base(config);
        const records = yield* all(record.projectId);
        for (const dependency of ticket.blockedBy) {
          const evidence = record.dependencyEvidence.find(
            (value) => value.issueId === dependency.id,
          );
          const managed = records.find(
            (value) => value.issueId === dependency.id && value.phase !== "rejected",
          );
          const commit =
            managed?.implementationCommit ?? (evidence?.kind === "code" ? evidence.commit : null);
          if (managed || evidence?.kind !== "external") {
            if (!commit || !(yield* isAncestor(baseline.cwd, commit, baseline.commit)))
              return yield* new WorkflowError({
                message: `${dependency.identifier} needs a verified commit on the base branch before implementation can start.`,
              });
          }
        }
        // Project locks do not protect shared capacity. Reserve durably before
        // dispatch so another project or a restart cannot reuse the same slot.
        const next = yield* admission.withPermit(
          Effect.gen(function* () {
            const slots = yield* implementationSlots();
            if (record.phase === "approved" && slots.used >= slots.limit) {
              if (record.error !== "Waiting for a ticket implementation slot.")
                yield* save({ ...record, error: "Waiting for a ticket implementation slot." });
              return null;
            }
            return yield* save({
              ...ticketRecord(record, ticket),
              phase: "implementing",
              baseCommit: baseline.commit,
              implementationThreadId: record.implementationThreadId ?? ThreadId.make(yield* uuid),
              error: null,
            });
          }),
        );
        if (next === null) return;
        yield* Tickets.implement(ticket, (goal) => launchTask(next, config, goal, true));
        yield* save({ ...next, implementationLaunched: true });
        return;
      }
      if (record.phase === "implementing" && record.implementationCommit) {
        const baseline = yield* base(config);
        if (!(yield* isAncestor(baseline.cwd, record.implementationCommit, baseline.commit)))
          return;
        const connection = yield* linear.connection();
        const stateId = connection.teams.find(
          (team) => team.id === config.linearTeamId,
        )?.completedStateId;
        if (!stateId)
          return yield* new WorkflowError({
            message: "The implementation landed, but the Linear team has no completed state.",
          });
        const current = yield* linear.read(record.issueId!);
        if (
          current.teamId !== config.linearTeamId ||
          current.stateType === "canceled" ||
          Tickets.ticketApprovalKey(current) !== record.approvalKey
        )
          return yield* new WorkflowError({
            message: "The implemented ticket changed in Linear. Review it there before closing it.",
          });
        const ticket = yield* linear.decide(record.issueId!, stateId);
        yield* save({ ...ticketRecord(record, ticket), phase: "done", error: null });
      }
    });
  const resumeRecord = (id: string) =>
    Effect.gen(function* () {
      const initial = yield* load(id);
      yield* locks.withLock(
        initial.projectId,
        Effect.gen(function* () {
          const record = yield* load(id);
          yield* advance(record).pipe(
            Effect.catch((error) =>
              load(id).pipe(
                Effect.flatMap((current) =>
                  current.error === error.message
                    ? Effect.void
                    : save({ ...current, error: error.message }).pipe(Effect.asVoid),
                ),
              ),
            ),
          );
        }),
      );
    });
  const resume = () =>
    Effect.gen(function* () {
      if (!(yield* linear.connected)) return;
      const current = yield* DateTime.now;
      const epoch = DateTime.toEpochMillis(current);
      const configurations = yield* sql<{
        configuration_json: string;
        performance_enabled_at: number | null;
        refactor_enabled_at: number | null;
      }>`SELECT * FROM workflow_configurations`.pipe(Effect.mapError(storageError));
      for (const row of configurations) {
        const config = yield* decodeConfiguration(row.configuration_json).pipe(
          Effect.mapError(storageError),
        );
        for (const trigger of scannerTriggers) {
          const enabled =
            trigger.workflow === "performance"
              ? row.performance_enabled_at
              : row.refactor_enabled_at;
          if (enabled === null) continue;
          const date = dueScannerDate(epoch, enabled);
          if (date === null) continue;
          yield* locks.withLock(
            config.projectId,
            create({
              id: `${trigger.workflow}:${config.projectId}:${date}`,
              projectId: config.projectId,
              kind: trigger.workflow,
              request: `Daily ${trigger.workflow} scan for ${date}`,
              title: `${trigger.workflow} scan · ${date}`,
            }),
          );
        }
      }
      const records = yield* all();
      for (const record of records.filter(
        (value) =>
          [
            "queued",
            "preparing",
            "review",
            "approving",
            "rejecting",
            "approved",
            "implementing",
          ].includes(value.phase) || value.pendingResult !== null,
      ))
        yield* resumeRecord(record.id);
      // Chat activity can change without a workflow transition.
      yield* changed;
    });
  yield* scheduler.register(
    "workflows",
    Effect.gen(function* () {
      const epoch = DateTime.toEpochMillis(yield* DateTime.now);
      if (epoch - (yield* Ref.get(lastTick)) < 30_000) return;
      yield* Ref.set(lastTick, epoch);
      yield* resume();
    }),
  );
  return WorkflowService.of({
    list,
    resume,
    connection: linear.connection,
    connect: (key) => linear.connect(key).pipe(Effect.tap(() => changed)),
    disconnect: linear.disconnect.pipe(Effect.andThen(changed)),
    subscribe: (projectId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = yield* PubSub.subscribe(changes);
          const settingsChanges = yield* settings.subscribeChanges;
          return Stream.concat(
            Stream.fromEffect(list(projectId)),
            Stream.merge(
              Stream.fromSubscription(queue),
              settingsChanges.pipe(Stream.map(() => undefined)),
            ).pipe(Stream.mapEffect(() => list(projectId))),
          );
        }),
      ),
    configure: (input) =>
      locks.withLock(
        input.projectId,
        Effect.gen(function* () {
          yield* requireProject(input.projectId);
          const previous = yield* configuration(input.projectId);
          if (
            previous &&
            previous.linearTeamId !== input.linearTeamId &&
            (yield* all(input.projectId)).some((run) => !["done", "rejected"].includes(run.phase))
          )
            return yield* new WorkflowError({
              message: "Finish the active workflows before changing their Linear team.",
            });
          if (!/^[\w][\w/.-]*$/.test(input.baseBranch) || input.baseBranch.includes(".."))
            return yield* new WorkflowError({ message: "Choose a valid base branch." });
          const connection = yield* linear.connection();
          if (!connection.teams.some((team) => team.id === input.linearTeamId))
            return yield* new WorkflowError({
              message: "Choose a Linear team available to this connection.",
            });
          yield* validateTarget(input, input.intakeProjectId);
          const epoch = DateTime.toEpochMillis(yield* DateTime.now);
          const encoded = yield* encodeConfiguration(input).pipe(Effect.mapError(storageError));
          yield* sql`INSERT INTO workflow_configurations(project_id,configuration_json,performance_enabled_at,refactor_enabled_at) VALUES(${input.projectId},${encoded},${input.performanceEnabled ? epoch : null},${input.refactorEnabled ? epoch : null}) ON CONFLICT(project_id) DO UPDATE SET configuration_json=excluded.configuration_json,performance_enabled_at=CASE WHEN excluded.performance_enabled_at IS NULL THEN NULL ELSE COALESCE(workflow_configurations.performance_enabled_at,excluded.performance_enabled_at) END,refactor_enabled_at=CASE WHEN excluded.refactor_enabled_at IS NULL THEN NULL ELSE COALESCE(workflow_configurations.refactor_enabled_at,excluded.refactor_enabled_at) END`.pipe(
            Effect.mapError(storageError),
          );
          yield* changed;
          return yield* list(input.projectId);
        }),
      ),
    intake: (input) =>
      locks.withLock(
        input.projectId,
        Effect.gen(function* () {
          yield* requireProject(input.projectId);
          yield* requireConfiguration(input.projectId);
          if (!(yield* linear.connected))
            return yield* new WorkflowError({ message: "Connect Linear before adding a ticket." });
          return summary(
            yield* create({
              id: input.requestId,
              projectId: input.projectId,
              kind: "tickets",
              request: input.text,
              title: input.text.slice(0, 100),
            }),
          );
        }),
      ),
    read,
    decide: (input) =>
      Effect.gen(function* () {
        const initial = yield* load(input.runId);
        return yield* locks.withLock(
          initial.projectId,
          Effect.gen(function* () {
            const record = yield* load(input.runId);
            if (
              (input.decision !== "delay" &&
                record.phase === (input.decision === "approve" ? "approved" : "rejected")) ||
              (input.decision === "approve" && ["implementing", "done"].includes(record.phase))
            )
              return summary(record);
            if (record.phase !== "review")
              return yield* new WorkflowError({
                message: "This ticket is no longer awaiting refinement.",
              });
            const ticket = yield* linear.read(record.issueId!);
            if (ticket.updatedAt !== input.expectedUpdatedAt)
              return yield* new WorkflowError({
                message: "The ticket changed. Refresh it before deciding.",
              });
            if (input.decision === "delay")
              return summary(
                yield* save({
                  ...ticketRecord(record, ticket),
                  delayedAt: yield* now,
                  error: null,
                }),
              );
            const config = yield* requireConfiguration(record.projectId);
            const unresolvedQuestions =
              input.decision === "approve" ? yield* questions(record, ticket) : [];
            if (unresolvedQuestions.length)
              return yield* new WorkflowError({ message: unresolvedQuestions.join(" ") });
            if (ticket.teamId !== config.linearTeamId)
              return yield* new WorkflowError({
                message: "The ticket moved to another Linear team.",
              });
            if (input.decision === "approve") yield* validateTarget(config, input.targetProjectId);
            const connection = yield* linear.connection();
            const target =
              input.targetProjectId === null
                ? null
                : connection.projects.find((project) => project.id === input.targetProjectId)!;
            const nextTicket = {
              ...ticket,
              project: input.decision === "approve" ? target : ticket.project,
            };
            const next = yield* save({
              ...ticketRecord(record, nextTicket),
              phase: input.decision === "approve" ? "approving" : "rejecting",
              approvalKey: Tickets.ticketApprovalKey(nextTicket),
              originalApprovalKey: Tickets.ticketApprovalKey(ticket),
              error: null,
            });
            return summary(yield* applyDecision(next, config));
          }),
        );
      }),
    agentRead: (threadId) =>
      Effect.gen(function* () {
        const record = yield* callerRecord(threadId);
        return {
          detail: yield* read(record.id),
          configuration: yield* requireConfiguration(record.projectId),
          connection: yield* linear.connection(),
        };
      }),
    agentSearch: (threadId, query) =>
      callerRecord(threadId).pipe(
        Effect.flatMap((record) => requireConfiguration(record.projectId)),
        Effect.flatMap((config) => linear.search(config.linearTeamId, query)),
      ),
    agentUpdate: (threadId, input) =>
      Effect.gen(function* () {
        const draft = input.ticket;
        const initial = yield* callerRecord(threadId);
        return yield* locks.withLock(
          initial.projectId,
          Effect.gen(function* () {
            const record = yield* load(initial.id);
            if (record.phase !== "review" || record.threadId !== threadId)
              return yield* new WorkflowError({
                message: "Only the active refinement chat can edit this ticket.",
              });
            const config = yield* requireConfiguration(record.projectId);
            const current = yield* linear.read(record.issueId!);
            if (current.teamId !== config.linearTeamId)
              return yield* new WorkflowError({
                message: "The ticket moved to another Linear team.",
              });
            if (current.updatedAt !== input.expectedUpdatedAt)
              return yield* new WorkflowError({
                message: "The ticket changed. Read it again before updating.",
              });
            yield* validateTarget(config, draft.targetProjectId);
            const ticket = yield* linear.save({
              id: record.issueId!,
              teamId: config.linearTeamId,
              draft,
              create: false,
              expectedUpdatedAt: input.expectedUpdatedAt,
            });
            const updated = yield* save({
              ...ticketRecord(record, ticket),
              dependencyEvidence: draft.dependencyEvidence,
              error: null,
            });
            return yield* read(updated.id);
          }),
        );
      }),
    submitResult: (threadId, result) =>
      Effect.gen(function* () {
        const initial = yield* callerRecord(threadId);
        return yield* locks.withLock(
          initial.projectId,
          Effect.gen(function* () {
            let record = yield* load(initial.id);
            if (result.type === "implementation") {
              if (record.phase !== "implementing" || record.implementationThreadId !== threadId)
                return yield* new WorkflowError({
                  message: "This task is not implementing the ticket.",
                });
              if (result.commit === record.baseCommit)
                return yield* new WorkflowError({
                  message: "Report the implementation commit, not the unchanged base commit.",
                });
            } else if (
              record.phase !== "preparing" ||
              record.threadId !== threadId ||
              (result.type === "scan") !== (record.kind !== "tickets")
            )
              return yield* new WorkflowError({
                message: "This result does not match the workflow's active stage.",
              });
            if (
              record.pendingResult !== null &&
              !(
                result.type === "prepared" &&
                record.pendingResult.type === "prepared" &&
                (result.existingIssueId ?? record.issueId) ===
                  (record.pendingResult.existingIssueId ?? record.issueId)
              )
            )
              return yield* new WorkflowError({
                message:
                  "A result is already pending. It will resume automatically. A corrected prepared result must keep the same issue identity.",
              });
            const findingIds =
              result.type === "scan"
                ? yield* Effect.forEach(result.findings, (finding) =>
                    uuid.pipe(Effect.map((id) => ({ key: finding.key, id }))),
                  )
                : [];
            if (
              result.type === "scan" &&
              new Set(result.findings.map((finding) => finding.key)).size !== result.findings.length
            )
              return yield* new WorkflowError({ message: "Scanner finding keys must be unique." });
            record = yield* save({ ...record, pendingResult: result, findingIds, error: null });
            const config = yield* requireConfiguration(record.projectId);
            return summary(yield* finishResult(record, config));
          }),
        );
      }),
  });
});

export const layer = Layer.effect(WorkflowService, make);
