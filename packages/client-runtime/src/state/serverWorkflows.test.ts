import { expect, it, vi } from "@effect/vitest";
import { EnvironmentId, WS_METHODS, type WorkflowDetail } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createServerEnvironmentAtoms } from "./server.ts";

it.effect(
  "refreshes only mounted ticket details and stops immediately when closed or switched",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
        const environmentId = EnvironmentId.make("workflow-test");
        const reads: string[] = [];
        const supervisor = {
          target: { environmentId },
          state: yield* SubscriptionRef.make({
            ...AVAILABLE_CONNECTION_STATE,
            phase: "connected" as const,
          }),
          session: yield* SubscriptionRef.make(
            Option.some({
              client: {
                [WS_METHODS.workflowsRead]: ({ runId }: { runId: string }) =>
                  Effect.sync(() => {
                    reads.push(runId);
                    return {
                      run: { id: runId },
                      ticket: null,
                      questions: [],
                      dependencyEvidence: [],
                    } as unknown as WorkflowDetail;
                  }),
              },
            } as unknown as RpcSession),
          ),
        } as EnvironmentSupervisor.EnvironmentSupervisor["Service"];
        const environments = EnvironmentRegistry.EnvironmentRegistry.of({
          run: (_environmentId, effect) =>
            Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
          followStream: (_environmentId, stream) =>
            Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
        const runtime = Atom.runtime(
          Layer.merge(
            Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
            Layer.mock(Persistence.EnvironmentCacheStore)({}),
          ),
        );
        const server = createServerEnvironmentAtoms(runtime, {
          initialConfigValueAtom: () => Atom.make(null),
        });
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const first = server.workflowDetail({ environmentId, input: { runId: "first" } });
        server.workflowDetail({ environmentId, input: { runId: "unopened" } });
        const closeFirst = registry.mount(first);
        yield* AtomRegistry.getResult(registry, first, { suspendOnWaiting: true });
        expect(reads).toEqual(["first"]);

        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(30_000));
        expect(reads).toEqual(["first", "first"]);
        closeFirst();
        yield* Effect.yieldNow;

        const second = server.workflowDetail({ environmentId, input: { runId: "second" } });
        const closeSecond = registry.mount(second);
        yield* AtomRegistry.getResult(registry, second, { suspendOnWaiting: true });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(30_000));
        expect(reads).toEqual(["first", "first", "second", "second"]);
        closeSecond();
        yield* Effect.yieldNow;
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(60_000));
        expect(reads).toEqual(["first", "first", "second", "second"]);
      }),
    ),
);
