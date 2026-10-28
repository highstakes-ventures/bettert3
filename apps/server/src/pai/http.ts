import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { failEnvironmentInternal, requireEnvironmentScope } from "../auth/http.ts";
import * as Pai from "./PaiService.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "pai",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* Pai.PaiService;
    const failure = (error: unknown) => failEnvironmentInternal("internal_error", error);
    return handlers
      .handle(
        "page",
        Effect.fn("environment.pai.page")(function* () {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* service.page.pipe(Effect.catchTags({ PaiOperationError: failure }));
        }),
      )
      .handle(
        "request",
        Effect.fn("environment.pai.request")(function* (args) {
          yield* requireEnvironmentScope(
            args.payload.method === "GET"
              ? AuthOrchestrationReadScope
              : AuthOrchestrationOperateScope,
          );
          return yield* service
            .request(args.payload)
            .pipe(Effect.catchTags({ PaiOperationError: failure }));
        }),
      );
  }),
);
