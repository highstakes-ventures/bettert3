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
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { makeThreadFixture } from "~/test-fixtures";
import { toastManager } from "../ui/toast";
import { Popover } from "../ui/popover";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connect: vi.fn(),
  refresh: vi.fn(),
  onSaved: vi.fn(),
  navigate: vi.fn(),
  unsettle: vi.fn(),
  threadId: "chat-current",
  queue: [] as WorkflowRun[],
  shells: new Map<string, EnvironmentThreadShell | null>(),
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
vi.mock("~/state/threads", () => ({ threadEnvironment: { unsettle: "unsettle" } }));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.unsettle,
}));
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
  useThreadShells: () => [...state.shells.values()].filter((shell) => shell !== null),
  readThreadShell: ({
    environmentId,
    threadId,
  }: {
    environmentId: EnvironmentId;
    threadId: ThreadId;
  }) =>
    state.shells.has(`${environmentId}:${threadId}`)
      ? state.shells.get(`${environmentId}:${threadId}`)
      : makeThreadFixture({ environmentId, id: threadId }),
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
import {
  lastOpenedRefinementRunByEnvironment,
  requestWorkflowAction,
  useWorkflowDecisions,
} from "./workflowActions";

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
  state.unsettle.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.threadId = "chat-current";
  state.queue = [];
  state.shells.clear();
  lastOpenedRefinementRunByEnvironment.clear();
  useRightPanelStore.setState({ byThreadKey: {} });
  useWorkflowDecisions.setState({ decisions: [] });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  useWorkflowDecisions.setState({ decisions: [] });
  vi.unstubAllGlobals();
  lastOpenedRefinementRunByEnvironment.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

const shell = (id: string, overrides: Partial<EnvironmentThreadShell> = {}) => {
  const thread = makeThreadFixture({
    environmentId: EnvironmentId.make("test"),
    id: ThreadId.make(`chat-${id}`),
    ...overrides,
  });
  state.shells.set(`${thread.environmentId}:${thread.id}`, thread);
  return thread;
};
const working = (id: string) =>
  shell(id, {
    runtime: {
      status: "running",
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: "2026-10-23T12:00:00Z",
    },
  });

it.each(["button", "shortcut", "command"])(
  "%s advances through refinement tickets while the current agent is working, then wraps back",
  async (source) => {
    const next = run("next", "other-project");
    state.queue = [run("earlier"), run("current"), run("working"), run("snoozed"), next];
    working("current");
    working("working");
    shell("snoozed", { snoozedUntil: "2099-01-01T00:00:00Z" });
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
      params: { environmentId: "test", threadId: "chat-next" },
    });
    expect(state.unsettle.mock.calls.map(([request]) => request.input)).toEqual([
      { threadId: "chat-next", reason: "refinement" },
      { threadId: "chat-earlier", reason: "refinement" },
      { threadId: "chat-next", reason: "refinement" },
    ]);
  },
);

it.each(["working", "snoozed"])(
  "continues after the remembered %s chat instead of restarting at the front",
  async (status) => {
    state.threadId = "unrelated-chat";
    state.queue = [run("earlier"), run("remembered"), run("next")];
    if (status === "working") working("remembered");
    else shell("remembered", { snoozedUntil: "2099-01-01T00:00:00Z" });
    lastOpenedRefinementRunByEnvironment.set(EnvironmentId.make("test"), "remembered");
    await act(async () => {
      renderer = create(<SidebarWorkflowControls />);
    });
    await act(async () => requestWorkflowAction("refine"));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-next" },
    });
  },
);

it("stays in the chat without opening intake when every destination is working or snoozed", async () => {
  state.queue = [run("current"), run("snoozed")];
  working("current");
  shell("snoozed", { snoozedUntil: "2099-01-01T00:00:00Z" });
  const toast = vi.spyOn(toastManager, "add");
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  await act(async () => requestWorkflowAction("refine"));
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.unsettle).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByType(Popover).every((entry) => entry.props.open !== true)).toBe(
    true,
  );
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "No tickets ready to refine" }),
  );
});

it("updates the ready count at the snooze boundary and opens the woken ticket", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  state.queue = [run("current"), run("snoozed")];
  working("current");
  shell("snoozed", { snoozedUntil: "2026-10-23T12:00:10Z" });
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  const button = () => renderer!.root.findByProps({ "data-workflow-action": "refine" });
  expect(button().props["aria-label"]).toBe("Refine 0 tickets");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(button().props["aria-label"]).toBe("Refine 1 ticket");
  await act(async () => requestWorkflowAction("refine"));
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { environmentId: "test", threadId: "chat-snoozed" },
    }),
  );
});

