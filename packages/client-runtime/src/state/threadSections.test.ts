import { describe, expect, it } from "vite-plus/test";
import { groupThreadsBySection, resolveThreadSection, threadSectionKey } from "./threadSections.ts";

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
  it("resolves removed definitions and old unassigned chats as No section", () => {
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
  it("keeps empty sections available for starting a chat", () => {
    expect(
      groupThreadsBySection([project], []).map((group) => group.section?.name ?? "No section"),
    ).toEqual(["Research", "Build", "No section"]);
  });
});
