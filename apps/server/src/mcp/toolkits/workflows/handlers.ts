import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as WorkflowService from "../../../workflows/WorkflowService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkflowToolkit } from "./tools.ts";

const caller = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "Workflow tools")),
  Effect.map((scope) => scope.thread.threadId),
);
const failure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
export const layer = McpToolAccess.toLayer(WorkflowToolkit, {
  t3_workflow_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowService.WorkflowService)
        .agentRead(yield* caller)
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_search: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowService.WorkflowService)
        .agentSearch(yield* caller, input.query)
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_ticket_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowService.WorkflowService)
        .agentReadTicket(yield* caller, input.issueId)
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_update: McpToolAccess.actsAsRefinementCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowService.WorkflowService)
        .agentUpdate(yield* caller, input)
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_result: McpToolAccess.actsAsRefinementCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* WorkflowService.WorkflowService)
        .submitResult(yield* caller, input.result)
        .pipe(Effect.mapError(failure));
    }),
  ),
});
