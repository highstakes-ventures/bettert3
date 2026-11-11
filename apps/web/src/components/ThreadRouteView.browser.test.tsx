import { render } from "../../test/render";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  ticketWorkflowId: undefined as string | undefined,
  loaded: true,
  navigate: vi.fn(),
  command: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
vi.mock("../state/cloudChats", () => ({ cloudChats: { open: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
vi.mock("./ChatView", () => ({ default: () => null }));
vi.mock("./ChatView.logic", () => ({ threadHasStarted: () => true }));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: (props: React.PropsWithChildren) => props.children,
}));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (id: string) => id },
  useComposerDraftStore: (select: (store: unknown) => unknown) =>
    select({
      getDraftThreadByRef: () => null,
      getDraftIdByRef: () => null,
      hasDraftThreadsInEnvironment: () => false,
    }),
  useBackgroundDraftSubmissionPending: () => false,
}));
vi.mock("../state/entities", () => ({
  useThreadRefs: () => [],
  useAnyEnvironmentHiding: () => false,
  useEnvironmentThreadRefs: () => [],
  useQuietThreadShell: (ref: ScopedThreadRef | null) =>
    state.loaded && ref
      ? {
          id: ref.threadId,
          environmentId: ref.environmentId,
          projectId: ProjectId.make("project"),
          source: { ticketWorkflowId: state.ticketWorkflowId },
        }
      : null,
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: { status: "live" } }) }));
vi.mock("../state/shell", () => ({ useEnvironmentShellStatus: () => "live" }));
vi.mock("../state/threads", async () => ({
  environmentThreadShells: {
    hiddenThreadKeysAtom: (await import("effect/reactivity")).Atom.make(new Set()),
  },
  useEnvironmentThread: () => ({ status: "loading", data: { _id: "Option", _tag: "None" } }),
}));

import { ThreadRouteView } from "./ThreadRouteView";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";

const ref = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("refinement"));
const other = scopeThreadRef(EnvironmentId.make("other-environment"), ThreadId.make("refinement"));
const view = (threadRef = ref) => <ThreadRouteView target={{ kind: "server", threadRef }} />;
const panel = (threadRef = ref) =>
  selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef);

it("opens the linked ticket when entering a refinement chat, including after its shell loads", async () => {
  using _state = setup();

  state.loaded = false;
  await using screen = await render(view(), { router: false });
  expect(panel()).toBeNull();
  state.loaded = true;
  state.ticketWorkflowId = "ticket-run";
  await screen.rerender(view());
  expect(panel()).toMatchObject({ kind: "ticket", runId: "ticket-run", projectId: "project" });
  useRightPanelStore.getState().closeAllSurfaces(ref);
  await screen.rerender(view());
  expect(panel()).toBeNull();
  state.ticketWorkflowId = undefined;
  await screen.rerender(view(other));
  expect(panel(other)).toBeNull();
  state.ticketWorkflowId = "ticket-run";
  await screen.rerender(view());
  expect(panel()).toMatchObject({ kind: "ticket", runId: "ticket-run" });
});

it("leaves an ordinary chat's existing panel alone", async () => {
  using _state = setup();

  useRightPanelStore.getState().open(ref, "files");
  await using _screen = await render(view(), { router: false });
  expect(panel()).toMatchObject({ kind: "files" });
});

function setup() {
  state.ticketWorkflowId = undefined;
  state.loaded = true;
  state.navigate.mockClear();
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
  });

  return {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
}
