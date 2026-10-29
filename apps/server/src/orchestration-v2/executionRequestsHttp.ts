import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ExecutionHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import {
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as Execution from "./ExecutionRequestService.ts";

const failure = {
  ExecutionNotFoundError: () => failEnvironmentNotFound("thread_not_found"),
  ExecutionConflictError: () => failEnvironmentInvalidRequest("invalid_command"),
  ExecutionOperationError: (error: Execution.ExecutionOperationError) =>
    failEnvironmentInternal("internal_error", error),
};
export const layer = HttpApiBuilder.group(
  ExecutionHttpApi,
  "executions",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* Execution.ExecutionRequestService;
    return handlers
      .handle(
        "capabilities",
        Effect.fn("environment.executions.capabilities")(function* () {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service.capabilities.pipe(
            Effect.catchTags({ ExecutionOperationError: failure.ExecutionOperationError }),
          );
        }),
      )
      .handle(
        "get",
        Effect.fn("environment.executions.get")(function* (args) {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service
            .get(args.params.commandId, args.query)
            .pipe(Effect.catchTags(failure));
        }),
      )
      .handle(
        "start",
        Effect.fn("environment.executions.start")(function* (args) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* service
            .start(args.params.commandId, args.payload)
            .pipe(Effect.catchTags(failure));
        }),
      );
  }),
);
