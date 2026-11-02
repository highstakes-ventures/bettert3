import { createTodoEnvironmentAtoms } from "@t3tools/client-runtime/state/todo";
import { connectionAtomRuntime } from "../connection/runtime";
export const todoEnvironment = createTodoEnvironmentAtoms(connectionAtomRuntime);
