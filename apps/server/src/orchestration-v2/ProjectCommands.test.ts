import { assert, describe, it } from "@effect/vitest";
import { CommandId, EventId, ProjectId, type ProjectScript } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planProjectCommand,
  type ProjectCommand,
  type ProjectCommandState,
} from "./ProjectCommands.ts";
import type { ProjectRow } from "./ProjectStore.ts";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const projectId = ProjectId.make("project-scripts");

const row = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  projectId,
  title: "Scripts",
  workspaceRoot: "/tmp/scripts",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const script = (id: string): ProjectScript => ({
  id,
  name: "Install dependencies",
  command: "vp i",
  icon: "configure",
  runOnWorktreeCreate: false,
});

const plan = (command: ProjectCommand, state: Partial<ProjectCommandState> = {}) =>
  planProjectCommand({
    command,
    state: { project: undefined, workspaceOwner: undefined, ...state },
    eventId: EventId.make("event:planned"),
    now,
  });

const payloadOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isSuccess(result));
  return Result.getOrThrow(result).payload as Record<string, unknown>;
};

const failureOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isFailure(result));
  return Result.isFailure(result) ? result.failure : assert.fail("expected a rejection");
};

describe("planProjectCommand", () => {
  it("keeps legacy scripts editable and removable while rejecting new invalid ones", () => {
    const legacy = script("install-javascript-dependencies");
    const withLegacy = (scripts: ReadonlyArray<ProjectScript>) =>
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-repair-script"),
          projectId,
          scripts,
        },
        { project: row({ scripts: [legacy] }) },
      );
    for (const scripts of [[{ ...legacy, command: "vp install" }, script("lint")], []]) {
      assert.deepEqual(payloadOf(withLegacy(scripts)).scripts, scripts);
    }
    assert.equal(
      failureOf(withLegacy([legacy, script("another.invalid.id")]))._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("rejects a workspace root held by another active project", () => {
    const owner = row({
      projectId: ProjectId.make("project-existing"),
      workspaceRoot: "/tmp/project",
    });
    const create = failureOf(
      plan(
        {
          type: "project.create",
          commandId: CommandId.make("cmd-duplicate-root"),
          projectId: ProjectId.make("project-duplicate-root"),
          title: "Duplicate",
          workspaceRoot: "/tmp/project",
        },
        { workspaceOwner: owner },
      ),
    );
    assert.equal(create._tag, "ProjectWorkspaceConflictError");
    assert.equal(
      create.message,
      "Active project 'project-existing' already exists for workspace root '/tmp/project'.",
    );
    const move = failureOf(
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-move-root"),
          projectId,
          workspaceRoot: "/tmp/project",
        },
        { project: row(), workspaceOwner: owner },
      ),
    );
    assert.equal(move._tag, "ProjectWorkspaceConflictError");
  });

  it("requires the project to exist, and to be absent on create", () => {
    const create: ProjectCommand = {
      type: "project.create",
      commandId: CommandId.make("cmd-create-twice"),
      projectId,
      title: "Twice",
      workspaceRoot: "/tmp/twice",
    };
    assert.include(failureOf(plan(create, { project: row() })).message, "cannot be created twice");
    const deleted = row({ deletedAt: "2026-01-01T00:00:00.000Z" });
    assert.include(
      failureOf(plan(create, { project: deleted })).message,
      "cannot be created twice",
    );
    for (const command of [
      { type: "project.meta.update", commandId: CommandId.make("cmd-missing"), projectId },
      { type: "project.delete", commandId: CommandId.make("cmd-missing"), projectId },
    ] as const) {
      for (const project of [undefined, deleted]) {
        assert.equal(
          failureOf(plan(command, { project }))._tag,
          "ProjectCommandMissingProjectError",
        );
      }
    }
  });
});

describe("project sections", () => {
  const build = { id: "build", name: "Build", color: "blue" as const };
  const research = { id: "research", name: "Research", color: "violet" as const };
  const change = (
    sectionChange: NonNullable<
      Extract<ProjectCommand, { type: "project.meta.update" }>["sectionChange"]
    >,
    sections = [build, research],
  ) =>
    plan(
      {
        type: "project.meta.update",
        commandId: CommandId.make("section-change"),
        projectId,
        sectionChange,
      },
      { project: row({ sections }) },
    );
  it("adds and edits a section against the latest definitions", () => {
    assert.deepEqual(payloadOf(change({ type: "upsert", section: build }, [])).sections, [build]);
    assert.deepEqual(
      payloadOf(change({ type: "upsert", section: { ...build, name: "Delivery", color: "red" } }))
        .sections,
      [{ ...build, name: "Delivery", color: "red" }, research],
    );
  });
  it("rejects duplicate names and incomplete or repeated orderings", () => {
    assert.equal(
      failureOf(change({ type: "upsert", section: { ...build, id: "new", name: "BUILD" } }))._tag,
      "ProjectCommandInvariantError",
    );
    for (const sectionIds of [["build"], ["build", "build"], ["research", "missing"]]) {
      assert.equal(
        failureOf(change({ type: "reorder", sectionIds }))._tag,
        "ProjectCommandInvariantError",
      );
    }
  });
  it("reorders and deletes definitions without issuing thread events", () => {
    assert.deepEqual(
      payloadOf(change({ type: "reorder", sectionIds: ["research", "build"] })).sections,
      [research, build],
    );
    assert.deepEqual(payloadOf(change({ type: "delete", sectionId: "build" })).sections, [
      research,
    ]);
    assert.isFalse(
      "sections" in
        payloadOf(
          plan(
            {
              type: "project.meta.update",
              commandId: CommandId.make("project-rename"),
              projectId,
              title: "Renamed",
            },
            { project: row() },
          ),
        ),
    );
  });
});
