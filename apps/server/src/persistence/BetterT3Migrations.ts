import * as Migrator from "effect/sql/Migrator";

import ProjectSections from "./BetterT3Migrations/001_ProjectSections.ts";
import Workflows from "./BetterT3Migrations/002_Workflows.ts";
import WorkflowThreadLookup from "./BetterT3Migrations/003_WorkflowThreadLookup.ts";
import EmailReviewLookup from "./BetterT3Migrations/004_EmailReviewLookup.ts";

export const BETTERT3_MIGRATIONS_TABLE = "bettert3_sql_migrations";

const entries = [
  [1, "ProjectSections", ProjectSections],
  [2, "Workflows", Workflows],
  [3, "WorkflowThreadLookup", WorkflowThreadLookup],
  [4, "EmailReviewLookup", EmailReviewLookup],
] as const;

export const betterT3MigrationManifest = entries.map(([id, name]) => [id, name] as const);

export const betterT3MigrationLoader = Migrator.fromRecord(
  Object.fromEntries(entries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
);
