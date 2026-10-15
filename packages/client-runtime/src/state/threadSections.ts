import type { ProjectSection } from "@t3tools/contracts";

interface SectionProject {
  readonly environmentId: string;
  readonly id: string;
  readonly sections?: readonly ProjectSection[] | undefined;
}
interface SectionThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly sectionId?: string | null | undefined;
}

/** Unknown or deleted definitions display as No section without rewriting chats. */
export function resolveThreadSection(
  project: SectionProject | null | undefined,
  thread: SectionThread,
): ProjectSection | null {
  if (project?.environmentId !== thread.environmentId || project.id !== thread.projectId)
    return null;
  return project.sections?.find((section) => section.id === thread.sectionId) ?? null;
}

export function threadSectionKey(project: SectionProject, sectionId: string | null): string {
  return JSON.stringify([project.environmentId, project.id, sectionId]);
}

/** Retains the input's row order and each physical project's definition order. */
export function groupThreadsBySection<P extends SectionProject, T extends SectionThread>(
  projects: readonly P[],
  threads: readonly T[],
) {
  const groups = projects.flatMap((project) =>
    [...(project.sections ?? []), null].map((section) => ({
      key: threadSectionKey(project, section?.id ?? null),
      project,
      section,
      threads: [] as T[],
    })),
  );
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const projectByKey = new Map(
    projects.map((project) => [JSON.stringify([project.environmentId, project.id]), project]),
  );
  for (const thread of threads) {
    const project = projectByKey.get(JSON.stringify([thread.environmentId, thread.projectId]));
    if (!project) continue;
    const section = resolveThreadSection(project, thread);
    byKey.get(threadSectionKey(project, section?.id ?? null))?.threads.push(thread);
  }
  return groups;
}
