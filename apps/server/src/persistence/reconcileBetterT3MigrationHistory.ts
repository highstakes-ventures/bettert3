import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { BETTERT3_MIGRATIONS_TABLE, betterT3MigrationManifest } from "./BetterT3Migrations.ts";

interface HistoryRow {
  readonly migration_id: number;
  readonly name: string;
  readonly created_at: string;
}

const invalidHistory = () =>
  new Migrator.MigrationError({
    kind: "BadState",
    message:
      "The BetterT3 migration history is not a supported upgrade history. No migration history was changed.",
  });

export const reconcileBetterT3MigrationHistory = Effect.fn("reconcileBetterT3MigrationHistory")(
  function* (upstreamManifest: ReadonlyArray<readonly [number, string]>) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_schema WHERE type = 'table'
            AND name IN ('effect_sql_migrations', ${BETTERT3_MIGRATIONS_TABLE})
        `;
        const custom = tables.some((row) => row.name === BETTERT3_MIGRATIONS_TABLE)
          ? yield* sql<HistoryRow>`SELECT migration_id, name, created_at FROM ${sql(BETTERT3_MIGRATIONS_TABLE)} ORDER BY migration_id`
          : [];
        if (
          custom.some(
            (row, index) =>
              row.migration_id !== index + 1 || row.name !== betterT3MigrationManifest[index]?.[1],
          )
        )
          return yield* invalidHistory();
        if (!tables.some((row) => row.name === "effect_sql_migrations")) {
          if (custom.length > 0) return yield* invalidHistory();
          return;
        }
        const recorded = yield* sql<HistoryRow>`
          SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id
        `;
        if (!recorded.some((row) => row.name === "ProjectSections")) return;
        const legacyEntries = [
          ...betterT3MigrationManifest.slice(0, 3).map(([id, name]) => [id + 62, name] as const),
          ...upstreamManifest
            .filter(([id]) => id >= 63 && id <= 67)
            .map(([id, name]) => [id + 3, name] as const),
          [71, "EmailReviewLookup"] as const,
        ];
        const legacy = recorded.filter((row) => row.migration_id >= 63);
        const earlier = new Map(recorded.map((row) => [row.migration_id, row.name]));
        if (
          custom.length > 0 ||
          legacy.length === 0 ||
          legacy.some(
            (row, index) =>
              row.migration_id !== legacyEntries[index]?.[0] ||
              row.name !== legacyEntries[index]?.[1],
          ) ||
          upstreamManifest.some(([id, name]) => id >= 55 && id <= 62 && earlier.get(id) !== name)
        )
          return yield* invalidHistory();

        const objects = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_schema WHERE name IN (
            'workflow_configurations', 'workflow_runs', 'workflow_runs_project',
            'workflow_runs_thread', 'orchestration_v2_projection_turn_items_email_review_idx'
          )
        `;
        const present = new Set(objects.map((row) => row.name));
        const sections =
          yield* sql`SELECT name FROM pragma_table_info('projection_projects') WHERE name = 'sections_json'`;
        const last = legacy.at(-1)!.migration_id;
        if (
          sections.length !== 1 ||
          (last >= 64 &&
            ["workflow_configurations", "workflow_runs", "workflow_runs_project"].some(
              (name) => !present.has(name),
            )) ||
          (last >= 65 && !present.has("workflow_runs_thread")) ||
          (last >= 71 && !present.has("orchestration_v2_projection_turn_items_email_review_idx"))
        )
          return yield* invalidHistory();

        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(BETTERT3_MIGRATIONS_TABLE)} (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          created_at DATETIME NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )`;
        for (const row of legacy) {
          if (row.migration_id <= 65 || row.migration_id === 71) {
            const id = row.migration_id === 71 ? 4 : row.migration_id - 62;
            yield* sql`INSERT INTO ${sql(BETTERT3_MIGRATIONS_TABLE)} (migration_id, name, created_at)
              VALUES (${id}, ${row.name}, ${row.created_at})`;
          }
        }
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 63`;
        for (const row of legacy) {
          if (row.migration_id >= 66 && row.migration_id <= 70) {
            yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at)
              VALUES (${row.migration_id - 3}, ${row.name}, ${row.created_at})`;
          }
        }
      }),
    );
  },
);
