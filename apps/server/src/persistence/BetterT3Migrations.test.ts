import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "./Migrations.ts";

it.effect("keeps published email reviews visible after the inline-output migration", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 94 });
    yield* sql`INSERT INTO orchestration_v2_projection_turn_items
      (turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json)
      VALUES ('review', 'thread-review', 1, 'dynamic_tool', 'completed', '2026-11-18',
        '{"type":"dynamic_tool","toolName":"mation_publish_email_items","output":{"paiWidget":{"reportId":"report-existing"}}}')`;
    yield* runMigrations();
    const [review] = yield* sql<{ readonly inline_work_output: number }>`
      SELECT inline_work_output FROM orchestration_v2_projection_turn_items WHERE turn_item_id = 'review'`;
    assert.equal(review?.inline_work_output, 1);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
