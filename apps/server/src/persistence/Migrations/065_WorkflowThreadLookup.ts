import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX workflow_runs_thread ON workflow_runs(json_extract(run_json, '$.threadId'))`;
});
