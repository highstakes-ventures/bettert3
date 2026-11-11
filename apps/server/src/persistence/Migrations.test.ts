import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/sql/Migrator";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import ProjectSections from "./BetterT3Migrations/001_ProjectSections.ts";
import Workflows from "./BetterT3Migrations/002_Workflows.ts";
import WorkflowThreadLookup from "./BetterT3Migrations/003_WorkflowThreadLookup.ts";
import EmailReviewLookup from "./BetterT3Migrations/004_EmailReviewLookup.ts";
import DropUnusedV1Projections from "./Migrations/063_DropUnusedV1Projections.ts";
import CanonicalizeThreadPullRequestLinks from "./Migrations/064_CanonicalizeThreadPullRequestLinks.ts";
import CodexUsageNativeTurnIndex from "./Migrations/065_CodexUsageNativeTurnIndex.ts";
import RepairClientSettlementTimestamps from "./Migrations/066_RepairClientSettlementTimestamps.ts";
import WebhookDedupe from "./Migrations/067_WebhookDedupe.ts";

const legacyInstall = Effect.fn("test.legacyInstall")(function* (through = 71) {
  yield* runMigrations({ toMigrationInclusive: 62 });
  yield* Migrator.make({})({
    loader: Migrator.fromRecord({
      "63_ProjectSections": ProjectSections,
      "64_Workflows": Workflows,
      "65_WorkflowThreadLookup": WorkflowThreadLookup,
      "66_DropUnusedV1Projections": DropUnusedV1Projections,
      "67_CanonicalizeThreadPullRequestLinks": CanonicalizeThreadPullRequestLinks,
      "68_CodexUsageNativeTurnIndex": CodexUsageNativeTurnIndex,
      "69_RepairClientSettlementTimestamps": RepairClientSettlementTimestamps,
      "70_WebhookDedupe": WebhookDedupe,
      "71_EmailReviewLookup": EmailReviewLookup,
    }).pipe(Effect.map((entries) => entries.filter(([id]) => id <= through))),
  });
});

const v2Migrations = migrationManifest.filter(([id]) => id >= 55);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

