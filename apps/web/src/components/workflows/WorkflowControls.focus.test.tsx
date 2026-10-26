// @vitest-environment jsdom
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === "keybindings" ? DEFAULT_RESOLVED_KEYBINDINGS : true),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: object) => unknown }) =>
    select({ environmentId: "test", threadId: "chat" }),
}));
vi.mock("~/state/server", () => ({
  primaryServerKeybindingsAtom: "keybindings",
  serverEnvironment: {
    workflowLive: () => "live",
    intakeWorkflow: { permissionAtom: () => null },
    updateSettings: { permissionAtom: () => null },
  },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { connected: true, configuration: {}, runs: [] },
    error: null,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeThread: {
      id: "chat",
      environmentId: "test",
      projectId: "project",
      runtimeMode: "full-access",
    },
  }),
}));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => DEFAULT_SERVER_SETTINGS }));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: () => null }));
vi.mock("~/state/entities", () => ({
  useProject: () => ({ environmentId: "test", id: "project" }),
  useProjects: () => [],
  useThreadShells: () => [],
}));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("~/shortcutModifierState", () => ({ useShortcutModifierState: () => ({}) }));
vi.mock("../ui/sidebar", () => ({
  SidebarMenuButton: "button",
  SidebarMenuItem: "li",
  useSidebar: () => ({ isMobile: false, setOpen: () => {}, setOpenMobile: () => {} }),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("./WorkflowActivity", () => ({ WorkflowActivity: () => null }));
vi.mock("./useOpenWorkflowRun", () => ({ useOpenWorkflowRun: () => vi.fn() }));

import { SidebarWorkflowControls, WorkflowActionShortcuts } from "./WorkflowControls";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("focuses the ticket request when Cmd+Option+T opens or reopens intake", async () => {
  await act(() =>
    root.render(
      <>
        <WorkflowActionShortcuts />
        <SidebarWorkflowControls />
      </>,
    ),
  );
  for (const key of ["t", "Escape", "t"]) {
    await act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: key === "t" ? "KeyT" : "Escape",
          metaKey: key === "t",
          altKey: key === "t",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    if (key === "t") {
      await vi.waitFor(() => {
        const request = document.querySelector('textarea[aria-label="Ticket request"]');
        expect(request).not.toBeNull();
        expect(document.activeElement).toBe(request);
      });
    } else {
      await vi.waitFor(() =>
        expect(document.querySelector('textarea[aria-label="Ticket request"]')).toBeNull(),
      );
    }
  }
});
