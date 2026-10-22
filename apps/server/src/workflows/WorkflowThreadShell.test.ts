import { expect, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

it.effect(
  "identifies existing scan/preparation history without hiding implementation or other automation",
  () =>
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
        { id: "daily-scan", threadId: "scan", phase: "done" },
        {
          id: "ticket",
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
        prepare: "ticket",
        implementation: undefined,
        manual: undefined,
        sales: undefined,
      });
      for (const thread of listed) {
        expect((yield* store.getThreadShell(thread.id))?.backgroundWorkflowId).toBe(
          thread.backgroundWorkflowId,
        );
        expect((yield* store.getThreadProjection(thread.id)).thread.title).toBe(
          "Refine: a request",
        );
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
