// @vitest-environment jsdom
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkflowError,
  type WorkflowRun,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connect: vi.fn(),
  refresh: vi.fn(),
  onSaved: vi.fn(),
  navigate: vi.fn(),
  threadId: "chat-current",
  queue: [] as WorkflowRun[],
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === "keybindings" ? DEFAULT_RESOLVED_KEYBINDINGS : true),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useParams: ({ select }: { select: (params: object) => unknown }) =>
    select({ environmentId: "test", threadId: state.threadId }),
}));
vi.mock("~/state/server", () => ({
  primaryServerKeybindingsAtom: "keybindings",
  serverEnvironment: {
    workflowLive: () => "live",
    workflowConnection: () => "connection",
    intakeWorkflow: { permissionAtom: () => null },
    updateSettings: { permissionAtom: () => null },
    connectWorkflow: { permissionAtom: () => null },
    disconnectWorkflow: {},
  },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (key: string) => ({
    data:
      key === "live"
        ? { connected: true, configuration: null, runs: state.queue }
        : { connected: false, teams: [], projects: [] },
    error: null,
    refresh: state.refresh,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.connect }));
vi.mock("~/hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeThread: {
      id: state.threadId,
      environmentId: "test",
      projectId: "project",
      runtimeMode: "full-access",
      latestTurnStatus: "running",
    },
  }),
}));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => DEFAULT_SERVER_SETTINGS }));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: () => null }));
vi.mock("~/state/entities", () => ({
  useProject: () => ({ environmentId: "test", id: "project" }),
  useProjects: () => [],
}));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("~/shortcutModifierState", () => ({ useShortcutModifierState: () => ({}) }));
vi.mock("../ui/sidebar", () => ({
  SidebarMenuButton: "button",
  SidebarMenuItem: "li",
  useSidebar: () => ({ isMobile: false, setOpen: () => {}, setOpenMobile: () => {} }),
}));
vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
  PopoverTrigger: ({ render }: { render: React.ReactNode }) => render,
  PopoverPopup: () => null,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

import {
  SidebarWorkflowControls,
  WorkflowActionShortcuts,
  WorkflowSetup,
} from "./WorkflowControls";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { requestWorkflowAction, useWorkflowDecisions } from "./workflowActions";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.connect.mockReset().mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new WorkflowError({ message: "Linear could not complete this request." })),
  });
  state.refresh.mockReset();
  state.onSaved.mockReset();
  state.navigate.mockReset().mockResolvedValue(undefined);
  state.threadId = "chat-current";
  state.queue = [];
  useRightPanelStore.setState({ byThreadKey: {} });
  useWorkflowDecisions.setState({ decisions: [] });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  useWorkflowDecisions.setState({ decisions: [] });
  vi.unstubAllGlobals();
});

const run = (id: string, project = "project"): WorkflowRun => ({
  id,
  projectId: ProjectId.make(project),
  kind: "tickets",
  phase: "review",
  title: id,
  priority: 3,
  blockerIds: [],
  threadId: ThreadId.make(`chat-${id}`),
  implementationThreadId: null,
  issueId: id,
  error: null,
  createdAt: "2026-10-21",
  updatedAt: "2026-10-21",
});

it.each(["button", "shortcut", "command"])(
  "%s advances through refinement tickets while the current agent is working, then wraps back",
  async (source) => {
    const next = run("next", "other-project");
    state.queue = [run("earlier"), run("current"), next];
    await act(async () => {
      renderer = create(
        <>
          <WorkflowActionShortcuts />
          <SidebarWorkflowControls />
        </>,
      );
    });
    const refine = () =>
      act(async () => {
        if (source === "shortcut") {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "r",
              ctrlKey: true,
              altKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        } else if (source === "command") requestWorkflowAction("refine");
        else renderer!.root.findByProps({ "data-workflow-action": "refine" }).props.onClick();
      });
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-next" },
    });
    const ref = scopeThreadRef(EnvironmentId.make("test"), next.threadId!);
    expect(
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.surfaces,
    ).toContainEqual({
      id: "ticket:next",
      kind: "ticket",
      runId: "next",
      projectId: next.projectId,
    });
    expect(state.connect).not.toHaveBeenCalled();
    expect(useWorkflowDecisions.getState().decisions).toEqual([]);
    state.threadId = "chat-next";
    await act(async () => {
      renderer!.update(
        <>
          <WorkflowActionShortcuts />
          <SidebarWorkflowControls />
        </>,
      );
    });
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-earlier" },
    });
    state.threadId = "chat-earlier";
    await act(async () => {
      renderer!.update(
        <>
          <WorkflowActionShortcuts />
          <SidebarWorkflowControls />
        </>,
      );
    });
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-current" },
    });
  },
);

it("skips tickets without a chat and decisions that are still pending", async () => {
  state.queue = [
    run("current"),
    { ...run("preparing"), threadId: null },
    run("pending"),
    run("ready"),
  ];
  useWorkflowDecisions.setState({
    decisions: [
      {
        environmentId: EnvironmentId.make("test"),
        runId: "pending",
        decision: "approve",
        stagedAt: "2026-10-23",
      },
    ],
  });
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  await act(async () => requestWorkflowAction("refine"));
  expect(state.navigate).toHaveBeenLastCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "test", threadId: "chat-ready" },
  });
  expect(state.connect).not.toHaveBeenCalled();
  expect(useWorkflowDecisions.getState().decisions).toHaveLength(1);
});

it.each(["chat-unrelated", "chat-current"])(
  "opens the only eligible ticket from %s without removing it from the queue",
  async (threadId) => {
    state.threadId = threadId;
    state.queue = [run("current")];
    await act(async () => {
      renderer = create(<SidebarWorkflowControls />);
    });
    await act(async () => requestWorkflowAction("refine"));
    expect(state.navigate).toHaveBeenLastCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-current" },
    });
    expect(state.connect).not.toHaveBeenCalled();
    expect(useWorkflowDecisions.getState().decisions).toEqual([]);
  },
);

it("shows a failed connection and lets the user retry the key without implying success", async () => {
  await act(async () => {
    renderer = create(
      <WorkflowSetup
        environmentId={EnvironmentId.make("test")}
        projectId={ProjectId.make("project")}
        threadId={ThreadId.make("thread")}
        modelSelection={{ instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" }}
        runtimeMode="full-access"
        keybindings={[]}
        configuration={null}
        onSaved={state.onSaved}
      />,
    );
  });
  const input = () => renderer!.root.findByType("input");
  await act(async () => input().props.onChange({ target: { value: "secret-test-key" } }));
  const submit = async () =>
    act(async () => {
      renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
  await submit();
  expect(
    renderer!.root.findAllByProps({ role: "alert" }).map((node) => node.props.children),
  ).toContain("Linear could not complete this request.");
  expect(input().props.value).toBe("secret-test-key");
  expect(renderer!.root.findByType("button").props.disabled).toBe(false);
  expect(state.onSaved).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
  state.connect.mockResolvedValue({
    _tag: "Success",
    value: { connected: true, teams: [], projects: [] },
  });
  await submit();
  expect(state.connect).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(input().props.value).toBe("");
  expect(state.onSaved).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledOnce();
});
