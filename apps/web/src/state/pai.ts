import { createPaiEnvironmentAtoms } from "@t3tools/client-runtime/state/pai";
import { connectionAtomRuntime } from "../connection/runtime";

export const paiEnvironment = createPaiEnvironmentAtoms(connectionAtomRuntime);
