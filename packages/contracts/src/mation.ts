import { PaiEmailItem } from "./pai.ts";
import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  IsoDateTime,
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

export const MationRequestId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
export const MationExecutionTarget = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type MationExecutionTarget = typeof MationExecutionTarget.Type;
export const MationExecutionInput = Schema.Struct({
  foreground: Schema.optional(Schema.Boolean),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)),
  target: MationExecutionTarget,
});
export type MationExecutionInput = typeof MationExecutionInput.Type;
export const MationExecutionQuery = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
});
export type MationExecutionQuery = typeof MationExecutionQuery.Type;
export const MationRunRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  runId: RunId,
});
export const MationExecution = Schema.Struct({
  ref: MationRunRef,
  status: OrchestrationV2RunStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  worktreePath: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});
export type MationExecution = typeof MationExecution.Type;
export const MationProjects = Schema.Struct({
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
export type MationProjects = typeof MationProjects.Type;
// Existing scheduled prompts retain this transport name during PAI cutover.
export const MationEmailItem = PaiEmailItem;
export const MationPublishEmailInput = Schema.Struct({
  requestId: MationRequestId,
  items: Schema.Array(MationEmailItem).check(Schema.isMaxLength(200)),
});
export type MationPublishEmailInput = typeof MationPublishEmailInput.Type;

export const MationFrontendRequest = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  method: Schema.Literals(["GET", "POST", "PUT"]),
  body: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_048_576))),
});
export type MationFrontendRequest = typeof MationFrontendRequest.Type;
export const MationFrontendResponse = Schema.Struct({ status: Schema.Number, body: Schema.String });
export type MationFrontendResponse = typeof MationFrontendResponse.Type;
export const MationFrontendPage = Schema.Struct({ html: Schema.String });
