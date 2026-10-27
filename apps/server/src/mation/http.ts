import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as AutomationExecutionService from "./AutomationExecutionService.ts";

const failure = {
  MationNotFoundError: () => failEnvironmentNotFound("thread_not_found"),
  MationConflictError: () => failEnvironmentInvalidRequest("invalid_command"),
  MationOperationError: (error: AutomationExecutionService.MationOperationError) =>
    failEnvironmentInternal("internal_error", error),
};
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "mation",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* AutomationExecutionService.AutomationExecutionService;
    return handlers
      .handle(
        "page",
        Effect.fn("environment.mation.page")(function* () {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service.frontend.pipe(
            Effect.catchTags({ MationOperationError: failure.MationOperationError }),
          );
        }),
      )
      .handle(
        "frontendRequest",
        Effect.fn("environment.mation.frontendRequest")(function* (args) {
          yield* requireEnvironmentScope(
            args.payload.method === "GET"
              ? AuthOrchestrationReadScope
              : AuthOrchestrationOperateScope,
          );
          return yield* service.frontendRequest(args.payload).pipe(Effect.catchTags(failure));
        }),
      )
      .handle(
        "projects",
        Effect.fn("environment.mation.projects")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service.projects.pipe(
            Effect.catchTags({ MationOperationError: failure.MationOperationError }),
          );
        }),
      )
      .handle(
        "execution",
        Effect.fn("environment.mation.execution")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service
            .get(args.params.requestId, args.query)
            .pipe(Effect.catchTags(failure));
        }),
      )
      .handle(
        "startExecution",
        Effect.fn("environment.mation.startExecution")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* service
            .start(args.params.requestId, args.payload)
            .pipe(Effect.catchTags(failure));
        }),
      );
  }),
);
