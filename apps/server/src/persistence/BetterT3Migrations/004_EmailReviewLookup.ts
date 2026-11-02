import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

const migration: Effect.Effect<void, SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The shell reads only publication candidates; historical tool payloads can be large.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_email_review_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id)
    WHERE type = 'dynamic_tool' AND status = 'completed'
      AND payload_json GLOB '*paiWidget*'
  `;
});

export default migration;
