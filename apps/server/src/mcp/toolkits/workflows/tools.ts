import {
  OrchestratorMcpFailure,
  WorkflowAgentContext,
  WorkflowAgentResult,
  WorkflowDetail,
  WorkflowRun,
  WorkflowTicket,
  WorkflowTicketUpdateInput,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as WorkflowService from "../../../workflows/WorkflowService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const common = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    WorkflowService.WorkflowService,
    ThreadManagement.ThreadManagementService,
    McpInvocationContext.McpInvocationContext,
  ],
};
export const WorkflowToolkit = Toolkit.make(
  Tool.make("t3_workflow_read", {
    ...common,
    description:
      "Read this task's workflow, live Linear ticket, configuration, available target projects and labels. A task can read only its own workflow.",
    success: WorkflowAgentContext,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_workflow_search", {
    ...common,
    description:
      "Search real Linear tickets in this workflow's team for duplicates and native prerequisites.",
    parameters: Schema.Struct({ query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)) }),
    success: Schema.Array(WorkflowTicket),
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_workflow_update", {
    ...common,
    description:
      "Update this task's ticket during human refinement. Use actual Linear IDs for labels, target project and native blockers. This tool cannot approve or reject.",
    parameters: WorkflowTicketUpdateInput,
    success: WorkflowDetail,
  }).annotate(Tool.Destructive, true),
  Tool.make("t3_workflow_result", {
    ...common,
    description:
      "Submit this task's typed scan, prepared ticket, or implementation commit. The workflow durably resumes the next stage. This tool cannot approve a ticket.",
    parameters: Schema.Struct({ result: WorkflowAgentResult }),
    success: WorkflowRun,
  }).annotate(Tool.Destructive, true),
);
