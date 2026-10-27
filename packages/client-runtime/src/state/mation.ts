import type { MationFrontendRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";
import { createEnvironmentCommand } from "./runtime.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import * as Authorization from "../authorization/service.ts";
import * as Signer from "../relay/managedRelay.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

type MationInput = { type: "page" } | { type: "request"; request: MationFrontendRequest };
export const fetchEnvironmentMation = Effect.fn("clientRuntime.state.fetchEnvironmentMation")(
  function* (input: {
    prepared: PreparedConnection;
    signer: Option.Option<Signer.ManagedRelayDpopSigner["Service"]>;
    remoteAuthorization?: Option.Option<Authorization.RemoteEnvironmentAuthorization["Service"]>;
    request: MationInput;
  }) {
    const common = {
      prepared: input.prepared,
      signer: input.signer,
      ...(input.remoteAuthorization === undefined
        ? {}
        : { remoteAuthorization: input.remoteAuthorization }),
      timeoutMs: 30_000,
    };
    if (input.request.type === "page")
      return yield* executeAuthenticatedEnvironmentHttpRequest({
        ...common,
        group: "mation",
        method: "GET",
        url: (urls) => urls.page(),
        request: ({ client, headers }) => client.page({ headers }),
      });
    const payload = input.request.request;
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      ...common,
      group: "mation",
      method: "POST",
      url: (urls) => urls.frontendRequest(),
      request: ({ client, headers }) => client.frontendRequest({ headers, payload }),
    });
  },
);

export function createMationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return {
    request: createEnvironmentCommand(runtime, {
      label: "environment-data:mation",
      execute: Effect.fn("clientRuntime.state.mation.request")(function* (input: MationInput) {
        const supervisor = yield* Supervisor.EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared))
          return yield* new EnvironmentRpcUnavailableError({
            environmentId: supervisor.target.environmentId,
            message: "The T3 environment is disconnected.",
          });
        return yield* fetchEnvironmentMation({
          request: input,
          prepared: prepared.value,
          signer: yield* Effect.serviceOption(Signer.ManagedRelayDpopSigner),
          remoteAuthorization: yield* Effect.serviceOption(
            Authorization.RemoteEnvironmentAuthorization,
          ),
        });
      }),
    }),
  };
}
