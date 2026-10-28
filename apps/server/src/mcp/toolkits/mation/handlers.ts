import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Pai from "../../../pai/PaiService.ts";
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
      return yield* (yield* Pai.PaiService)
        .publish({ items: input.items }, caller, input.requestId)
        .pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "invalid_request",
                message:
                  "The report could not be published to Mation. Verify its source run and service connection before retrying.",
              }),
          ),
        );
    }),
  ),
});
