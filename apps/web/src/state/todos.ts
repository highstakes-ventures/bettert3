import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { requestEnvironmentTodo } from "@t3tools/client-runtime/state/todo";
import { createEnvironmentQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSummaries } from "./presentation";

const TodoList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      completedAt: Schema.NullOr(Schema.String),
      sourceChat: Schema.optionalKey(
        Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId }),
      ),
    }),
  ),
});
const decodeList = Schema.decodeUnknownEffect(Schema.fromJsonString(TodoList));

class TodoUnavailable extends Schema.TaggedError<TodoUnavailable>()("TodoUnavailable", {
  message: Schema.String,
}) {}

const changes = Atom.make((get) => {
  let version = 0;
  const refresh = () => {
    if (document.hidden) return;
    version = version + 1;
    get.setSelf(version);
  };
  window.addEventListener("t3:todos-changed", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  get.addFinalizer(() => {
    window.removeEventListener("t3:todos-changed", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  });
  return version;
});

export const todoList = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "todos",
  execute: Effect.fn("web.todo.todos")(function* (_input: Record<string, never>) {
    const reply = yield* requestEnvironmentTodo({
      type: "request",
      request: { path: "todos", method: "GET" },
    });
    if (!("status" in reply) || reply.status !== 200)
      return yield* new TodoUnavailable({ message: "Could not load personal todos." });
    return yield* decodeList(reply.body);
  }),
  refreshIntervalMs: 30_000,
  refreshTrigger: () => changes,
});

export const todoThreadKeysAtom = Atom.make((get): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const environmentId of get(environmentSummaries.environmentIdsAtom)) {
    const list = Option.getOrNull(AsyncResult.value(get(todoList({ environmentId, input: {} }))));
    for (const todo of list?.items ?? []) {
      if (todo.completedAt === null && todo.sourceChat) keys.add(scopedThreadKey(todo.sourceChat));
    }
  }
  const previous = Option.getOrUndefined(get.self<ReadonlySet<string>>());
  return previous && previous.size === keys.size && [...keys].every((key) => previous.has(key))
    ? previous
    : keys;
});
