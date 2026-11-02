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
      "Publish this exact Mation run's email overview and optional calendar snapshot to the fixed Mation review component. Use the Mation run ID from the initial request. Requires the reporting run to belong to this caller. Calendar data uses date, timeZone, readAt, sources with read/unavailable status, and events with the actual Google Calendar htmlLink. All-day start/end are dates with an exclusive end; timed start/end are ISO timestamps with offsets. Do not invent event links or describe unread calendars as empty. This does not send email or change events.",
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
