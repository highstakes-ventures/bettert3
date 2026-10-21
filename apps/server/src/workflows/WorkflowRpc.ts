import { WorkflowRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as WorkflowService from "./WorkflowService.ts";

export const layer = WorkflowRpcGroup.middleware(RpcInstrumentation).toLayer(
  Effect.gen(function* () {
    const workflows = yield* WorkflowService.WorkflowService;
    return {
      [WS_METHODS.workflowsConnection]: () => workflows.connection(),
      [WS_METHODS.workflowsConnect]: (input) => workflows.connect(input.apiKey),
      [WS_METHODS.workflowsDisconnect]: () => workflows.disconnect,
      [WS_METHODS.workflowsSubscribe]: (input) => workflows.subscribe(input.projectId),
      [WS_METHODS.workflowsConfigure]: (input) => workflows.configure(input),
      [WS_METHODS.workflowsRead]: (input) => workflows.read(input.runId),
      [WS_METHODS.workflowsIntake]: (input) => workflows.intake(input),
      [WS_METHODS.workflowsDecide]: (input) => workflows.decide(input),
    };
  }),
);
