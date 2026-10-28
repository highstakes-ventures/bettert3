import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Pai from "../../../pai/PaiService.ts";
import { readCaller } from "../../threadAccess.ts";
import * as Access from "../../McpToolAccess.ts";
import { PaiToolkit } from "./tools.ts";

const caller = Effect.gen(function* () {
  const { caller } = yield* readCaller();
  if (!caller?.activeRunId)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "This PAI operation requires an active T3 run.",
    });
  return caller;
});
const failure = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message:
      "PAI could not complete the request. Check this environment's Mation connection before retrying.",
  });
export const layer = Access.toLayer(PaiToolkit, {
  pai_email_workflow: Access.actsAsCaller(() =>
    Effect.gen(function* () {
      return yield* (yield* Pai.PaiService).workflow.pipe(Effect.mapError(failure));
    }),
  ),
  pai_publish_email_items: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      const source = yield* caller;
      return yield* (yield* Pai.PaiService).publish(input, source).pipe(Effect.mapError(failure));
    }),
  ),
  pai_complete_email_action: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      const source = yield* caller;
      return yield* (yield* Pai.PaiService).complete(input, source).pipe(Effect.mapError(failure));
    }),
  ),
});
