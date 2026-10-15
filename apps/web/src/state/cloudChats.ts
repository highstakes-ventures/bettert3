import { createCloudChatAtoms } from "@t3tools/client-runtime/state/cloud-chats";
import { connectionAtomRuntime } from "../connection/runtime";

export const cloudChats = createCloudChatAtoms(connectionAtomRuntime);