describe("runMigrations", () => {
  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 54 }), []);
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "not a supported upgrade history");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "not a supported upgrade history");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "keeps BetterT3 workflow data while separating custom and upstream migration histories",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* legacyInstall();
        const configuration = '{"linearProjectId":"existing-project"}';
        const run = '{"threadId":"existing-thread","phase":"refinement"}';
        yield* sql`INSERT INTO workflow_configurations (project_id, configuration_json) VALUES ('existing-project', ${configuration})`;
        yield* sql`INSERT INTO workflow_runs (id, project_id, run_json) VALUES ('existing-run', 'existing-project', ${run})`;
        yield* sql`UPDATE effect_sql_migrations SET created_at = '2026-10-15 12:00:00' WHERE migration_id >= 63`;
        const expected = migrationManifest.filter(([id]) => id > 67);
        const applied = yield* runMigrations();
        assert.deepStrictEqual(
          (yield* history).filter(([id]) => id >= 63 && id <= 67),
          [
            [63, "DropUnusedV1Projections"],
            [64, "CanonicalizeThreadPullRequestLinks"],
            [65, "CodexUsageNativeTurnIndex"],
            [66, "RepairClientSettlementTimestamps"],
            [67, "WebhookDedupe"],
          ],
        );
        assert.deepStrictEqual(applied, expected);
        assert.deepStrictEqual(
          yield* sql`SELECT migration_id, name FROM bettert3_sql_migrations ORDER BY migration_id`,
          [
            { migration_id: 1, name: "ProjectSections" },
            { migration_id: 2, name: "Workflows" },
            { migration_id: 3, name: "WorkflowThreadLookup" },
            { migration_id: 4, name: "EmailReviewLookup" },
          ],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT DISTINCT created_at FROM bettert3_sql_migrations`,
          [{ created_at: "2026-10-15 12:00:00" }],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT DISTINCT created_at FROM effect_sql_migrations WHERE migration_id >= 63 AND migration_id <= 67`,
          [{ created_at: "2026-10-15 12:00:00" }],
        );
        assert.deepStrictEqual(yield* sql`SELECT configuration_json FROM workflow_configurations`, [
          { configuration_json: configuration },
        ]);
        assert.deepStrictEqual(yield* sql`SELECT run_json FROM workflow_runs`, [{ run_json: run }]);
        assert.deepStrictEqual(
          yield* sql`SELECT name FROM pragma_table_info('projection_projects') WHERE name = 'sections_json'`,
          [{ name: "sections_json" }],
        );
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([63, 64, 65, 66, 67, 68, 69, 70, 71])(
    "upgrades the supported BetterT3 history ending at %s without replaying applied schema",
    (through) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* legacyInstall(through);
        yield* runMigrations();
        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.deepStrictEqual(
          yield* sql`SELECT migration_id, name FROM bettert3_sql_migrations ORDER BY migration_id`,
          [
            { migration_id: 1, name: "ProjectSections" },
            { migration_id: 2, name: "Workflows" },
            { migration_id: 3, name: "WorkflowThreadLookup" },
            { migration_id: 4, name: "EmailReviewLookup" },
          ],
        );
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each(["future", "older-name", "gap", "legacy-older-name", "custom-name"] as const)(
    "rejects unsupported %s history without changing schema, timestamps or data",
    (variant) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (variant === "legacy-older-name") yield* legacyInstall();
        else if (variant === "custom-name") yield* runMigrations();
        else yield* runMigrations({ toMigrationInclusive: 76 });
        if (variant === "future")
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (77, 'UnknownFutureMigration')`;
        if (variant === "older-name" || variant === "legacy-older-name")
          yield* sql`UPDATE effect_sql_migrations SET name = 'UnknownOlderMigration' WHERE migration_id = 30`;
        if (variant === "gap")
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 30`;
        if (variant === "custom-name")
          yield* sql`UPDATE bettert3_sql_migrations SET name = 'UnknownCustomMigration' WHERE migration_id = 1`;
        yield* sql`CREATE TABLE preservation_sentinel (value TEXT NOT NULL)`;
        yield* sql`INSERT INTO preservation_sentinel VALUES ('preserve me')`;
        const readState = Effect.gen(function* () {
          const schema =
            yield* sql`SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name`;
          const upstream = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
          const custom =
            variant === "custom-name"
              ? yield* sql`SELECT * FROM bettert3_sql_migrations ORDER BY migration_id`
              : [];
          const sentinel = yield* sql`SELECT * FROM preservation_sentinel`;
          return { schema, upstream, custom, sentinel };
        });
        const before = yield* readState;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(yield* readState, before);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rejects an unknown legacy entry before creating a custom ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* legacyInstall();
      yield* sql`UPDATE effect_sql_migrations SET name = 'UnknownMigration' WHERE migration_id = 68`;
      const before = yield* history;
      const exit = yield* Effect.exit(runMigrations());
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "not a supported upgrade history");
      assert.deepStrictEqual(yield* history, before);
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_schema WHERE name = 'bettert3_sql_migrations'`,
        [],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back a failed history transfer and retries without losing applied entries", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* legacyInstall();
      yield* sql`CREATE TABLE bettert3_sql_migrations (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        created_at DATETIME NOT NULL DEFAULT current_timestamp,
        name VARCHAR(255) NOT NULL
      )`;
      yield* sql`CREATE TRIGGER reject_history_transfer BEFORE INSERT ON bettert3_sql_migrations
        WHEN NEW.migration_id = 3 BEGIN SELECT RAISE(ABORT, 'injected transfer failure'); END`;
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const exit = yield* Effect.exit(runMigrations());
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM bettert3_sql_migrations`, []);
      yield* sql`DROP TRIGGER reject_history_transfer`;
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a database at exactly 54", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 54 });
      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("drops the unused correlation index and keeps correlation values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        )
        VALUES (
          'event-1', 'thread', 'thread-1', 0, 'thread.created', '2026-01-01T00:00:00.000Z',
          'command-1', NULL, 'correlation-1', 'client', '{}', '{}'
        )
      `;

      yield* runMigrations();

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'orchestration_events' AND sql IS NOT NULL
      `;
      const indexNames = indexes.map((row) => row.name);
      assert.notInclude(indexNames, "idx_orch_events_correlation_id");
      for (const kept of [
        "idx_orch_events_stream_version",
        "idx_orch_events_stream_sequence",
        "idx_orch_events_command_id",
        "idx_orchestration_events_agent_stream_sequence",
      ]) {
        assert.include(indexNames, kept);
      }
      const events = yield* sql<{ readonly correlation_id: string | null }>`
        SELECT correlation_id FROM orchestration_events WHERE event_id = 'event-1'
      `;
      assert.deepStrictEqual(events, [{ correlation_id: "correlation-1" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, 54])("rejects an unverified site-local migration at id %s", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

      const before = yield* history;
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rejects unknown histories even for a limited V2 run", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (56, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.isTrue(
        Exit.isFailure(yield* Effect.exit(runMigrations({ toMigrationInclusive: 55 }))),
      );
      const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: 56 }));
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "not a supported upgrade history");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rejects a database written by an unknown newer build", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      const before = yield* history;
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

// The npm launcher reads the highest migration id from these file names.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
