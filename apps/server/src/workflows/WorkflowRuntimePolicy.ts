import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as WorkflowThreadPolicy from "./WorkflowThreadPolicy.ts";

export const layer = Layer.effect(
  RuntimePolicy.RuntimePolicyV2,
  Effect.gen(function* () {
    const base = yield* RuntimePolicy.RuntimePolicyV2;
    const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    return RuntimePolicy.RuntimePolicyV2.of({
      resolve: Effect.fn("WorkflowRuntimePolicy.resolve")(function* (input) {
        const refinement = yield* Effect.gen(function* () {
          const shell = yield* projections.getThreadShell(input.thread.id);
          if (shell === null && input.thread.lineage.parentThreadId === null)
            return yield* new WorkflowThreadPolicy.WorkflowThreadPolicyError({
              threadId: input.thread.id,
            });
          // A delegated child's first dispatch resolves policy before its creation commits.
          return yield* WorkflowThreadPolicy.resolve(
            shell ?? input.thread,
            projections.getThreadShell,
          );
        }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimePolicy.RuntimePolicyResolveError({
                projectId: input.thread.projectId,
                providerInstanceId: input.modelSelection.instanceId,
                cause,
              }),
          ),
        );
        const instance = refinement
          ? yield* providerInstances.getInstance(input.modelSelection.instanceId)
          : undefined;
        if (
          refinement &&
          (input.thread.runDestination !== undefined ||
            (instance?.driverKind !== "codex" && instance?.driverKind !== "claude"))
        ) {
          return yield* new RuntimePolicy.RefinementProviderUnsupportedError({
            providerInstanceId: input.modelSelection.instanceId,
          });
        }
        const policy = yield* base.resolve(input);
        return refinement
          ? {
              ...policy,
              ticketRefinement: true,
              interactionMode: "plan" as const,
              approvalPolicy: "never",
              sandboxPolicy: { type: "readOnly" },
            }
          : policy;
      }),
    });
  }),
);
