import type { Draft } from "@highstakes/marketing/contracts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Marketing from "../../../marketing/MarketingService.ts";
import * as Access from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { MarketingToolkit } from "./tools.ts";
const current = Effect.gen(function* () {
  const { caller } = yield* readCaller();
  if (!caller?.activeRunId)
    return yield* new OrchestratorMcpFailure({
      code: "parent_not_active",
      message: "This operation requires the release conversation's active T3 run.",
    });
  return { threadId: caller.id, runId: caller.activeRunId };
});
const failure = (e: Marketing.MarketingFailure) =>
  new OrchestratorMcpFailure({
    code: e.reason === "unavailable" ? "orchestration_error" : "invalid_request",
    message: e.message,
  });
const withoutImageBytes = (draft: Draft) => ({
  ...draft,
  media: draft.media.map(({ dataUrl: _dataUrl, ...media }) => media),
});
export const layer = Access.toLayer(MarketingToolkit, {
  marketing_studio: Access.actsAsCaller(() =>
    Effect.gen(function* () {
      const caller = yield* current;
      const context = yield* (yield* Marketing.MarketingService)
        .context(caller.threadId)
        .pipe(Effect.catchTags({ MarketingFailure: (e) => Effect.fail(failure(e)) }));
      return {
        ...context,
        draft: context.draft ? withoutImageBytes(context.draft) : null,
      };
    }),
  ),
  marketing_update: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* current;
      return yield* (yield* Marketing.MarketingService)
        .agent(caller, input.command)
        .pipe(
          Effect.map(withoutImageBytes),
          Effect.catchTags({ MarketingFailure: (e) => Effect.fail(failure(e)) }),
        );
    }),
  ),
});
