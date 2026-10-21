import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workflow_configurations (
    project_id TEXT PRIMARY KEY, configuration_json TEXT NOT NULL,
    performance_enabled_at INTEGER, refactor_enabled_at INTEGER
  )`;
  yield* sql`CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX workflow_runs_project ON workflow_runs(project_id)`;
});