it("opens a snoozed running chat that has woken to ask the user a question", async () => {
  state.queue = [run("current"), run("question")];
  working("current");
  const thread = working("question");
  shell("question", {
    runtime: thread.runtime,
    hasPendingUserInput: true,
    snoozedUntil: "2099-01-01T00:00:00Z",
  });
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  await act(async () => requestWorkflowAction("refine"));
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { environmentId: "test", threadId: "chat-question" },
    }),
  );
});

it("skips an unavailable shell without letting another environment's busy chat hide a ready one", async () => {
  state.queue = [run("current"), run("missing"), run("ready")];
  working("current");
  state.shells.set("test:chat-missing", null);
  const busy = working("ready");
  state.shells.delete("test:chat-ready");
  shell("ready", { ...busy, environmentId: EnvironmentId.make("other") });
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  await act(async () => requestWorkflowAction("refine"));
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { environmentId: "test", threadId: "chat-ready" },
    }),
  );
});

it.each(["Success", "Failure"])(
  "waits for sidebar restoration before opening a refinement chat when restoration returns %s",
  async (_tag) => {
    let finish!: (result: unknown) => void;
    state.unsettle.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.queue = [run("current"), run("next")];
    await act(async () => {
      renderer = create(<SidebarWorkflowControls />);
    });
    await act(async () => requestWorkflowAction("refine"));
    expect(state.unsettle).toHaveBeenCalledExactlyOnceWith({
      environmentId: "test",
      input: { threadId: "chat-next", reason: "refinement" },
    });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    await act(async () => finish({ _tag, value: undefined }));
    expect(state.navigate).toHaveBeenCalledTimes(_tag === "Success" ? 1 : 0);
    expect(lastOpenedRefinementRunByEnvironment.get(EnvironmentId.make("test"))).toBe(
      _tag === "Success" ? "next" : undefined,
    );
    if (_tag === "Success") {
      expect(useRightPanelStore.getState().byThreadKey["test:chat-next"]?.activeSurfaceId).toBe(
        "ticket:next",
      );
    } else expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(state.connect).not.toHaveBeenCalled();
    expect(useWorkflowDecisions.getState().decisions).toEqual([]);
  },
);

it.each(["button", "shortcut", "command"])(
  "%s resumes the last opened ticket after leaving refinement and remounting the controls",
  async (source) => {
    state.queue = [run("earlier"), run("current"), run("next")];
    const controls = () => (
      <>
        <WorkflowActionShortcuts />
        <SidebarWorkflowControls />
      </>
    );
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
    await act(async () => {
      renderer = create(controls());
    });
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { environmentId: "test", threadId: "chat-next" } }),
    );
    await act(async () => renderer!.unmount());
    state.threadId = "unrelated-chat";
    await act(async () => {
      renderer = create(controls());
    });
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { environmentId: "test", threadId: "chat-next" } }),
    );
    state.threadId = "chat-next";
    await act(async () => renderer!.update(controls()));
    await refine();
    expect(state.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { environmentId: "test", threadId: "chat-earlier" } }),
    );
  },
);

it.each(["missing", "pending", "no-chat", "other-environment"])(
  "falls back to the first eligible ticket when the remembered ticket is %s",
  async (reason) => {
    state.threadId = "unrelated-chat";
    state.queue = [run("first"), run("remembered")];
    lastOpenedRefinementRunByEnvironment.set(
      EnvironmentId.make(reason === "other-environment" ? "other" : "test"),
      "remembered",
    );
    if (reason === "missing") state.queue = [run("first")];
    if (reason === "no-chat") state.queue[1] = { ...run("remembered"), threadId: null };
    if (reason === "pending") {
      useWorkflowDecisions.setState({
        decisions: [
          {
            environmentId: EnvironmentId.make("test"),
            runId: "remembered",
            decision: "approve",
            stagedAt: "2026-10-23",
          },
        ],
      });
    }
    await act(async () => {
      renderer = create(<SidebarWorkflowControls />);
    });
    await act(async () => requestWorkflowAction("refine"));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "test", threadId: "chat-first" },
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

it("does not navigate after the controls unmount while a chat is reopening", async () => {
  let finish!: (result: unknown) => void;
  state.unsettle.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  state.queue = [run("next")];
  await act(async () => {
    renderer = create(<SidebarWorkflowControls />);
  });
  await act(async () => requestWorkflowAction("refine"));
  await act(async () => {
    renderer!.unmount();
  });
  renderer = undefined;
  await act(async () => finish({ _tag: "Success", value: undefined }));
  expect(state.navigate).not.toHaveBeenCalled();
  expect(useRightPanelStore.getState().byThreadKey).toEqual({});
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
