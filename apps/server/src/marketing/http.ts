import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import {
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as Marketing from "./MarketingService.ts";
const failure = (e: Marketing.MarketingFailure) =>
  e.reason === "unavailable"
    ? failEnvironmentInternal("internal_error", e)
    : failEnvironmentInvalidRequest("invalid_command");
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "marketing",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* Marketing.MarketingService;
    return handlers
      .handle(
        "studio",
        Effect.fn("marketing.http.studio")(function* (args) {
          yield* requireEnvironmentScope(
            args.payload.command ? AuthOrchestrationOperateScope : AuthOrchestrationReadScope,
          );
          if (args.payload.command)
            yield* service
              .human(args.payload.threadId, args.payload.command)
              .pipe(Effect.catchTags({ MarketingFailure: failure }));
          return yield* service
            .context(args.payload.threadId)
            .pipe(Effect.catchTags({ MarketingFailure: failure }));
        }),
      )
      .handle(
        "collect",
        Effect.fn("marketing.http.collect")(function* (args) {
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* service
            .collect(args.payload)
            .pipe(Effect.catchTags({ MarketingFailure: failure }));
        }),
      );
  }),
);
