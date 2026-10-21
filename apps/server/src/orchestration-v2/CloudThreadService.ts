import {
  CloudChatError,
  CommandId,
  EventId,
  NodeId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type CloudChatOpenInput,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as CodexCloudChats from "../provider/CodexCloudChats.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";

const isCloudChatError = Schema.is(CloudChatError);

export class CloudThreadService extends Context.Service<
  CloudThreadService,
  {
    readonly open: (
      input: CloudChatOpenInput,
    ) => Effect.Effect<{ threadId: ThreadId }, CloudChatError>;
  }
>()("t3/orchestration-v2/CloudThreadService") {}

const make = Effect.gen(function* () {
  const cloud = yield* CodexCloudChats.CodexCloudChats;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sink = yield* EventSink.EventSinkV2;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Scope.Scope;
  const serial = yield* Semaphore.make(1);
  const threadCommands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const bindings = new Map<string, ThreadId>();
  const monitoring = new Set<ThreadId>();
  const driver = ProviderDriverKind.make("codex");
  const commandId = () => crypto.randomUUIDv4().pipe(Effect.orDie, Effect.map(CommandId.make));
  const importedRunPrefix = (threadId: ThreadId) => `cloud-run:${threadId}:`;

  const synchronize = Effect.fn("CloudThreadService.synchronize")(
    function* (input: CloudChatOpenInput) {
      const key = `${encodeURIComponent(input.accountId)}:${input.threadId}`;
      let threadId = bindings.get(key) ?? ThreadId.make(`cloud:${key}`);
      let shell = yield* orchestrator.getThreadShell(threadId);
      if (shell?.deletedAt != null) return yield* new CloudChatError({ reason: "protocol" });
      const records = shell
        ? yield* orchestrator.getThreadRecords(threadId, [
            "runs",
            "providerTurns",
            "providerThreads",
            "turnItems",
            "messages",
          ])
        : null;
      const known = new Set(
        records?.providerTurns
          .filter((turn) => turn.status !== "running" && turn.nativeTurnRef?.nativeId)
          .map((turn) => turn.nativeTurnRef!.nativeId!) ?? [],
      );

      const snapshot = yield* cloud
        .snapshot(input, known)
        .pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Cloud snapshot failed", { reason: error.reason }),
          ),
        );
      if (!shell) {
        const nativeId = IdAllocator.derive.providerThread({
          driver,
          providerInstanceId: snapshot.instanceId,
          nativeThreadId: input.threadId,
        });
        const owner = yield* projections.getProviderThreadOwner(nativeId);
        if (owner) {
          threadId = owner;
          shell = yield* orchestrator.getThreadShell(owner);
          // A deleted or switched thread still owns its native reference.
          // Opening Cloud history must never steal that mapping.
          if (!shell || shell.activeProviderThreadId !== nativeId)
            return yield* new CloudChatError({ reason: "protocol" });
        }
      }
      bindings.set(key, threadId);
      if (!shell) {
        if (!snapshot.thread.model) return yield* new CloudChatError({ reason: "protocol" });
        const { projectId } = yield* folders.ensureCloudProject;
        yield* launches.launch({
          commandId: yield* commandId(),
          threadId,
          projectId,
          title: snapshot.destination.name,
          modelSelection: { instanceId: snapshot.instanceId, model: snapshot.thread.model },
          runtimeMode: "approval-required",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          runDestination: snapshot.destination,
          importedNativeThread: { ref: { driver, nativeId: input.threadId, strength: "strong" } },
          createdBy: "system",
          creationSource: "server",
        });
        shell = yield* orchestrator.getThreadShell(threadId);
      }
      const active = yield* threadCommands.withLock(
        threadId,
        Effect.gen(function* () {
          const shell = yield* orchestrator.getThreadShell(threadId);
          if (!shell || shell.deletedAt !== null)
            return yield* new CloudChatError({ reason: "protocol" });
          const projection = yield* orchestrator.getThreadRecords(threadId, [
            "runs",
            "providerTurns",
            "providerThreads",
            "turnItems",
            "messages",
          ]);
          const providerThread = projection.providerThreads.find(
            (thread) => thread.id === shell.activeProviderThreadId,
          );
          if (!providerThread || providerThread.nativeThreadRef?.nativeId !== input.threadId)
            return yield* new CloudChatError({ reason: "protocol" });
          if (
            shell.runDestination?.accountId !== input.accountId ||
            shell.providerInstanceId !== snapshot.instanceId ||
            shell.runDestination.cwd !== snapshot.destination.cwd ||
            (shell.runDestination.existingThreadId !== undefined &&
              shell.runDestination.existingThreadId !== input.threadId)
          )
            return yield* new CloudChatError({ reason: "accountChanged" });
          // A newly accepted T3 turn may appear remotely before its adapter event.
          // Its run owns that turn even while the native turn ID is still unknown.
          if (
            projection.runs.some(
              (run) =>
                !run.id.startsWith(importedRunPrefix(threadId)) &&
                ["preparing", "starting", "running", "waiting"].includes(run.status),
            )
          )
            return false;
          const events: Array<OrchestrationV2DomainEvent> = [];
          let ordinal = Math.max(0, ...projection.runs.map((run) => run.ordinal));
          const at = (seconds: number | null | undefined) =>
            DateTime.makeUnsafe((seconds ?? snapshot.thread.createdAt) * 1000);
          const now = yield* DateTime.now;
          const event = () =>
            crypto.randomUUIDv4().pipe(
              Effect.orDie,
              Effect.map((id) => ({
                id: EventId.make(id),
                threadId,
                providerInstanceId: shell!.providerInstanceId,
                occurredAt: now,
              })),
            );
          let active = false;
          for (const turn of snapshot.turns) {
            if (known.has(turn.id)) continue;
            if (!["inProgress", "completed", "failed", "interrupted"].includes(turn.status ?? ""))
              return yield* new CloudChatError({ reason: "protocol" });
            const runId = RunId.make(`${importedRunPrefix(threadId)}${turn.id}`);
            const providerTurnId = IdAllocator.derive.providerTurn({
              driver,
              nativeTurnId: turn.id,
            });
            const existingTurn = projection.providerTurns.find(
              (candidate) => candidate.id === providerTurnId,
            );
            const previousRun = projection.runs.find((run) => run.id === runId);
            // The normal adapter owns every turn started by T3. Snapshot refreshes may
            // only update the turns that predate that ownership.
            if (existingTurn && !previousRun) continue;
            const status =
              turn.status === "inProgress"
                ? "running"
                : turn.status === "failed"
                  ? "failed"
                  : turn.status === "interrupted"
                    ? "interrupted"
                    : "completed";
            active ||= status === "running";
            const startedAt = at(turn.startedAt);
            const completedAt =
              status === "running" ? null : at(turn.completedAt ?? turn.startedAt);
            const rootNodeId = NodeId.make(`cloud-node:${threadId}:${turn.id}`);
            const firstUserItem = turn.items.find((item) => item.type === "userMessage");
            const userMessageId = IdAllocator.derive.messageFromProviderItem({
              driver,
              nativeItemId: firstUserItem?.id ?? `${turn.id}:input`,
            });
            const run: OrchestrationV2Run = {
              id: runId,
              threadId,
              ordinal: previousRun?.ordinal ?? ++ordinal,
              providerInstanceId: shell.providerInstanceId,
              modelSelection: shell.modelSelection,
              providerThreadId: providerThread.id,
              userMessageId,
              rootNodeId,
              activeAttemptId: null,
              status,
              requestedAt: startedAt,
              startedAt,
              completedAt,
              checkpointId: null,
              contextHandoffId: null,
            };
            if (!previousRun || previousRun.status !== status)
              events.push({
                ...(yield* event()),
                type: "node.updated",
                runId,
                payload: {
                  id: rootNodeId,
                  threadId,
                  runId,
                  parentNodeId: null,
                  rootNodeId,
                  kind: "root_turn",
                  status,
                  countsForRun: true,
                  providerThreadId: providerThread.id,
                  providerTurnId,
                  nativeItemRef: null,
                  runtimeRequestId: null,
                  checkpointScopeId: null,
                  startedAt,
                  completedAt,
                },
              });
            if (!existingTurn || existingTurn.status !== status)
              events.push({
                ...(yield* event()),
                type: "provider-turn.updated",
                runId,
                payload: {
                  id: providerTurnId,
                  providerThreadId: providerThread.id,
                  nodeId: rootNodeId,
                  runAttemptId: null,
                  nativeTurnRef: { driver, nativeId: turn.id, strength: "strong" },
                  ordinal: run.ordinal,
                  status,
                  startedAt,
                  completedAt,
                },
              });
            let itemOrdinal = 0;
            for (const item of turn.items) {
              const messageId = IdAllocator.derive.messageFromProviderItem({
                driver,
                nativeItemId: item.id,
              });
              const base = {
                id: IdAllocator.derive.turnItemFromProviderItem({ driver, nativeItemId: item.id }),
                threadId,
                runId,
                nodeId: rootNodeId,
                providerThreadId: providerThread.id,
                providerTurnId,
                nativeItemRef: { driver, nativeId: item.id, strength: "strong" as const },
                parentItemId: null,
                ordinal: ++itemOrdinal,
                status:
                  item.status === "inProgress"
                    ? ("running" as const)
                    : item.status === "failed"
                      ? ("failed" as const)
                      : ("completed" as const),
                title: null,
                startedAt,
                completedAt,
                updatedAt: completedAt ?? now,
              };
              let projected: OrchestrationV2TurnItem;
              if (item.type === "userMessage" || item.type === "agentMessage") {
                const role =
                  item.type === "userMessage" ? ("user" as const) : ("assistant" as const);
                const text =
                  role === "assistant"
                    ? (item.text ?? "")
                    : (item.content ?? [])
                        .flatMap((part) =>
                          typeof part === "string"
                            ? [part]
                            : part.type === "text"
                              ? [part.text ?? ""]
                              : [],
                        )
                        .join("\n");
                const previousMessage = projection.messages.find(
                  (candidate) => candidate.id === messageId,
                );
                if (!previousMessage || previousMessage.text !== text)
                  events.push({
                    ...(yield* event()),
                    type: "message.updated",
                    runId,
                    payload: {
                      createdBy: role === "user" ? "user" : "agent",
                      creationSource: "provider",
                      id: messageId,
                      threadId,
                      runId,
                      nodeId: rootNodeId,
                      role,
                      text,
                      attachments: [],
                      streaming: false,
                      createdAt: startedAt,
                      updatedAt: completedAt ?? now,
                    },
                  });
                projected =
                  role === "user"
                    ? {
                        ...base,
                        type: "user_message",
                        createdBy: "user",
                        creationSource: "provider",
                        messageId,
                        inputIntent: "turn_start",
                        text,
                        attachments: [],
                      }
                    : { ...base, type: "assistant_message", messageId, text, streaming: false };
              } else if (item.type === "commandExecution") {
                projected = {
                  ...base,
                  type: "command_execution",
                  input: item.command ?? "",
                  output: item.aggregatedOutput ?? "",
                };
              } else if (item.type === "reasoning") {
                projected = {
                  ...base,
                  type: "reasoning",
                  text: (item.summary ?? []).join("\n"),
                  streaming: false,
                };
              } else {
                projected = {
                  ...base,
                  type: "dynamic_tool",
                  toolName: item.tool ?? item.type,
                  input: item.arguments ?? {},
                  output: item.result ?? item.error,
                };
              }
              const previous = projection.turnItems.find(
                (candidate) => candidate.id === projected.id,
              );
              if (previous) projected = { ...projected, updatedAt: previous.updatedAt };
              if (!NodeUtil.isDeepStrictEqual(previous, projected))
                events.push({
                  ...(yield* event()),
                  type: "turn-item.updated",
                  runId,
                  payload: projected,
                });
            }
            if (!previousRun || previousRun.status !== status)
              events.push({ ...(yield* event()), type: "run.updated", runId, payload: run });
          }
          if (events.length) yield* sink.write({ events });
          return active;
        }),
      );
      // The normal terminal-run listener starts queued follow-ups after these events.
      const latest = yield* orchestrator.getThreadShell(threadId);
      const messages = yield* orchestrator.getThreadRecords(threadId, ["messages"]);
      const linked = new Set((latest?.pullRequests ?? []).map((pr) => pr.url));
      for (const message of messages.messages) {
        if (message.role !== "assistant") continue;
        for (const match of message.text.matchAll(
          /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g,
        )) {
          if (linked.has(match[0]) || Number(match[2]) < 1) continue;
          yield* orchestrator.dispatch({
            type: "thread.pull-request.link",
            commandId: yield* commandId(),
            threadId,
            host: "github.com",
            repository: match[1]!,
            number: Number(match[2]),
            url: match[0],
            source: "agent",
          });
          linked.add(match[0]);
        }
      }
      return { threadId, active };
    },
    serial.withPermits(1),
    Effect.tapError((error) => Effect.logWarning("Cloud binding failed", { errorTag: error._tag })),
    Effect.mapError((error) =>
      isCloudChatError(error) ? error : new CloudChatError({ reason: "protocol" }),
    ),
  );

  const monitor = Effect.fn("CloudThreadService.monitor")(function* (
    input: CloudChatOpenInput,
    threadId: ThreadId,
  ) {
    if (monitoring.has(threadId)) return;
    monitoring.add(threadId);
    yield* Effect.gen(function* () {
      let active = true;
      while (active) {
        yield* Effect.sleep("5 seconds");
        const refreshed = yield* synchronize(input).pipe(Effect.result);
        if (refreshed._tag === "Success") active = refreshed.success.active;
        else {
          yield* Effect.logWarning("Cloud conversation refresh failed", {
            threadId,
            reason: refreshed.failure.reason,
          });
          if (refreshed.failure.reason !== "connection") active = false;
        }
      }
    }).pipe(Effect.ensuring(Effect.sync(() => monitoring.delete(threadId))), Effect.forkIn(scope));
  });
  const open = Effect.fn("CloudThreadService.open")(function* (input: CloudChatOpenInput) {
    const result = yield* synchronize(input);
    if (result.active) yield* monitor(input, result.threadId);
    return { threadId: result.threadId };
  });
  // Remote work outlives this server. Restore its monitor without requiring a client.
  const snapshot = yield* orchestrator.getShellSnapshot().pipe(Effect.orDie);
  for (const shell of [...snapshot.threads, ...snapshot.archivedThreads]) {
    const destination = shell.runDestination;
    if (destination?.existingThreadId && shell.activeRunId?.startsWith(importedRunPrefix(shell.id)))
      yield* monitor(
        { accountId: destination.accountId, threadId: destination.existingThreadId },
        shell.id,
      );
  }
  return CloudThreadService.of({ open });
});

export const layer = Layer.effect(CloudThreadService, make);
