import { act, render, type Screen } from "../../../test/render";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type T3ProjectFile,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";

const state = vi.hoisted(() => ({
  projects: ["source", "target", "other"].map((id) => ({
    id,
    title: id,
    environmentId: "local",
    workspaceRoot: `/repo/${id}`,
    defaultModelSelection: null,
  })),
  readProjectFile: vi.fn<() => Promise<T3ProjectFile | null>>(),
}));

vi.mock("~/state/entities", () => ({
  isProjectMissing: (ref: { environmentId: string; projectId: string }) =>
    !state.projects.some(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    ),
  useProjects: () => state.projects,
  useThreadShells: () => [],
  useVisibleThreadShells: () => [],
}));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "local",
        label: "Local",
        serverConfig: { settings: DEFAULT_SERVER_SETTINGS, environment: { platform: "darwin" } },
      },
    ],
  }),
  usePrimaryEnvironmentId: () => "local",
  useEnvironmentProviders: () => new Map(),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (value: unknown) => unknown) =>
    select({ sidebarProjectSortOrder: "name" }),
}));
vi.mock("~/hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("~/hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: () => "local",
    scratchWorkspaceRootFor: () => null,
    openScratchProject: vi.fn(),
  }),
}));
vi.mock("~/logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: (project: { id: string }) => project.id,
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("~/sidebarProjectGrouping", () => ({
  buildSidebarProjectSnapshots: () =>
    state.projects.map((project) => ({
      projectKey: project.id,
      displayName: project.title,
      title: project.title,
      memberProjectRefs: [{ environmentId: project.environmentId, projectId: project.id }],
    })),
  buildSidebarProjectPickerEntries: ({ groups }: { groups: { projectKey: string }[] }) =>
    groups.map((group) => ({
      group,
      targetProject: state.projects.find((project) => project.id === group.projectKey),
    })),
  projectGroupsSpanEnvironments: () => false,
}));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../ProjectEnvironmentBadge", () => ({ ProjectEnvironmentBadge: () => null }));
vi.mock("~/lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => state.readProjectFile(),
}));
vi.mock("~/state/server", () => ({ primaryServerKeybindingsAtom: "keybindings" }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => ({}),
}));

vi.mock("~/hooks/useProjectGroupUpdate", () => ({
  useProjectPin: () => ({ canPinProjectGroup: () => false, toggleProjectGroupPin: () => {} }),
}));

vi.mock("~/hooks/useStartTriage", () => ({
  isTriagePrompt: () => false,
  TRIAGE_CLI_COMMAND: "t3 triage",
}));

import { DraftHeroHeadline } from "./DraftHeroHeadline";

const environmentId = EnvironmentId.make("local");
const draftId = DraftId.make("project-picker-draft");
const sourceRef = scopeProjectRef(environmentId, ProjectId.make("source"));

async function chooseProject(screen: Screen, title: string) {
  await act(async () =>
    screen.container.querySelector<HTMLButtonElement>("[data-draft-project-trigger]")!.click(),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (element) => element.textContent === title,
  );
  expect(option).toBeDefined();
  await act(async () => option!.click());
}

it("moves a typed Cloud draft to the target project's file-defined workspace default", async () => {
  using _state = setup();

  let finishRead!: (file: T3ProjectFile | null) => void;
  state.readProjectFile.mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  await using screen = await render(
    <DraftHeroHeadline
      draftId={draftId}
      activeProjectRef={sourceRef}
      activeProjectTitle="source"
    />,
  );
  await chooseProject(screen, "target");
  expect(state.readProjectFile).toHaveBeenCalledOnce();
  await act(async () => finishRead({ defaultThreadEnvMode: "worktree" }));
  const store = useComposerDraftStore.getState();
  expect(store.getDraftSession(draftId)).toMatchObject({
    projectId: "target",
    runDestination: null,
    envMode: "worktree",
    environmentSelection: "auto",
  });
  expect(store.getComposerDraft(draftId)?.prompt).toBe("Keep this prompt");
});

it("keeps a later project choice when an earlier project's defaults finish loading", async () => {
  using _state = setup();

  let finishRead!: (file: T3ProjectFile | null) => void;
  state.readProjectFile.mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  const store = useComposerDraftStore.getState();
  const otherRef = scopeProjectRef(environmentId, ProjectId.make("other"));
  const saved = DraftId.make("other-saved");
  store.setLogicalProjectDraftThreadId("other", otherRef, saved);
  store.setDraftThreadContext(saved, { envMode: "local", rememberWorkspace: true });
  await using screen = await render(
    <DraftHeroHeadline
      draftId={draftId}
      activeProjectRef={sourceRef}
      activeProjectTitle="source"
    />,
  );
  await chooseProject(screen, "target");
  await chooseProject(screen, "other");
  await act(async () => finishRead({ defaultThreadEnvMode: "worktree" }));
  expect(store.getDraftSession(draftId)).toMatchObject({
    projectId: "other",
    envMode: "local",
    runDestination: null,
  });
});

function setup() {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  const store = useComposerDraftStore.getState();
  store.setLogicalProjectDraftThreadId("source", sourceRef, draftId);
  store.setPrompt(draftId, "Keep this prompt");
  store.setDraftThreadContext(draftId, {
    environmentSelection: "manual",
    runDestination: {
      kind: "codexCloud",
      accountId: "account",
      environmentConfigId: "cloud",
      name: "Cloud",
      cwd: "/workspace",
    },
  });
  state.readProjectFile.mockReset();

  return {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
}
