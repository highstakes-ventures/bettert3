import type { TodoFrontendRequest } from "@t3tools/contracts";
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

type TodoInput = { type: "page" } | { type: "request"; request: TodoFrontendRequest };
const fetchEnvironmentTodo = Effect.fn("clientRuntime.state.fetchEnvironmentTodo")(
  function* (input: {
    prepared: PreparedConnection;
    signer: Option.Option<Signer.ManagedRelayDpopSigner["Service"]>;
    remoteAuthorization?: Option.Option<Authorization.RemoteEnvironmentAuthorization["Service"]>;
    request: TodoInput;
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
        group: "todo",
        method: "GET",
        url: (urls) => urls.page(),
        request: ({ client, headers }) => client.page({ headers }),
      });
    const payload = input.request.request;
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      ...common,
      group: "todo",
      method: "POST",
      url: (urls) => urls.frontendRequest(),
      request: ({ client, headers }) => client.frontendRequest({ headers, payload }),
    });
  },
);

export const requestEnvironmentTodo = Effect.fn("clientRuntime.state.todo.request")(function* (
  input: TodoInput,
) {
  const supervisor = yield* Supervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared))
    return yield* new EnvironmentRpcUnavailableError({
      environmentId: supervisor.target.environmentId,
      message: "The T3 environment is disconnected.",
    });
  return yield* fetchEnvironmentTodo({
    request: input,
    prepared: prepared.value,
    signer: yield* Effect.serviceOption(Signer.ManagedRelayDpopSigner),
    remoteAuthorization: yield* Effect.serviceOption(Authorization.RemoteEnvironmentAuthorization),
  });
});

export function createTodoEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return {
    request: createEnvironmentCommand(runtime, {
      label: "environment-data:todo",
      execute: requestEnvironmentTodo,
    }),
  };
}
