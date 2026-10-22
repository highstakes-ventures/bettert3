import { expect, it } from "@effect/vitest";
import { EventId, MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

it.effect("hides scanner history while keeping ticket preparation and other chats observable", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const projectId = ProjectId.make("workflow-project");
    for (const name of ["scan", "prepare", "implementation", "manual", "sales"]) {
      const id = ThreadId.make(name);
      yield* store.apply({
        id: EventId.make(`create:${name}`),
        type: "thread.created",
        threadId: id,
        occurredAt: now,
        payload: {
          id,
          projectId,
          // A title or system actor alone must not hide a chat.
          title: "Refine: a request",
          createdBy: "system",
          creationSource: "server",
          providerInstanceId: ProviderInstanceId.make("codex"),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
    }
    for (const run of [
      { id: "daily-scan", kind: "performance", threadId: "scan", phase: "done" },
      {
        id: "ticket",
        kind: "tickets",
        threadId: "prepare",
        implementationThreadId: "implementation",
        phase: "review",
        delayedAt: "2026-10-22T07:00:00Z",
      },
    ]) {
      yield* sql`INSERT INTO workflow_runs (id, project_id, run_json)
        VALUES (${run.id}, ${projectId}, ${JSON.stringify(run)})`;
    }
    const listed = (yield* store.getShellSnapshot()).threads;
    expect(
      Object.fromEntries(listed.map((thread) => [thread.id, thread.backgroundWorkflowId])),
    ).toEqual({
      scan: "daily-scan",
      prepare: undefined,
      implementation: undefined,
      manual: undefined,
      sales: undefined,
    });
    for (const thread of listed) {
      expect((yield* store.getThreadShell(thread.id))?.backgroundWorkflowId).toBe(
        thread.backgroundWorkflowId,
      );
      expect((yield* store.getThreadProjection(thread.id)).thread.title).toBe("Refine: a request");
    }
    const candidates = yield* store.getSettlementCandidates();
    expect(
      candidates.filter((thread) => thread.ticketPreparationComplete).map((thread) => thread.id),
    ).toEqual(["prepare"]);
    for (const phase of ["queued", "preparing"]) {
      yield* sql`UPDATE workflow_runs
          SET run_json = json_set(run_json, '$.phase', ${phase}) WHERE id = 'ticket'`;
      expect(
        (yield* store.getSettlementCandidates(ThreadId.make("prepare")))[0]
          ?.ticketPreparationComplete,
      ).toBe(false);
    }
    yield* sql`UPDATE workflow_runs
        SET run_json = json_set(run_json, '$.phase', 'done') WHERE id = 'ticket'`;
    expect(
      (yield* store.getSettlementCandidates(ThreadId.make("prepare")))[0]
        ?.ticketPreparationComplete,
    ).toBe(true);
    yield* sql`UPDATE workflow_runs
        SET run_json = json_set(run_json, '$.error', 'Linear unavailable') WHERE id = 'ticket'`;
    expect(
      (yield* store.getSettlementCandidates(ThreadId.make("prepare")))[0]
        ?.ticketPreparationComplete,
    ).toBe(false);
    for (const createdBy of ["system", "user"] as const) {
      yield* store.apply({
        type: "message.updated",
        id: EventId.make(`message:${createdBy}`),
        threadId: ThreadId.make("prepare"),
        occurredAt: now,
        payload: {
          id: MessageId.make(`message:${createdBy}`),
          threadId: ThreadId.make("prepare"),
          runId: null,
          nodeId: null,
          role: "user",
          createdBy,
          creationSource: createdBy === "system" ? "server" : "web",
          text: "Prepare or refine this ticket",
          attachments: [],
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      expect(
        (yield* store.getSettlementCandidates(ThreadId.make("prepare")))[0]
          ?.latestUserAuthoredMessageAt,
      ).toEqual(createdBy === "system" ? null : now);
    }
    const plan = yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN
      SELECT id FROM workflow_runs WHERE json_extract(run_json, '$.threadId') = 'scan'`;
    expect(
      plan.some((row) =>
        row.detail.includes("SEARCH workflow_runs USING INDEX workflow_runs_thread"),
      ),
    ).toBe(true);
  }).pipe(
    Effect.provide(ProjectionStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory))),
    Effect.scoped,
  ),
);
