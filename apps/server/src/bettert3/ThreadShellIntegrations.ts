import { paiWidgetFromToolItem } from "@t3tools/shared/toolOutput";
import {
  CodexCloudDestination,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

export const decodeDestination = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.NullOr(CodexCloudDestination)),
);
const encodeIdList = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

export function hasEmailReview(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runs: ReadonlyArray<OrchestrationV2Run> = [],
) {
  return items.some(
    (item) =>
      item.type === "dynamic_tool" &&
      item.status === "completed" &&
      !runs.some((run) => run.id === item.runId && run.status === "rolled_back") &&
      paiWidgetFromToolItem(item) !== undefined,
  );
}

export function fromProjection(
  projection: OrchestrationV2ThreadProjection,
  activityRun: OrchestrationV2Run | null,
  isActivityRunForShell: (run: OrchestrationV2Run) => boolean,
) {
  const executionProviderThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  const executionSession = projection.providerSessions.find(
    (session) => session.id === executionProviderThread?.providerSessionId,
  );
  const importedCloudDestination =
    executionProviderThread?.providerSessionId === null &&
    projection.thread.runDestination?.existingThreadId !== undefined &&
    executionProviderThread.nativeThreadRef?.nativeId ===
      projection.thread.runDestination.existingThreadId
      ? projection.thread.runDestination
      : undefined;
  const executionDestination = executionSession
    ? executionSession.executionDestination
    : importedCloudDestination;
  const emailReview = hasEmailReview(projection.turnItems, projection.runs);
  const scheduledTaskId = projection.messages.find(
    (message) => message.scheduledTaskId !== undefined,
  )?.scheduledTaskId;
  return {
    ...(emailReview ? { hasEmailReview: true } : {}),
    ...(projection.thread.automationOrigin !== undefined
      ? { automationOrigin: projection.thread.automationOrigin }
      : scheduledTaskId !== undefined
        ? { automationOrigin: undefined }
        : {}),
    ...(scheduledTaskId === undefined ? {} : { scheduledTaskId }),
    ...(executionDestination === undefined ? {} : { executionDestination }),
    ...(projection.thread.runDestination === undefined
      ? {}
      : { runDestination: projection.thread.runDestination }),
    sectionId: projection.thread.sectionId ?? null,
    // Imported run dates can be ordering fallbacks. Cloud retains timing authority
    // even after a native run becomes the latest run.
    completedRunDurationMs: projection.runs.some((run) =>
      run.id.startsWith(`cloud-run:${projection.thread.id}:`),
    )
      ? null
      : projection.runs.reduce(
          (total, run) =>
            run.startedAt !== null && run.completedAt !== null && !isActivityRunForShell(run)
              ? total +
                Math.max(
                  0,
                  DateTime.toEpochMillis(run.completedAt) - DateTime.toEpochMillis(run.startedAt),
                )
              : total,
          0,
        ),
    activityRunExecutionStartedAt: activityRun?.startedAt ?? null,
  };
}

interface ShellFeatureState {
  readonly thread: OrchestrationV2ThreadProjection["thread"];
  readonly hasEmailReview: boolean;
  readonly scheduledTaskId: OrchestrationV2ThreadShell["scheduledTaskId"];
  readonly ticketWorkflowId: string | null;
  readonly backgroundWorkflowId: string | null;
  readonly executionDestination: OrchestrationV2ThreadShell["executionDestination"];
  readonly completedRunDurationMs: number | null;
  readonly activityRunExecutionStartedAt: DateTime.Utc | null;
}

export function fromState(state: ShellFeatureState) {
  return {
    ...(state.thread.automationOrigin !== undefined
      ? { automationOrigin: state.thread.automationOrigin }
      : state.backgroundWorkflowId !== null && state.ticketWorkflowId === null
        ? { automationOrigin: "t3" as const }
        : state.scheduledTaskId !== undefined
          ? { automationOrigin: undefined }
          : {}),
    ...(state.scheduledTaskId === undefined ? {} : { scheduledTaskId: state.scheduledTaskId }),
    ...(state.ticketWorkflowId === null ? {} : { ticketWorkflowId: state.ticketWorkflowId }),
    ...(state.backgroundWorkflowId === null
      ? {}
      : { backgroundWorkflowId: state.backgroundWorkflowId }),
    ...(state.executionDestination === undefined
      ? {}
      : { executionDestination: state.executionDestination }),
    ...(state.thread.runDestination === undefined
      ? {}
      : { runDestination: state.thread.runDestination }),
    sectionId: state.thread.sectionId ?? null,
    completedRunDurationMs: state.completedRunDurationMs,
    activityRunExecutionStartedAt: state.activityRunExecutionStartedAt,
    ...(state.hasEmailReview ? { hasEmailReview: true } : {}),
  };
}

