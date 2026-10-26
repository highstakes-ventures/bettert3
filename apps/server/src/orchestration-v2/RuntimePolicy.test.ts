import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
  readonly threadId?: ThreadId;
}): OrchestrationV2AppThread {
  const threadId = input.threadId ?? ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const grokInstanceId = ProviderInstanceId.make("grok");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    driverKind: instanceId === grokInstanceId ? "grok" : "codex",
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const layerTest = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (id) =>
        Effect.succeed(
          id === "thread:missing"
            ? null
            : {
                ...liveThreadShell(id),
                ...(id === "thread:refinement" ? { ticketWorkflowId: "ticket" } : {}),
                ...(id === "thread:research"
                  ? {
                      lineage: {
                        rootThreadId: ThreadId.make("thread:refinement"),
                        parentThreadId: ThreadId.make("thread:refinement"),
                        relationshipToParent: "subagent" as const,
                      },
                    }
                  : {}),
              },
        ),
    }),
  ),
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Project",
            workspaceRoot: "/project-root",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
            deletedAt: null,
          }),
        ),
    }),
  ),
);

it.layer(layerTest)("RuntimePolicyV2", (it) => {
  it.effect("refuses a missing root instead of assuming it is unrestricted", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const result = yield* policy
        .resolve({
          thread: makeThread({
            now,
            threadId: ThreadId.make("thread:missing"),
            worktreePath: null,
          }),
          modelSelection,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.equal(result.failure._tag, "RuntimePolicyResolveError");
    }),
  );
  it.effect(
    "refuses a provider switch that cannot enforce refinement instead of granting writes",
    () =>
      Effect.gen(function* () {
        const policy = yield* RuntimePolicy.RuntimePolicyV2;
        const now = yield* DateTime.now;
        const outcome = yield* policy
          .resolve({
            thread: makeThread({
              now,
              threadId: ThreadId.make("thread:refinement"),
              worktreePath: null,
            }),
            modelSelection: { instanceId: grokInstanceId, model: "test" },
          })
          .pipe(Effect.result);
        assert.equal(outcome._tag, "Failure");
        if (outcome._tag === "Failure")
          assert.equal(outcome.failure._tag, "RefinementProviderUnsupportedError");
      }),
  );
  it.effect("keeps refinement and its research children read-only despite full access", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      for (const id of ["thread:refinement", "thread:research"]) {
        const resolved = yield* policy.resolve({
          thread: makeThread({
            now,
            threadId: ThreadId.make(id),
            worktreePath: null,
            runtimeMode: "full-access",
          }),
          modelSelection,
        });
        assert.equal(resolved.approvalPolicy, "never");
        assert.deepEqual(resolved.sandboxPolicy, { type: "readOnly" });
      }
    }),
  );

  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );
});

it.effect(
  "keeps the Cloud workspace and refuses a different provider without using the local project",
  () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const runDestination = {
        kind: "codexCloud" as const,
        accountId: "account",
        environmentConfigId: "workspace",
        name: "Cloud",
        cwd: "/workspace",
      };
      const thread = { ...makeThread({ now, worktreePath: null }), runDestination };
      assert.equal((yield* policy.resolve({ thread, modelSelection })).cwd, "/workspace");
      const failed = yield* policy
        .resolve({ thread, modelSelection: { ...modelSelection, instanceId: grokInstanceId } })
        .pipe(Effect.result);
      assert.equal(failed._tag, "Failure");
    }).pipe(Effect.provide(layerTest)),
);
