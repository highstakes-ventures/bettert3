import { BETTERT3_WS_METHODS } from "@t3tools/contracts";
import { WorkflowRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as WorkflowService from "./WorkflowService.ts";

export const layer = WorkflowRpcGroup.middleware(RpcInstrumentation).toLayer(
  Effect.gen(function* () {
    const workflows = yield* WorkflowService.WorkflowService;
    return {
      [BETTERT3_WS_METHODS.workflowsConnection]: () => workflows.connection(),
      [BETTERT3_WS_METHODS.workflowsConnect]: (input) => workflows.connect(input.apiKey),
      [BETTERT3_WS_METHODS.workflowsDisconnect]: () => workflows.disconnect,
      [BETTERT3_WS_METHODS.workflowsSubscribe]: (input) =>
        workflows.subscribe(input.projectId, input.includeDelayed, input.includeAllProjects),
      [BETTERT3_WS_METHODS.workflowsConfigure]: (input) => workflows.configure(input),
      [BETTERT3_WS_METHODS.workflowsRead]: (input) => workflows.read(input.runId),
      [BETTERT3_WS_METHODS.workflowsIntake]: (input) => workflows.intake(input),
      [BETTERT3_WS_METHODS.workflowsDecide]: (input) => workflows.decide(input),
    };
  }),
);
