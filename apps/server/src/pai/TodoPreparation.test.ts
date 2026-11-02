import { it, expect } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TodoPreparationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Mation from "../mation/AutomationExecutionService.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as Pai from "./PaiService.ts";

const decodePreparation = Schema.decodeUnknownEffect(TodoPreparationInput);
const requestId = "00000000-0000-4000-8000-000000000001";
const input = {
  todoId: "00000000-0000-4000-8000-000000000002",
  requestId,
  title: "Call the accountant",
  scope: ["Ask about contribution options."],
  returnOn: "2026-11-02",
};
const caller = {
  id: ThreadId.make("preparation-chat"),
  projectId: ProjectId.make("mation"),
  activeRunId: RunId.make("preparation-run"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto" as const,
  interactionMode: "default" as const,
};

it.effect("preparation validates the calling run before forwarding a server-owned source", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    let payload: unknown;
    const dependencies = Layer.mergeAll(
      Layer.mock(Mation.AutomationExecutionService)({
        assertCaller: (id, source) =>
          Effect.sync(() => {
            calls.push("validate");
            expect(id).toBe(requestId);
            expect(source).toEqual({ threadId: caller.id, runId: caller.activeRunId });
          }),
        proxy: (path, method, body) =>
          Effect.sync(() => {
            calls.push("save");
            expect(path).toBe(`/api/todo-preparations/${input.todoId}/result`);
            expect(method).toBe("POST");
            payload = JSON.parse(new TextDecoder().decode(body));
            return {
              status: 200,
              body: new TextEncoder().encode("{}"),
              contentType: "application/json",
            };
          }),
      }),
      Layer.mock(Environment.ServerEnvironmentIdentity)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("server-env")),
      }),
    );
    const result = yield* Effect.gen(function* () {
      return yield* (yield* Pai.PaiService).prepareTodo(input, caller);
    }).pipe(Effect.provide(Pai.layer.pipe(Layer.provide(dependencies))));
    expect(result).toEqual({ prepared: true });
    expect(calls).toEqual(["validate", "save"]);
    expect(payload).toEqual({
      requestId,
      result: { title: input.title, scope: input.scope, returnOn: input.returnOn },
      source: { environmentId: "server-env", threadId: caller.id, runId: caller.activeRunId },
    });
  }),
);

it.effect("another preparation run is rejected before contacting the todo store", () =>
  Effect.gen(function* () {
    let forwarded = false;
    const dependencies = Layer.mergeAll(
      Layer.mock(Mation.AutomationExecutionService)({
        assertCaller: () => Effect.fail(new Mation.MationConflictError({ requestId })),
        proxy: () =>
          Effect.sync(() => {
            forwarded = true;
            throw new Error("must not forward");
          }),
      }),
      Layer.mock(Environment.ServerEnvironmentIdentity)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("server-env")),
      }),
    );
    const exit = yield* Effect.gen(function* () {
      return yield* (yield* Pai.PaiService).prepareTodo(input, caller);
    }).pipe(Effect.provide(Pai.layer.pipe(Layer.provide(dependencies))), Effect.exit);
    expect(exit._tag).toBe("Failure");
    expect(forwarded).toBe(false);
  }),
);

it.effect("the preparation contract rejects a third scope sentence", () =>
  Effect.gen(function* () {
    const result = yield* decodePreparation({
      ...input,
      scope: ["One.", "Two.", "Three."],
    }).pipe(Effect.exit);
    expect(result._tag).toBe("Failure");
  }),
);
