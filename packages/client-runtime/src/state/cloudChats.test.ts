import { expect, it, vi } from "@effect/vitest";
import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createCloudChatAtoms } from "./cloudChats.ts";

it.effect("shows a recently opened page immediately while refreshing and isolates accounts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
      const environmentId = EnvironmentId.make("cloud-test");
      const page = {
        threadId: "01a13ebf-a381-768e-baa7-f5475e3a6075",
        messages: [{ id: "reply", role: "assistant" as const, text: "Saved reply" }],
        nextCursor: null,
      };
      const refreshed = yield* Deferred.make<typeof page>();
      const refreshStarted = yield* Deferred.make<void>();
      let requests = 0;
      const supervisor = {
        target: { environmentId },
        state: yield* SubscriptionRef.make({
          ...AVAILABLE_CONNECTION_STATE,
          phase: "connected" as const,
        }),
        session: yield* SubscriptionRef.make(
          Option.some({
            client: {
              [WS_METHODS.cloudChatsRead]: () =>
                Effect.gen(function* () {
                  requests++;
                  if (requests === 1) return page;
                  yield* Deferred.succeed(refreshStarted, undefined);
                  return yield* Deferred.await(refreshed);
                }),
            },
          } as unknown as RpcSession),
        ),
      } as EnvironmentSupervisor.EnvironmentSupervisor["Service"];
      const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
        run: (_environmentId, effect) =>
          Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        followStream: (_environmentId, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
      const runtime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
      );
      const cloud = createCloudChatAtoms(runtime);
      const registry = AtomRegistry.make({ timeoutResolution: 100 });
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const target = { environmentId, input: { threadId: page.threadId, accountId: "account-a" } };
      const atom = cloud.read(target);
      const unmount = registry.mount(atom);
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
        page,
      );
      yield* Effect.yieldNow;
      unmount();
      yield* Effect.yieldNow;
      vi.advanceTimersByTime(6_000);
      yield* Effect.yieldNow;
      expect(requests).toBe(1);
      const close = registry.mount(cloud.read(target));
      expect(Option.getOrNull(AsyncResult.value(registry.get(atom)))).toEqual(page);
      vi.advanceTimersByTime(5_000);
      yield* Deferred.await(refreshStarted);
      expect(Option.getOrNull(AsyncResult.value(registry.get(atom)))).toEqual(page);
      const otherAccount = cloud.read({
        ...target,
        input: { ...target.input, accountId: "account-b" },
      });
      expect(Option.isNone(AsyncResult.value(registry.get(otherAccount)))).toBe(true);
      const updated = { ...page, messages: [{ ...page.messages[0]!, text: "Updated reply" }] };
      yield* Deferred.succeed(refreshed, updated);
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual(
        updated,
      );
      yield* Effect.yieldNow;
      close();
      yield* Effect.yieldNow;
      vi.advanceTimersByTime(31_000);
      yield* Effect.yieldNow;
      expect(Option.isNone(AsyncResult.value(registry.get(atom)))).toBe(true);
    }),
  ),
);
