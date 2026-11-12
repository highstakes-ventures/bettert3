import * as Schema from "effect/Schema";
import { NonNegativeInt, ScheduledTaskId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { CodexCloudDestination } from "./cloudChats.ts";

export const threadFields = {
  /** Original automatic kickoff. Null means automatic with unknown historical origin. */
  automationOrigin: Schema.optional(Schema.NullOr(Schema.Literals(["t3", "external"]))),
  runDestination: Schema.optional(CodexCloudDestination),
  sectionId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** The user opened this ticket's chat for human refinement. Survives settlement. */
  refinementOpened: Schema.optional(Schema.Boolean),
};

export const runAttemptFields = {
  /** App-owned capacity retries within this run, separate from the provider's native retries. */
  capacityRetryCount: Schema.optional(NonNegativeInt),
};

export const providerSessionFields = {
  /** Opened transport destination. Absent on legacy records; null means the T3 host. */
  executionDestination: Schema.optional(Schema.NullOr(CodexCloudDestination)),
};

export const threadShellFields = {
  hasEmailReview: Schema.optional(Schema.Boolean),
  automationOrigin: threadFields.automationOrigin,
  /** Derived from persisted scheduled user messages, including fresh webhook threads. */
  scheduledTaskId: Schema.optional(ScheduledTaskId),
  /** Ticket preparation/refinement conversation, derived from its workflow record. */
  ticketWorkflowId: Schema.optional(TrimmedNonEmptyString),
  /** Hidden scan or unopened ticket conversation, derived from its workflow. */
  backgroundWorkflowId: Schema.optional(TrimmedNonEmptyString),
  /** Actual attached runtime, not the thread's requested runDestination. */
  executionDestination: providerSessionFields.executionDestination,
  runDestination: threadFields.runDestination,
  sectionId: threadFields.sectionId,
  /** Sum of settled execution. Null when imported history requires Cloud timing. */
  completedRunDurationMs: Schema.optional(Schema.NullOr(NonNegativeInt)),
  /** Provider start of the activity run, without a wake's inherited work start. */
  activityRunExecutionStartedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
};

export const threadShellJsonFields = {
  activityRunExecutionStartedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtcFromString)),
};
