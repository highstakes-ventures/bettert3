import type { MarketingStudioRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";
import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Supervisor from "../connection/supervisor.ts";
import * as Authorization from "../authorization/service.ts";
import * as Signer from "../relay/managedRelay.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentCommand, createEnvironmentQueryAtomFamily } from "./runtime.ts";

type Input = MarketingStudioRequest;

const fetchEnvironmentMarketing = Effect.fn("clientRuntime.state.fetchEnvironmentMarketing")(
  function* (input: {
    prepared: PreparedConnection;
    signer: Option.Option<Signer.ManagedRelayDpopSigner["Service"]>;
    remoteAuthorization?: Option.Option<Authorization.RemoteEnvironmentAuthorization["Service"]>;
    request: Input;
  }) {
    const common = {
      prepared: input.prepared,
      signer: input.signer,
      ...(input.remoteAuthorization === undefined
        ? {}
        : { remoteAuthorization: input.remoteAuthorization }),
      timeoutMs: 35_000,
    };
    const payload = input.request;
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      ...common,
      group: "marketing",
      method: "POST",
      url: (urls) => urls.studio(),
      request: ({ client, headers }) => client.studio({ headers, payload }),
    });
  },
);

const requestEnvironmentMarketing = Effect.fn("clientRuntime.state.marketing.request")(function* (
  input: Input,
) {
  const supervisor = yield* Supervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared))
    return yield* new EnvironmentRpcUnavailableError({
      environmentId: supervisor.target.environmentId,
      message: "The T3 environment is disconnected.",
    });
  return yield* fetchEnvironmentMarketing({
    request: input,
    prepared: prepared.value,
    signer: yield* Effect.serviceOption(Signer.ManagedRelayDpopSigner),
    remoteAuthorization: yield* Effect.serviceOption(Authorization.RemoteEnvironmentAuthorization),
  });
});
export function createMarketingEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return {
    read: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:marketing:read",
      refreshIntervalMs: 5000,
      staleTimeMs: 0,
      idleTtlMs: 0,
      execute: requestEnvironmentMarketing,
    }),
    request: createEnvironmentCommand(runtime, {
      label: "environment-data:marketing",
      execute: requestEnvironmentMarketing,
    }),
  };
}
