import {
  CommandId,
  type MessageId,
  type RunId,
  type ThreadId,
  type ExecutionCapabilities,
  type ExecutionLookup,
  type ExecutionRequestInput,
  type ExecutionResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as EventStore from "./EventStore.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as CommandReceipts from "./CommandReceiptStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as UsageService from "../usage/UsageService.ts";
import type { RunUsage } from "../usage/runUsage.ts";
import type { ExecutionCost, OrchestrationV2Run, NodeId } from "@t3tools/contracts";

export class ExecutionOperationError extends Schema.TaggedError<ExecutionOperationError>()(
  "ExecutionOperationError",
  { operation: Schema.Literals(["read", "start"]), cause: Schema.Defect() },
) {
  override get message() {
    return `The execution ${this.operation} operation could not be completed.`;
  }
}
export class ExecutionConflictError extends Schema.TaggedError<ExecutionConflictError>()(
  "ExecutionConflictError",
  { commandId: CommandId },
) {
  override get message() {
    return "This request does not match its recorded execution.";
  }
}
export class ExecutionNotFoundError extends Schema.TaggedError<ExecutionNotFoundError>()(
  "ExecutionNotFoundError",
  { commandId: CommandId },
) {
  override get message() {
    return "The execution request was not found.";
  }
}
type Failure = ExecutionOperationError | ExecutionConflictError | ExecutionNotFoundError;

export class ExecutionRequestService extends Context.Service<
  ExecutionRequestService,
  {
    readonly capabilities: Effect.Effect<ExecutionCapabilities, ExecutionOperationError>;
    readonly get: (
      commandId: CommandId,
      query: ExecutionLookup,
    ) => Effect.Effect<ExecutionResult, Failure>;
    readonly start: (
      commandId: CommandId,
      input: ExecutionRequestInput,
    ) => Effect.Effect<ExecutionResult, Failure>;
    readonly assertCaller: (
      messageId: MessageId,
      caller: { threadId: ThreadId; runId: RunId },
    ) => Effect.Effect<void, ExecutionOperationError | ExecutionConflictError>;
  }
>()("t3/orchestration-v2/ExecutionRequestService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const receipts = yield* CommandReceipts.CommandReceiptStoreV2;
  const events = yield* EventStore.EventStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const usage = yield* UsageService.UsageService;
  const readCost = Effect.fn("executionRequest.readCost")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    const samples: RunUsage["samples"][number][] = [];
    const visited = new Set<string>();
    let complete = true;
    const collect = Effect.fn("executionRequest.collectUsage")(function* (
      id: ThreadId,
      runIds: ReadonlySet<RunId>,
      delegatedTaskId?: NodeId,
    ): Effect.fn.Return<void, ExecutionOperationError> {
      if (visited.has(id)) {
        complete = false;
        return;
      }
      visited.add(id);
      const ids = delegatedTaskId
        ? new Set(
            (yield* threads
              .getThreadRecords(id, ["runs"])
              .pipe(
                Effect.mapError(
                  (cause) => new ExecutionOperationError({ operation: "read", cause }),
                ),
              )).runs
              .filter((candidate) => candidate.delegatedTaskId === delegatedTaskId)
              .map((candidate) => candidate.id),
          )
        : runIds;
      const records = yield* threads
        .getThreadRecords(id, ["runs", "attempts", "providerTurns", "subagents", "nodes"], {
          runIds: [...ids],
        })
        .pipe(
          Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })),
        );
      const selectedRuns = records.runs.filter((candidate) =>
        delegatedTaskId ? candidate.delegatedTaskId === delegatedTaskId : runIds.has(candidate.id),
      );
      if (!selectedRuns.length) {
        complete = false;
        return;
      }
      const selectedIds = new Set(selectedRuns.map((candidate) => candidate.id));
      const attempts = records.attempts.filter((attempt) => selectedIds.has(attempt.runId));
      const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
      const nodes = new Map(
        records.nodes
          .filter((node) => node.runId && selectedIds.has(node.runId))
          .map((node) => [node.id, node]),
      );
      const subagents = records.subagents.filter(
        (child) => child.runId && selectedIds.has(child.runId),
      );
      const nativeThreads = new Map(
        subagents
          .filter((child) => child.origin === "provider_native" && child.providerThreadId)
          .map((child) => [child.providerThreadId!, child]),
      );
      const turns = records.providerTurns.filter(
        (turn) =>
          (turn.runAttemptId && attemptById.has(turn.runAttemptId)) || nodes.has(turn.nodeId),
      );
      for (const candidate of selectedRuns) {
        if (
          !["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
            candidate.status,
          )
        )
          complete = false;
        if (
          !attempts.some((attempt) => attempt.runId === candidate.id) &&
          candidate.startedAt !== null
        )
          complete = false;
      }
      for (const attempt of attempts) {
        if (!turns.some((turn) => turn.runAttemptId === attempt.id)) complete = false;
      }
      for (const turn of turns) {
        const attempt = turn.runAttemptId ? attemptById.get(turn.runAttemptId) : undefined;
        const node = nodes.get(turn.nodeId);
        const owner = selectedRuns.find(
          (candidate) => candidate.id === (attempt?.runId ?? node?.runId),
        );
        const native = nativeThreads.get(turn.providerThreadId);
        const selection = native
          ? (native.modelSelection ??
            (native.model
              ? { instanceId: native.providerInstanceId, model: native.model }
              : undefined))
          : owner?.modelSelection;
        if (!selection) {
          complete = false;
          continue;
        }
        samples.push({ id: turn.id, selection, usage: turn.turnTokenUsage });
        if (turn.status === "running" || turn.status === "pending") complete = false;
        if (turn.turnTokenUsage?.hasSubagents && !subagents.length) complete = false;
      }
      for (const child of subagents) {
        if (child.origin === "app_owned" && child.childThreadId && !child.remoteChild) {
          yield* collect(child.childThreadId, new Set(), child.id).pipe(
            Effect.catchTags({
              ExecutionOperationError: () =>
                Effect.sync(() => {
                  complete = false;
                }),
            }),
          );
        } else if (child.origin === "provider_native") {
          if (!turns.some((turn) => turn.providerThreadId === child.providerThreadId))
            complete = false;
        } else complete = false;
        if (!["completed", "failed", "cancelled", "interrupted"].includes(child.status))
          complete = false;
      }
    });
    yield* collect(threadId, new Set([run.id]));
    return yield* usage.readRunCost({ samples, complete });
  });
  const inspect = Effect.fn("executionRequest.inspect")(function* (
    commandId: CommandId,
    query: ExecutionLookup,
  ) {
    const receipt = yield* receipts
      .getByCommandId(commandId)
      .pipe(Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })));
    if (
      Option.isSome(receipt) &&
      (receipt.value.status !== "accepted" || receipt.value.threadId !== query.threadId)
    )
      return yield* new ExecutionConflictError({ commandId });
    const shell = yield* threads
      .getThreadShell(query.threadId)
      .pipe(Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })));
    if (!shell || shell.deletedAt !== null || shell.projectId !== query.projectId) {
      if (Option.isSome(receipt)) return yield* new ExecutionConflictError({ commandId });
      return null;
    }
    const projection = yield* threads
      .getProjectThreadRecords({ projectId: query.projectId, threadId: query.threadId }, [
        "runs",
        "messages",
      ])
      .pipe(Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })));
    const message = projection.messages.find((item) => item.id === query.messageId);
    const run = projection.runs.find((item) => item.id === message?.runId);
    if (Option.isSome(receipt)) {
      // A receipt cannot be rebound to another message or replayed as a fresh launch.
      const messageCommand =
        receipt.value.commandType === "thread.create"
          ? CommandId.make(`${commandId}:initial-message`)
          : commandId;
      const recorded = yield* events.readByCommandId({ commandId: messageCommand }).pipe(
        Stream.runCollect,
        Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })),
      );
      if (
        !message ||
        !run ||
        !recorded.some(
          ({ event }) =>
            event.type === "run.created" &&
            event.payload.id === run.id &&
            event.payload.userMessageId === query.messageId &&
            event.payload.threadId === query.threadId,
        )
      )
        return yield* new ExecutionConflictError({ commandId });
    }
    if (!message || !run) return null;
    const cost = yield* readCost(query.threadId, run).pipe(
      Effect.timeout(2_000),
      Effect.orElseSucceed(() => ({ usd: null, coverage: "unavailable" }) satisfies ExecutionCost),
    );
    return {
      message,
      execution: {
        cost,
        ref: {
          environmentId: yield* environment.getEnvironmentId,
          threadId: query.threadId,
          runId: run.id,
        },
        status: run.status,
        startedAt: run.startedAt === null ? null : DateTime.formatIso(run.startedAt),
        completedAt: run.completedAt === null ? null : DateTime.formatIso(run.completedAt),
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
      } satisfies ExecutionResult,
    };
  });
  const get: ExecutionRequestService["Service"]["get"] = (commandId, query) =>
    inspect(commandId, query).pipe(
      Effect.flatMap((value) =>
        value
          ? Effect.succeed(value.execution)
          : Effect.fail(new ExecutionNotFoundError({ commandId })),
      ),
    );
  const start = Effect.fn("executionRequest.start")(function* (
    commandId: CommandId,
    input: ExecutionRequestInput,
  ) {
    if (input.target.threadId !== null && input.target.threadId !== input.threadId)
      return yield* new ExecutionConflictError({ commandId });
    const query = {
      projectId: input.target.projectId,
      threadId: input.threadId,
      messageId: input.messageId,
    };
    const existing = yield* inspect(commandId, query);
    if (existing) {
      if (existing.message.text !== input.prompt)
        return yield* new ExecutionConflictError({ commandId });
      return existing.execution;
    }
    if (input.target.threadId) {
      yield* threads
        .sendToThread({
          projectId: input.target.projectId,
          threadId: input.threadId,
          commandId,
          messageId: input.messageId,
          text: input.prompt,
          attachments: [],
          mode: "queue",
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError((cause) => new ExecutionOperationError({ operation: "start", cause })),
        );
    } else {
      yield* launch
        .launch({
          commandId,
          threadId: input.threadId,
          projectId: input.target.projectId,
          title: input.title,
          modelSelection: input.target.modelSelection,
          runtimeMode: input.target.runtimeMode,
          interactionMode: input.target.interactionMode,
          workspaceStrategy: input.target.workspaceStrategy,
          ...(input.foreground === true ? {} : { automationOrigin: "external" as const }),
          initialMessage: { messageId: input.messageId, text: input.prompt, attachments: [] },
          createdBy: input.foreground === true ? "user" : "system",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError((cause) => new ExecutionOperationError({ operation: "start", cause })),
        );
    }
    const accepted = yield* inspect(commandId, query);
    if (!accepted) return yield* new ExecutionNotFoundError({ commandId });
    if (accepted.message.text !== input.prompt)
      return yield* new ExecutionConflictError({ commandId });
    return accepted.execution;
  });
  return ExecutionRequestService.of({
    get,
    start,
    assertCaller: Effect.fn("executionRequest.assertCaller")(function* (messageId, caller) {
      const records = yield* threads
        .getThreadRecords(caller.threadId, ["messages"])
        .pipe(
          Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause })),
        );
      if (
        !records.messages.some(
          (message) => message.id === messageId && message.runId === caller.runId,
        )
      )
        return yield* new ExecutionConflictError({ commandId: CommandId.make(messageId) });
    }),
    capabilities: Effect.gen(function* () {
      const inventory = yield* projects.snapshot;
      const catalog = yield* providers.getProviders;
      return {
        environmentId: yield* environment.getEnvironmentId,
        projects: inventory.projects.map((project) => ({
          id: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
        })),
        models: catalog.flatMap((provider) =>
          provider.models.map((model) => ({
            instanceId: provider.instanceId,
            model: model.slug,
            label: `${provider.displayName ?? provider.instanceId} · ${model.name ?? model.slug}`,
          })),
        ),
      };
    }).pipe(Effect.mapError((cause) => new ExecutionOperationError({ operation: "read", cause }))),
  });
});
export const layer = Layer.effect(ExecutionRequestService, make);
