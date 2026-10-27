import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Execution from "../../../mation/AutomationExecutionService.ts";
import { readCaller } from "../../threadAccess.ts";
import * as Access from "../../McpToolAccess.ts";
import { MationToolkit } from "./tools.ts";

export const layer = Access.toLayer(MationToolkit, {
  mation_publish_email_items: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      if (!caller?.activeRunId)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The reporting run is no longer active.",
        });
      const execution = yield* Execution.AutomationExecutionService;
      yield* execution
        .publishEmails(input, { threadId: caller.id, runId: caller.activeRunId })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return { published: input.items.length };
    }),
  ),
});
