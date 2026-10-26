import {
  OrchestratorMcpFailure,
  WorkflowAgentContext,
  WorkflowAgentResult,
  WorkflowDetail,
  WorkflowRun,
  WorkflowTicket,
  WorkflowSearchResult,
  WorkflowTicketReadInput,
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
  Tool.make("refresh_linear", {
    ...common,
    description:
      "Refresh this chat's linked Linear ticket in the BetterT3 side pane after editing it through an external Linear tool. Reloads only this chat's ticket and notifies connected clients. Does not edit Linear or approve the ticket.",
    success: WorkflowDetail,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_workflow_search", {
    ...common,
    description:
      "Search this workflow's Linear team by case-insensitive title or description. Returns at most 30 candidates with up to 1,200 Unicode code points of description context. descriptionTruncated marks incomplete context; hasMore signals more matches. Read selected IDs with t3_workflow_ticket_read before comparing or binding. Candidates are not complete tickets and have no writable revision.",
    parameters: Schema.Struct({ query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)) }),
    success: WorkflowSearchResult,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_workflow_ticket_read", {
    ...common,
    description:
      "Read one selected Linear issue in this workflow's configured team, without mutation. Returns its fresh complete description, all comments, resources, labels and both blocker directions across every page. Before binding, compare this evidence and use its id as existingIssueId and updatedAt as expectedUpdatedAt. Re-read after a conflict and retain the same issue identity.",
    parameters: WorkflowTicketReadInput,
    success: WorkflowTicket,
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