// These fragments join the caller's statement and transaction; they never execute a separate read.
export function makeSqlFragments(sql: SqlClient.SqlClient) {
  return {
    shellColumns: sql`
              (
                SELECT json_extract(message.payload_json, '$.scheduledTaskId')
                FROM orchestration_v2_projection_messages message
                WHERE message.thread_id = t.thread_id
                  AND json_extract(message.payload_json, '$.scheduledTaskId') IS NOT NULL
                ORDER BY message.created_at, message.message_id
                LIMIT 1
              ) AS scheduled_task_id,
              (
                SELECT workflow.id FROM workflow_runs workflow
                WHERE json_extract(workflow.run_json, '$.threadId') = t.thread_id
                  AND json_extract(workflow.run_json, '$.kind') = 'tickets'
                LIMIT 1
              ) AS ticket_workflow_id,
              (
                SELECT workflow.id FROM workflow_runs workflow
                WHERE json_extract(workflow.run_json, '$.threadId') = t.thread_id
                  AND (
                    json_extract(workflow.run_json, '$.kind') IN ('performance', 'refactor')
                    OR (
                      json_extract(workflow.run_json, '$.kind') = 'tickets'
                      AND (
                        json_extract(workflow.run_json, '$.phase') IN ('queued', 'preparing')
                        OR json_extract(t.payload_json, '$.refinementOpened') IS NOT 1
                      )
                    )
                  )
                LIMIT 1
              ) AS background_workflow_id,
`,
    timingColumns: sql`
              (
                SELECT CASE
                  WHEN MAX(instr(r.run_id, 'cloud-run:' || t.thread_id || ':') = 1) = 1 THEN NULL
                  ELSE COALESCE(SUM(CASE
                    WHEN r.status NOT IN ('preparing', 'starting', 'running', 'waiting')
                    THEN MAX(0, CAST(ROUND(
                      (julianday(r.completed_at) - julianday(json_extract(r.payload_json, '$.startedAt'))) * 86400000
                    ) AS INTEGER)) ELSE 0 END), 0)
                END
                FROM orchestration_v2_projection_runs r
                WHERE r.thread_id = t.thread_id
              ) AS completed_run_duration_ms,
              (
                SELECT json_extract(r.payload_json, '$.startedAt')
                FROM orchestration_v2_projection_runs r
                WHERE r.thread_id = t.thread_id
                  AND r.status IN ('preparing', 'starting', 'running', 'waiting')
                ORDER BY r.ordinal DESC, r.run_id DESC
                LIMIT 1
              ) AS activity_run_execution_started_at,
`,
    destinationColumn: sql`
              COALESCE(
                (
                  SELECT json_quote(json_extract(execution_session.payload_json, '$.executionDestination'))
                  FROM orchestration_v2_projection_provider_threads runtime_thread
                  JOIN orchestration_v2_projection_provider_sessions execution_session
                    ON execution_session.provider_session_id = runtime_thread.provider_session_id
                  WHERE runtime_thread.provider_thread_id = t.active_provider_thread_id
                    AND json_type(execution_session.payload_json, '$.executionDestination') IS NOT NULL
                  LIMIT 1
                ),
                (
                  SELECT json_quote(json_extract(t.payload_json, '$.runDestination'))
                  FROM orchestration_v2_projection_provider_threads runtime_thread
                  WHERE runtime_thread.provider_thread_id = t.active_provider_thread_id
                    AND runtime_thread.provider_session_id IS NULL
                    AND json_extract(runtime_thread.payload_json, '$.nativeThreadRef.nativeId') =
                      json_extract(t.payload_json, '$.runDestination.existingThreadId')
                  LIMIT 1
                )
              ) AS execution_destination_json,
`,
    settlementColumn: sql`
              EXISTS (
                SELECT 1 FROM workflow_runs workflow
                WHERE json_extract(workflow.run_json, '$.threadId') = t.thread_id
                  AND json_extract(workflow.run_json, '$.kind') = 'tickets'
                  AND json_extract(workflow.run_json, '$.phase') IN (
                    'review', 'approving', 'approved', 'implementing', 'done', 'rejecting', 'rejected'
                  )
                  AND json_extract(workflow.run_json, '$.error') IS NULL
              ) AS ticket_preparation_complete,
`,
    refinementIndexColumn: sql`
          EXISTS (
            SELECT 1 FROM workflow_runs workflow
            -- Remove column affinity so SQLite can use workflow_runs_thread.
            WHERE json_extract(workflow.run_json, '$.threadId') = +t.thread_id
              AND json_extract(workflow.run_json, '$.kind') = 'tickets'
              AND json_extract(workflow.run_json, '$.phase') = 'review'
          ) AS awaiting_refinement`,
    emailReviewRows: (threadIds?: ReadonlyArray<ThreadId>) => sql`
      UNION ALL
      SELECT i.thread_id, i.payload_json, NULL AS owning_provider_instance_id
      FROM orchestration_v2_projection_turn_items i
      LEFT JOIN orchestration_v2_projection_runs r ON r.run_id = i.run_id
      WHERE i.type = 'dynamic_tool' AND i.status = 'completed'
        AND i.payload_json GLOB '*paiWidget*'
        AND (i.run_id IS NULL OR r.status <> 'rolled_back')
        ${threadIds === undefined ? sql`` : sql`AND i.thread_id IN (SELECT value FROM json_each(${encodeIdList(threadIds)}))`}`,
  };
}
