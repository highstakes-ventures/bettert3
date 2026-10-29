import * as Schema from "effect/Schema";
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
} from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const ExecutionTarget = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type ExecutionTarget = typeof ExecutionTarget.Type;

// Callers own these opaque identities, including identities accepted before a reconnect.
export const ExecutionLookup = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  messageId: MessageId,
});
export type ExecutionLookup = typeof ExecutionLookup.Type;
export const ExecutionRequestInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  foreground: Schema.optional(Schema.Boolean),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)),
  target: ExecutionTarget,
});
export type ExecutionRequestInput = typeof ExecutionRequestInput.Type;
export const ExecutionRequestParams = Schema.Struct({ commandId: CommandId });
export const ExecutionReference = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  runId: RunId,
});
export const ExecutionResult = Schema.Struct({
  ref: ExecutionReference,
  status: OrchestrationV2RunStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  worktreePath: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});
export type ExecutionResult = typeof ExecutionResult.Type;
export const ExecutionCapabilities = Schema.Struct({
  environmentId: EnvironmentId,
  projects: Schema.Array(
    Schema.Struct({
      id: ProjectId,
      title: TrimmedNonEmptyString,
      workspaceRoot: TrimmedNonEmptyString,
    }),
  ),
  models: Schema.Array(
    Schema.Struct({
      instanceId: TrimmedNonEmptyString,
      model: TrimmedNonEmptyString,
      label: TrimmedNonEmptyString,
    }),
  ),
});
export type ExecutionCapabilities = typeof ExecutionCapabilities.Type;
