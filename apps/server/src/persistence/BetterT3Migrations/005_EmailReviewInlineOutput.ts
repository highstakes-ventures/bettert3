import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE orchestration_v2_projection_turn_items
    SET inline_work_output = 1
    WHERE type = 'dynamic_tool' AND payload_json LIKE '%paiWidget%'`;
});
