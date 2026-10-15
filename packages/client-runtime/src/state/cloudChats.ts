import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { Atom } from "effect/reactivity";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createCloudChatAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud-chats:list",
      tag: WS_METHODS.cloudChatsList,
      refreshIntervalMs: 45_000,
      staleTimeMs: 30_000,
      idleTtlMs: 0,
    }),
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud-chats:read",
      tag: WS_METHODS.cloudChatsRead,
      refreshIntervalMs: 15_000,
      staleTimeMs: 10_000,
      idleTtlMs: 0,
    }),
  };
}
