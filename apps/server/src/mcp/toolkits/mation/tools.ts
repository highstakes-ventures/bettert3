import * as Execution from "../../../mation/AutomationExecutionService.ts";
import {
  MationPublishEmailInput,
  OrchestratorMcpFailure,
  PaiPublishEmailResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Pai from "../../../pai/PaiService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";

export const MationToolkit = Toolkit.make(
  Tool.make("mation_publish_email_items", {
    description:
      "Publish concise email summaries to PAI for this exact Mation run. Use the Mation run ID from the initial request. Requires the reporting run to belong to this caller. This does not send email or mark it processed.",
    parameters: MationPublishEmailInput,
    success: PaiPublishEmailResult,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      Pai.PaiService,
      Execution.AutomationExecutionService,
      Threads.ThreadManagementService,
      Invocation.McpInvocationContext,
    ],
  }),
);
