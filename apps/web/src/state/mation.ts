import { createMationEnvironmentAtoms } from "@t3tools/client-runtime/state/mation";
import { connectionAtomRuntime } from "../connection/runtime";
export const mationEnvironment = createMationEnvironmentAtoms(connectionAtomRuntime);
