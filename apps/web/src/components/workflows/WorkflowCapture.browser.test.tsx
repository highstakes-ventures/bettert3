import "../../index.css";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ intake: vi.fn() }));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: unknown) =>
    atom === "keybindings" ? DEFAULT_RESOLVED_KEYBINDINGS : true) as never,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useParams: (({ select }: { select: (params: object) => unknown }) =>
    select({ environmentId: "test", threadId: "chat" })) as never,
}));
vi.mock(import("../../state/server"), () => ({
  primaryServerKeybindingsAtom: "keybindings" as never,
  serverEnvironment: {
    workflowLive: () => "live",
    intakeWorkflow: { permissionAtom: () => null },
    updateSettings: { permissionAtom: () => null },
  } as never,
}));
vi.mock(import("../../state/query"), () => ({
  useEnvironmentQuery: (() => ({
    data: { connected: true, configuration: {}, runs: [] },
    error: null,
  })) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.intake) as never,
}));
vi.mock(import("../../hooks/useHandleNewThread"), () => ({
  useHandleNewThread: (() => ({
    activeThread: {
      id: "chat",
      environmentId: "test",
      projectId: "project",
      runtimeMode: "full-access",
    },
  })) as never,
}));
vi.mock(import("../../hooks/useSettings"), () => ({
  useEnvironmentSettings: (() => DEFAULT_SERVER_SETTINGS) as never,
  useClientSettings: ((select: (settings: object) => unknown) => select({})) as never,
}));
vi.mock(import("../../composerDraftStore"), async () => {
  const Schema = await import("effect/Schema");
  return {
    DraftId: Schema.String.pipe(Schema.brand("DraftId")),
    useComposerDraftStore: (() => null) as never,
  };
});
vi.mock(import("../../state/entities"), () => ({
  useProject: (() => ({ environmentId: "test", id: "project" })) as never,
  useProjects: (() => []) as never,
  useThreadShells: (() => []) as never,
  readThreadShell: (() => null) as never,
}));
vi.mock(import("../../state/environments"), () => ({
  usePrimaryEnvironment: (() => null) as never,
}));
vi.mock(import("../../shortcutModifierState"), () => ({
  useShortcutModifierState: (() => ({})) as never,
}));
vi.mock(import("./WorkflowActivity"), () => ({ WorkflowActivity: () => <></> }));
vi.mock(import("./useOpenWorkflowRun"), () => ({ useOpenWorkflowRun: () => vi.fn() }));
vi.mock(import("../ui/toast"), () => ({
  toastManager: { add: vi.fn() } as never,
  stackedThreadToast: ((value: unknown) => value) as never,
}));
import { Sidebar, SidebarProvider, useSidebar } from "../ui/sidebar";
import { SidebarWorkflowControls, WorkflowActionShortcuts } from "./WorkflowControls";
import { requestWorkflowAction } from "./workflowActions";

function MobileState() {
  const sidebar = useSidebar();
  return (
    <p data-testid="sidebar-state">
      {sidebar.isMobile ? "mobile" : "desktop"} {sidebar.openMobile ? "open" : "closed"}
    </p>
  );
}

it("mounts ticket capture from the closed responsive mobile sidebar without navigating", async () => {
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => page.viewport(1280, 720));
  await page.viewport(390, 844);
  await using screen = await render(
    <SidebarProvider>
      <MobileState />
      <WorkflowActionShortcuts />
      <Sidebar>
        <SidebarWorkflowControls />
      </Sidebar>
    </SidebarProvider>,
  );
  await expect.element(screen.getByTestId("sidebar-state")).toHaveTextContent("mobile closed");
  await act(async () => requestWorkflowAction("ticket"));
  await expect.element(page.getByRole("dialog", { name: "Add a ticket" })).toBeVisible();
  expect(screen.router?.state.location.pathname).toBe("/");
});

it("focuses ticket capture, keeps Shift+Enter multiline, and submits Enter without navigating", async () => {
  state.intake.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <WorkflowActionShortcuts />
      <Sidebar>
        <SidebarWorkflowControls />
      </Sidebar>
    </SidebarProvider>,
  );
  await page.getByRole("button", { name: "Add ticket", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Ticket request" });
  await expect.element(field).toHaveFocus();
  await field.fill("Add a receipt export");
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  expect(state.intake).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(state.intake).toHaveBeenCalledOnce());
  expect(state.intake.mock.calls[0]![0].input.text).toBe("Add a receipt export");
  expect(screen.router?.state.location.pathname).toBe("/");
  await expect.element(page.getByRole("dialog", { name: "Add a ticket" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Add ticket", exact: true }).click();
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Add a ticket" })).not.toBeInTheDocument();
});
