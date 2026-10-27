import { MationPublishEmailInput, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Execution from "../../../mation/AutomationExecutionService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";

export const MationToolkit = Toolkit.make(
  Tool.make("mation_publish_email_items", {
    description:
      "Publish concise email summaries for this exact Mation run. Use the Mation run ID from the initial request. Requires the reporting run to belong to this caller. This does not send email or mark it processed.",
    parameters: MationPublishEmailInput,
    success: Schema.Struct({ published: Schema.Number }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      Execution.AutomationExecutionService,
      Threads.ThreadManagementService,
      Invocation.McpInvocationContext,
    ],
  }),
);
