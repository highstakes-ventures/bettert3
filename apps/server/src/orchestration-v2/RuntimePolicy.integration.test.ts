import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("This test does not start provider processes."),
} satisfies ProviderAdapter.ProviderAdapterV2["Service"];
const database = Sqlite.layerMemory;
const runtimeLayer = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
  Layer.provide(database),
  Layer.provide(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () =>
        Effect.succeed({
          driverKind: "codex",
          snapshot: { getSnapshot: Effect.succeed({}) },
        } as ProviderInstance),
    }),
  ),
  Layer.orDie,
);
const layerTest = Layer.mergeAll(
  database,
  runtimeLayer,
  ProviderReplayHarness.layerWithRegistry(
    { name: "workflow-runtime-policy" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runtimePolicyLayer: runtimeLayer, runEffectWorker: false },
  ),
);

it.live.each([false, true])(
  "starts shared-checkout delegation with the real runtime policy, refinement=%s",
  (refinement) =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* checkpointWorkspace("workflow-runtime-policy");
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const runtime = yield* RuntimePolicy.RuntimePolicyV2;
        const sql = yield* SqlClient.SqlClient;
        const parentId = ThreadId.make("parent");
        const projectId = ProjectId.make("project");
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create"),
          threadId: parentId,
          projectId,
          title: "Parent",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          createdBy: "user",
          creationSource: "web",
        });
        if (refinement) {
          yield* sql`INSERT INTO workflow_runs (id, project_id, run_json)
          VALUES ('ticket', ${projectId}, ${JSON.stringify({ id: "ticket", kind: "tickets", threadId: parentId, phase: "review" })})`;
        }
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("start"),
          threadId: parentId,
          messageId: MessageId.make("start"),
          text: "Research",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        const parent = yield* orchestrator.getThreadProjection(parentId);
        const run = parent.runs[0];
        assert.ok(run?.rootNodeId);
        const delegated = yield* orchestrator.dispatch({
          type: "delegated_task.request",
          commandId: CommandId.make("delegate"),
          parentThreadId: parentId,
          parentRunId: run.id,
          parentNodeId: run.rootNodeId,
          task: "Read the code",
          modelSelection,
          runtimeMode: refinement ? "approval-required" : "full-access",
          interactionMode: refinement ? "plan" : "default",
          createdBy: "agent",
          creationSource: "mcp",
        });
        const created = delegated.storedEvents.find(
          ({ event }) => event.type === "thread.created",
        )?.event;
        assert.equal(created?.type, "thread.created");
        if (created?.type !== "thread.created") return;
        const child = yield* orchestrator.getThreadProjection(created.threadId);
        assert.equal(child.thread.lineage.parentThreadId, parentId);
        assert.equal(child.runs.length, 1);
        const resolved = yield* runtime.resolve({ thread: child.thread, modelSelection });
        if (refinement) {
          assert.equal(resolved.ticketRefinement, true);
          assert.equal(resolved.approvalPolicy, "never");
          assert.deepEqual(resolved.sandboxPolicy, { type: "readOnly" });
        } else {
          assert.equal(resolved.runtimeMode, "full-access");
          assert.equal(resolved.ticketRefinement, undefined);
          assert.equal(resolved.sandboxPolicy, undefined);
        }
      }).pipe(Effect.provide(layerTest)),
    ),
);
