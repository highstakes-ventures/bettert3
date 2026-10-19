import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { Atom } from "effect/reactivity";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createCloudChatAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const history = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:cloud-chats:read",
    tag: WS_METHODS.cloudChatsRead,
    staleTimeMs: 3_000,
    idleTtlMs: 30_000,
  });
  // Keep recent pages, but dispose each polling timer as soon as its view closes.
  const pollingHistory = Atom.family((atom: ReturnType<typeof history>) =>
    atom.pipe(Atom.withRefresh(5_000), Atom.setIdleTTL(0)),
  );
  return {
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cloud-chats:open",
      tag: WS_METHODS.cloudChatsOpen,
    }),
    destinations: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud-chats:destinations",
      tag: WS_METHODS.cloudChatsDestinations,
      refreshIntervalMs: 60_000,
      staleTimeMs: 30_000,
      idleTtlMs: 0,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud-chats:list",
      tag: WS_METHODS.cloudChatsList,
      refreshIntervalMs: 45_000,
      staleTimeMs: 30_000,
      idleTtlMs: 0,
    }),
    read: (target: Parameters<typeof history>[0]) => pollingHistory(history(target)),
  };
}
