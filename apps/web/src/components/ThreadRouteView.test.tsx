import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  ticketWorkflowId: undefined as string | undefined,
  loaded: true,
  navigate: vi.fn(),
  command: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/cloudChats", () => ({ cloudChats: { open: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
vi.mock("./ChatView", () => ({ default: () => null }));
vi.mock("./ChatView.logic", () => ({ threadHasStarted: () => true }));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: (props: React.PropsWithChildren) => props.children,
}));
vi.mock("../composerDraftStore", () => ({
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
  useEnvironmentThreadRefs: () => [],
  useThreadShell: (ref: ScopedThreadRef) =>
    state.loaded
      ? {
          id: ref.threadId,
          environmentId: ref.environmentId,
          projectId: ProjectId.make("project"),
          source: { ticketWorkflowId: state.ticketWorkflowId },
        }
      : null,
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: { status: "live" } }) }));
vi.mock("../state/shell", () => ({ environmentShell: { stateAtom: () => null } }));

import { ThreadRouteView } from "./ThreadRouteView";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";

const ref = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("refinement"));
const other = scopeThreadRef(EnvironmentId.make("other-environment"), ThreadId.make("refinement"));
let renderer: ReactTestRenderer | undefined;
async function open(threadRef = ref) {
  await act(async () => {
    const view = <ThreadRouteView target={{ kind: "server", threadRef }} />;
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}
const panel = (threadRef = ref) =>
  selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.ticketWorkflowId = undefined;
  state.loaded = true;
  state.navigate.mockClear();
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("opens the linked ticket when entering a refinement chat, including after its shell loads", async () => {
  state.loaded = false;
  await open();
  expect(panel()).toBeNull();
  state.loaded = true;
  state.ticketWorkflowId = "ticket-run";
  await open();
  expect(panel()).toMatchObject({ kind: "ticket", runId: "ticket-run", projectId: "project" });
  useRightPanelStore.getState().closeAllSurfaces(ref);
  await open();
  expect(panel()).toBeNull();
  state.ticketWorkflowId = undefined;
  await open(other);
  expect(panel(other)).toBeNull();
  state.ticketWorkflowId = "ticket-run";
  await open();
  expect(panel()).toMatchObject({ kind: "ticket", runId: "ticket-run" });
});

it("leaves an ordinary chat's existing panel alone", async () => {
  useRightPanelStore.getState().open(ref, "files");
  await open();
  expect(panel()).toMatchObject({ kind: "files" });
});
