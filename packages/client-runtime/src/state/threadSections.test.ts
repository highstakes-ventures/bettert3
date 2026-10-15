import { describe, expect, it } from "vite-plus/test";
import {
  groupThreadsBySection,
  resolveThreadSection,
  resolveThreadSectionDrop,
  threadSectionKey,
} from "./threadSections.ts";

const build = { id: "build", name: "Build", color: "blue" as const };
const research = { id: "research", name: "Research", color: "violet" as const };
const project = { environmentId: "local", id: "platform", sections: [research, build] };
const chat = (
  id: string,
  sectionId: string | null,
  environmentId = "local",
  projectId = "platform",
) => ({ id, sectionId, environmentId, projectId });

describe("thread sections", () => {
  it("keeps definition order, input row order, and each chat exactly once", () => {
    const chats = [chat("a", "build"), chat("b", "research"), chat("c", "build"), chat("d", null)];
    const groups = groupThreadsBySection([project], chats);
    expect(
      groups.map((group) => [group.section?.id ?? null, group.threads.map((thread) => thread.id)]),
    ).toEqual([
      ["research", ["b"]],
      ["build", ["a", "c"]],
      [null, ["d"]],
    ]);
    expect(groups.flatMap((group) => group.threads)).toHaveLength(chats.length);
  });
  it("resolves removed definitions and old unassigned chats as Uncategorized", () => {
    const deleted = { ...project, sections: [research] };
    expect(resolveThreadSection(deleted, chat("a", "build"))).toBeNull();
    expect(groupThreadsBySection([deleted], [chat("a", "build")]).at(-1)?.threads[0]?.id).toBe("a");
    expect(
      resolveThreadSection({ environmentId: "local", id: "platform" }, chat("b", null)),
    ).toBeNull();
  });
  it("isolates identical section ids by physical project and environment", () => {
    const remote = { ...project, environmentId: "remote" };
    const other = { ...project, id: "other" };
    const groups = groupThreadsBySection(
      [project, remote, other],
      [chat("a", "build"), chat("b", "build", "remote"), chat("c", "build", "local", "other")],
    );
    expect(
      groups
        .filter((group) => group.section?.id === "build")
        .map((group) => group.threads.map((thread) => thread.id)),
    ).toEqual([["a"], ["b"], ["c"]]);
    expect(resolveThreadSection(project, chat("b", "build", "remote"))).toBeNull();
    expect(threadSectionKey(project, "build")).not.toBe(threadSectionKey(remote, "build"));
  });
  it("keeps empty named categories and hides empty Uncategorized except during dragging", () => {
    expect(groupThreadsBySection([project], []).map((group) => group.section?.name)).toEqual([
      "Research",
      "Build",
    ]);
    expect(groupThreadsBySection([{ ...project, sections: [] }], [])).toEqual([]);
    expect(
      groupThreadsBySection([project], [], { includeEmpty: true }).map(
        (group) => group.section?.name ?? "Uncategorized",
      ),
    ).toEqual(["Research", "Build", "Uncategorized"]);
  });
});

describe("category assignment by dragging", () => {
  it("assigns an existing or uncategorized destination and ignores unchanged assignments", () => {
    expect(resolveThreadSectionDrop(chat("a", "build"), project, "research")).toEqual({
      sectionId: "research",
    });
    expect(resolveThreadSectionDrop(chat("a", "build"), project, null)).toEqual({
      sectionId: null,
    });
    expect(resolveThreadSectionDrop(chat("a", "build"), project, "build")).toBeNull();
  });
  it("rejects cross-project, cross-environment, deleted, and unsupported destinations", () => {
    const source = chat("a", "build");
    expect(resolveThreadSectionDrop(source, { ...project, id: "other" }, "research")).toBeNull();
    expect(
      resolveThreadSectionDrop(source, { ...project, environmentId: "remote" }, "research"),
    ).toBeNull();
    expect(resolveThreadSectionDrop(source, project, "deleted")).toBeNull();
    expect(
      resolveThreadSectionDrop(
        source,
        { id: project.id, environmentId: project.environmentId },
        null,
      ),
    ).toBeNull();
  });
});
