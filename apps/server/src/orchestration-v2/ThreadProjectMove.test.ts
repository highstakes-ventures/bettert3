import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Moving a stopped chat must not start a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const database = SqlitePersistence.layerMemory;
const layer = Layer.mergeAll(
  database,
  NodeServices.layer,
  ProjectStore.layer.pipe(Layer.provide(database)),
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "project-move" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);
const sourceProjectId = ProjectId.make("source");
const targetProjectId = ProjectId.make("target");
const threadId = ThreadId.make("existing-chat");
const seed = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-move-" });
  const other = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-other-" });
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  for (const [id, workspaceRoot] of [
    [sourceProjectId, root + "/."],
    [targetProjectId, root],
    [ProjectId.make("other"), other],
  ] as const) {
    yield* projects.apply({
      sequence: 1,
      eventId: EventId.make(`project-${id}`),
      aggregateKind: "project",
      aggregateId: id,
      occurredAt: "2026-10-30T00:00:00Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: id,
        title: id,
        workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-10-30T00:00:00Z",
        updatedAt: "2026-10-30T00:00:00Z",
      },
    });
  }
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create"),
    threadId,
    projectId: sourceProjectId,
    title: "Keep my history",
    modelSelection,
    runtimeMode: "auto",
    interactionMode: "default",
    branch: "feature/original",
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const now = yield* DateTime.now;
  yield* projections.apply({
    id: EventId.make("message"),
    type: "message.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: MessageId.make("original-message"),
      threadId,
      runId: null,
      nodeId: null,
      role: "user",
      text: "Retain this conversation",
      attachments: [],
      streaming: false,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      creationSource: "web",
    },
  });
  yield* orchestrator.dispatch({
    type: "thread.settle",
    commandId: CommandId.make("settle"),
    threadId,
  });
  return { orchestrator, projections, root };
});
const move = {
  type: "thread.project.move" as const,
  commandId: CommandId.make("move"),
  threadId,
  sourceProjectId,
  targetProjectId,
};

it.effect(
  "moves the same stopped chat and its visible history without changing activity or settlement",
  () =>
    Effect.gen(function* () {
      const { orchestrator, projections } = yield* seed;
      const before = yield* projections.getThreadProjection(threadId);
      yield* orchestrator.dispatch(move);
      yield* orchestrator.dispatch(move);
      const after = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(after.thread, { ...before.thread, projectId: targetProjectId });
      for (const field of [
        "messages",
        "runs",
        "nodes",
        "providerSessions",
        "providerThreads",
        "subagents",
        "turnItems",
      ] as const)
        assert.deepEqual(after[field], before[field]);
      assert.equal((yield* projections.getThreadShell(threadId))?.projectId, targetProjectId);
      assert.equal(
        (yield* projections.getShellSnapshot({ projectId: sourceProjectId })).threads.length,
        0,
      );
      assert.equal(
        (yield* projections.getShellSnapshot({ projectId: targetProjectId })).threads.length,
        1,
      );
    }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("moves archived chats without unarchiving or changing their IDs", () =>
  Effect.gen(function* () {
    const { orchestrator, projections } = yield* seed;
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive"),
      threadId,
    });
    const before = yield* projections.getThreadProjection(threadId);
    yield* orchestrator.dispatch(move);
    const after = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(after.thread, { ...before.thread, projectId: targetProjectId });
    assert.equal(
      (yield* projections.getShellSnapshot({ projectId: sourceProjectId })).archivedThreads.length,
      0,
    );
    assert.equal(
      (yield* projections.getShellSnapshot({ projectId: targetProjectId })).archivedThreads.length,
      1,
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect(
  "rejects missing destinations, different checkouts, and stale source ownership without moving history",
  () =>
    Effect.gen(function* () {
      const { orchestrator, projections } = yield* seed;
      const before = yield* projections.getThreadProjection(threadId);
      for (const [key, patch] of [
        ["missing", { targetProjectId: ProjectId.make("missing") }],
        ["different", { targetProjectId: ProjectId.make("other") }],
        ["stale", { sourceProjectId: ProjectId.make("other") }],
      ] as const) {
        assert.equal(
          (yield* Effect.exit(
            orchestrator.dispatch({ ...move, commandId: CommandId.make(key), ...patch }),
          ))._tag,
          "Failure",
        );
        assert.deepEqual((yield* projections.getThreadProjection(threadId)).thread, before.thread);
      }
    }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("clears a stale section while preserving the rest of the chat", () =>
  Effect.gen(function* () {
    const { orchestrator, projections } = yield* seed;
    const projection = yield* projections.getThreadProjection(threadId);
    yield* projections.apply({
      id: EventId.make("historical-section"),
      type: "thread.metadata-updated",
      threadId,
      occurredAt: yield* DateTime.now,
      payload: { ...projection.thread, sectionId: "removed-project-section" },
    });
    const before = yield* projections.getThreadProjection(threadId);
    yield* orchestrator.dispatch(move);
    const after = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(after.thread, {
      ...before.thread,
      projectId: targetProjectId,
      sectionId: null,
    });
    assert.deepEqual(after.messages, before.messages);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("rejects queued work instead of rebinding a provider execution", () =>
  Effect.gen(function* () {
    const { orchestrator, projections } = yield* seed;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("queued-work"),
      threadId,
      messageId: MessageId.make("queued-message"),
      text: "Do some work",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    assert.equal((yield* Effect.exit(orchestrator.dispatch(move)))._tag, "Failure");
    assert.equal(
      (yield* projections.getThreadProjection(threadId)).thread.projectId,
      sourceProjectId,
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
