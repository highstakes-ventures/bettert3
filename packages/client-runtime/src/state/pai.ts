import type { PaiWidgetRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";
import { createEnvironmentCommand } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import * as Authorization from "../authorization/service.ts";
import * as Signer from "../relay/managedRelay.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

export function createPaiEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return {
    request: createEnvironmentCommand(runtime, {
      label: "environment-data:pai",
      execute: Effect.fn("clientRuntime.state.pai.request")(function* (
        input: { type: "page" } | { type: "request"; request: PaiWidgetRequest },
      ) {
        const supervisor = yield* Supervisor.EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared))
          return yield* new EnvironmentRpcUnavailableError({
            environmentId: supervisor.target.environmentId,
            message: "The T3 environment is disconnected.",
          });
        const common = {
          prepared: prepared.value,
          signer: yield* Effect.serviceOption(Signer.ManagedRelayDpopSigner),
          remoteAuthorization: yield* Effect.serviceOption(
            Authorization.RemoteEnvironmentAuthorization,
          ),
          timeoutMs: 30000,
        };
        if (input.type === "page")
          return yield* executeAuthenticatedEnvironmentHttpRequest({
            ...common,
            group: "pai",
            method: "GET",
            url: (urls) => urls.page(),
            request: ({ client, headers }) => client.page({ headers }),
          });
        const payload = input.request;
        return yield* executeAuthenticatedEnvironmentHttpRequest({
          ...common,
          group: "pai",
          method: "POST",
          url: (urls) => urls.request(),
          request: ({ client, headers }) => client.request({ headers, payload }),
        });
      }),
    }),
  };
}
