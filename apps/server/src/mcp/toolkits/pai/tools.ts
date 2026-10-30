import {
  OrchestratorMcpFailure,
  PaiPublishEmailInput,
  PaiPublishEmailResult,
  PaiCompleteEmailActionInput,
  PaiEmailWorkflow,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Pai from "../../../pai/PaiService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";

const dependencies = [
  Pai.PaiService,
  Threads.ThreadManagementService,
  Invocation.McpInvocationContext,
];
export const PaiToolkit = Toolkit.make(
  Tool.make("pai_email_workflow", {
    description:
      "Read Mation's current morning email workflow before preparing an overview. Mation owns these instructions; T3 executes the workflow for the mailbox scope in the user's or Mation's request.",
    parameters: Tool.EmptyParams,
    success: PaiEmailWorkflow,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("pai_publish_email_items", {
    description:
      "Publish this run's morning email overview to Mation. Mation supplies the inline widget and owns its email state and PAI, Personal and Ignore actions. Read the connected mailboxes and provide concise summaries. Publication leaves messages in Inbox and unread. T3 supplies the authenticated run identity; do not invent a source run. An identical publication can be retried, while a different report for the same run is rejected.",
    parameters: PaiPublishEmailInput,
    success: PaiPublishEmailResult,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("pai_complete_email_action", {
    description:
      "Record the verified result of this PAI email action. Use the PAI action ID from the request. Only the action's own T3 chat can complete it, including a follow-up supplying missing context. For Ignore verify the exact message is read and remains in Inbox. For Personal prepare Joseph's draft without sending. Choosing PAI authorizes sending as PAI within Joseph's submitted instruction without a second approval. Ask only when required information or a decision is missing, and leave the action incomplete until resolved.",
    parameters: PaiCompleteEmailActionInput,
    success: Schema.Struct({ completed: Schema.Boolean }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
);
