import { createCloudChatAtoms } from "@t3tools/client-runtime/state/cloud-chats";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";

export const cloudChats = createCloudChatAtoms(connectionAtomRuntime);
export const cloudChatPeriodAtom = Atom.make<"week" | "all">("week");
