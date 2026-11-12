import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  BetterT3HttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { failEnvironmentInternal, requireEnvironmentScope } from "../auth/http.ts";
import * as TodoService from "./TodoService.ts";

export const layer = HttpApiBuilder.group(
  BetterT3HttpApi,
  "todo",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* TodoService.TodoService;
    const failure = {
      TodoOperationError: (error: TodoService.TodoOperationError) =>
        failEnvironmentInternal("internal_error", error),
    };
    return handlers
      .handle(
        "page",
        Effect.fn("environment.todo.page")(function* () {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service.page.pipe(Effect.catchTags(failure));
        }),
      )
      .handle(
        "frontendRequest",
        Effect.fn("environment.todo.frontendRequest")(function* (args) {
          yield* requireEnvironmentScope(
            args.payload.method === "GET"
              ? AuthOrchestrationReadScope
              : AuthOrchestrationOperateScope,
          );
          return yield* service.request(args.payload).pipe(Effect.catchTags(failure));
        }),
      );
  }),
);
