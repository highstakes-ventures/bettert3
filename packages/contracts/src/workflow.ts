import * as Schema from "effect/Schema";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";

const Text = Schema.String.check(Schema.isMaxLength(100_000));
const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(150));
export const WorkflowKind = Schema.Literals(["tickets", "performance", "refactor"]);
export type WorkflowKind = typeof WorkflowKind.Type;
export const WorkflowPhase = Schema.Literals([
  "queued",
  "preparing",
  "review",
  "approving",
  "approved",
  "implementing",
  "done",
  "rejecting",
  "rejected",
]);
export const WorkflowDependencyEvidence = Schema.Union([
  Schema.Struct({
    issueId: Id,
    kind: Schema.Literal("code"),
    commit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  }),
  Schema.Struct({ issueId: Id, kind: Schema.Literal("external") }),
]);
export type WorkflowDependencyEvidence = typeof WorkflowDependencyEvidence.Type;
export const WorkflowProject = Schema.Struct({
  id: Id,
  name: Schema.String,
  teamIds: Schema.Array(Id),
  initiatives: Schema.Array(Schema.String),
});
export const WorkflowConnection = Schema.Struct({
  connected: Schema.Boolean,
  teams: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      refinedStateId: Schema.NullOr(Id),
      canceledStateId: Schema.NullOr(Id),
      completedStateId: Schema.NullOr(Id),
      labels: Schema.Array(Schema.Struct({ id: Id, name: Schema.String })),
    }),
  ),
  projects: Schema.Array(WorkflowProject),
});
export type WorkflowConnection = typeof WorkflowConnection.Type;
export const WorkflowConfiguration = Schema.Struct({
  projectId: ProjectId,
  linearTeamId: Id,
  intakeProjectId: Schema.NullOr(Id),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  baseBranch: Id,
  performanceEnabled: Schema.Boolean,
  refactorEnabled: Schema.Boolean,
});
export type WorkflowConfiguration = typeof WorkflowConfiguration.Type;
export const WorkflowIssueReference = Schema.Struct({
  id: Id,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  stateType: Schema.String,
});
export const WorkflowTicket = Schema.Struct({
  ...WorkflowIssueReference.fields,
  updatedAt: Schema.String,
  stateId: Id,
  description: Schema.String,
  teamId: Id,
  project: Schema.NullOr(WorkflowProject),
  priority: Schema.Number,
  estimate: Schema.NullOr(Schema.Number),
  dueDate: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.Struct({ id: Id, name: Schema.String })),
  blockedBy: Schema.Array(WorkflowIssueReference),
  blocks: Schema.Array(WorkflowIssueReference),
  resources: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String })),
  comments: Schema.Array(
    Schema.Struct({ id: Id, body: Schema.String, author: Schema.String, createdAt: Schema.String }),
  ),
});
export type WorkflowTicket = typeof WorkflowTicket.Type;
export const WorkflowTicketDraft = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  description: Text,
  targetProjectId: Schema.NullOr(Id),
  priority: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  labelIds: Schema.Array(Id),
  blockedBy: Schema.Array(Id),
  dependencyEvidence: Schema.Array(WorkflowDependencyEvidence),
});
export type WorkflowTicketDraft = typeof WorkflowTicketDraft.Type;
export const WorkflowRun = Schema.Struct({
  id: Id,
  projectId: ProjectId,
  kind: WorkflowKind,
  phase: WorkflowPhase,
  title: Schema.String,
  priority: Schema.Number,
  blockerIds: Schema.Array(Id),
  threadId: Schema.NullOr(ThreadId),
  implementationThreadId: Schema.NullOr(ThreadId),
  issueId: Schema.NullOr(Id),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  delayedAt: Schema.optionalKey(Schema.String),
});
export type WorkflowRun = typeof WorkflowRun.Type;
export const WorkflowListInput = Schema.Struct({
  projectId: ProjectId,
  includeDelayed: Schema.optional(Schema.Boolean),
  includeAllProjects: Schema.optional(Schema.Boolean),
});
export const WorkflowListResult = Schema.Struct({
  configuration: Schema.NullOr(WorkflowConfiguration),
  connected: Schema.Boolean,
  implementationSlots: Schema.Struct({ used: Schema.Int, limit: Schema.Int }),
  runs: Schema.Array(WorkflowRun),
});
export type WorkflowListResult = typeof WorkflowListResult.Type;
export const WorkflowReadInput = Schema.Struct({
  runId: Id,
  revision: Schema.optional(Schema.String),
});
export const WorkflowDetail = Schema.Struct({
  run: WorkflowRun,
  ticket: Schema.NullOr(WorkflowTicket),
  dependencyEvidence: Schema.Array(WorkflowDependencyEvidence),
  questions: Schema.Array(Schema.String),
});
export type WorkflowDetail = typeof WorkflowDetail.Type;
export const WorkflowIntakeInput = Schema.Struct({
  projectId: ProjectId,
  requestId: Id,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export const WorkflowDecisionInput = Schema.Struct({
  runId: Id,
  decision: Schema.Literals(["approve", "reject", "delay"]),
  expectedUpdatedAt: Schema.String,
  targetProjectId: Schema.NullOr(Id),
});
export type WorkflowDecisionInput = typeof WorkflowDecisionInput.Type;
export const WorkflowAgentResult = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("scan"),
    findings: Schema.Array(
      Schema.Struct({ key: Id, request: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)) }),
    ).check(Schema.isMaxLength(30)),
  }),
  Schema.Struct({
    type: Schema.Literal("prepared"),
    ticket: WorkflowTicketDraft,
    existingIssueId: Schema.optional(Id),
    expectedUpdatedAt: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("implementation"),
    commit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  }),
]);
export type WorkflowAgentResult = typeof WorkflowAgentResult.Type;
export class WorkflowError extends Schema.TaggedError<WorkflowError>()("WorkflowError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const WorkflowConnectInput = Schema.Struct({
  apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});

export const WorkflowAgentContext = Schema.Struct({
  detail: WorkflowDetail,
  configuration: WorkflowConfiguration,
  connection: WorkflowConnection,
});

export const WorkflowTicketUpdateInput = Schema.Struct({
  expectedUpdatedAt: Schema.String,
  ticket: WorkflowTicketDraft,
});
export type WorkflowTicketUpdateInput = typeof WorkflowTicketUpdateInput.Type;
