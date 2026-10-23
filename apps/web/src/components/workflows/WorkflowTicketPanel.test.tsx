import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type WorkflowDetail,
  type WorkflowRun,
} from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  detail: null as WorkflowDetail | null,
  queue: [] as WorkflowRun[],
  decision: vi.fn(),
  settle: vi.fn(),
  unsettle: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
  projects: [
    { id: "intake", name: "BACKLOG", teamIds: ["team"], initiatives: [] },
    { id: "target", name: "Delivery", teamIds: ["team"], initiatives: [] },
    { id: "other-team", name: "Other team", teamIds: ["other-team"], initiatives: [] },
  ],
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    workflowLive: (input: { input: { projectId: ProjectId; includeAllProjects?: boolean } }) =>
      input,
    workflowDetail: () => "detail",
    workflowConnection: () => "connection",
    decideWorkflow: { permissionAtom: () => null },
  },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (
    key: string | { input: { projectId: ProjectId; includeAllProjects?: boolean } },
  ) => ({
    data:
      typeof key !== "string"
        ? {
            configuration: { intakeProjectId: "intake" },
            runs: state.queue.filter(
              (run) => key.input.includeAllProjects || run.projectId === key.input.projectId,
            ),
          }
        : key === "detail"
          ? state.detail
          : { projects: state.projects },
    refresh: state.refresh,
    error: null,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.decision }));
vi.mock("~/state/threads", () => ({
  threadEnvironment: { settle: "settle", unsettle: "unsettle" },
}));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: (command: string) =>
    command === "settle" ? state.settle : state.unsettle,
}));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("../ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectPopup: ({ children }: { children: React.ReactNode }) => children,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

import { WorkflowTicketPanel } from "./WorkflowTicketPanel";
import { useRightPanelStore } from "~/rightPanelStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { undoLatestThreadAction, useThreadUndoNotice } from "~/hooks/showThreadUndoNotice";
import {
  refinementQueueWithPendingDecisions,
  useRefinementQueue,
  useWorkflowDecisions,
} from "./workflowActions";
const environmentId = EnvironmentId.make("test");
const projectId = ProjectId.make("project");
const run = (id: string): WorkflowRun => ({
  id,
  projectId,
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
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
  const current = run("current");
  state.detail = {
    run: current,
    dependencyEvidence: [],
    questions: [],
    ticket: {
      id: "current",
      identifier: "REC-1",
      title: "Current ticket",
      url: "https://linear.app/issue/current",
      stateId: "todo",
      stateType: "unstarted",
      updatedAt: "native-revision",
      description: "Problem",
      teamId: "team",
      project: state.projects[1]!,
      priority: 3,
      estimate: null,
      dueDate: null,
      labels: [],
      blockedBy: [],
      blocks: [],
      comments: [],
      resources: [],
    },
  };
  state.queue = [current, run("next")];
  state.decision
    .mockReset()
    .mockImplementation(async ({ input }: { input: { decision: string } }) => ({
      _tag: "Success",
      value:
        input.decision === "delay"
          ? { ...current, delayedAt: "2026-10-22T12:00:05Z" }
          : { ...current, phase: input.decision === "reject" ? "rejected" : "approved" },
    }));
  state.settle.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.unsettle.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.navigate.mockReset().mockResolvedValue(undefined);
  state.refresh.mockReset();
  useRightPanelStore.setState({ byThreadKey: {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  await vi.runAllTimersAsync();
  useWorkflowDecisions.setState({ decisions: [] });
  vi.useRealTimers();
});
const render = async () =>
  act(async () => {
    renderer = create(
      <WorkflowTicketPanel
        environmentId={environmentId}
        projectId={projectId}
        runId="current"
        cwd="/project"
      />,
    );
  });
const click = async (label: string) => {
  const button = renderer!.root
    .findAllByType("button")
    .find((entry) => entry.props.children === label)!;
  await act(async () => {
    await button.props.onClick();
  });
};
const approve = () => click("Approve");
const expire = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
const currentQueue = () => refinementQueueWithPendingDecisions(environmentId, state.queue);
it.each(["Approve", "Reject", "Delay"])(
  "%s opens the next ticket before closing the mounted ticket surface",
  async (label) => {
    const ref = scopeThreadRef(environmentId, ThreadId.make("chat-current"));
    useRightPanelStore.getState().openTicket(ref, "current", projectId);
    function CurrentTicketSurface() {
      const activeSurface = useRightPanelStore(
        (store) => store.byThreadKey["test:chat-current"]?.activeSurfaceId,
      );
      return activeSurface === "ticket:current" ? (
        <WorkflowTicketPanel
          environmentId={environmentId}
          projectId={projectId}
          runId="current"
          cwd="/project"
        />
      ) : null;
    }
    let finishNext!: (result: unknown) => void;
    state.unsettle.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishNext = resolve;
        }),
    );
    await act(async () => {
      renderer = create(<CurrentTicketSurface />);
    });
    await click(label);
    expect(state.navigate).not.toHaveBeenCalled();
    await act(async () => finishNext({ _tag: "Success", value: undefined }));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: "chat-next" },
    });
    expect(useRightPanelStore.getState().byThreadKey["test:chat-next"]?.activeSurfaceId).toBe(
      "ticket:next",
    );
    expect(renderer!.root.findAllByType("h2")).toHaveLength(0);
    await expire();
    expect(state.decision).toHaveBeenCalledOnce();
    expect(state.settle).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: "chat-current" },
    });
  },
);

it("keeps the restored ticket surface when Undo finishes during the next navigation", async () => {
  const ref = scopeThreadRef(environmentId, ThreadId.make("chat-current"));
  useRightPanelStore.getState().openTicket(ref, "current", projectId);
  let finishNext!: () => void;
  state.navigate.mockImplementation(({ params }: { params: { threadId: string } }) =>
    params.threadId === "chat-next"
      ? new Promise<void>((resolve) => {
          finishNext = resolve;
        })
      : Promise.resolve(),
  );
  await render();
  await approve();
  await act(async () => {
    await useThreadUndoNotice.getState().notice!.undo();
  });
  await act(async () => finishNext());
  expect(useRightPanelStore.getState().byThreadKey["test:chat-current"]?.activeSurfaceId).toBe(
    "ticket:current",
  );
  expect(state.navigate).toHaveBeenLastCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-current" },
  });
  await expire();
  expect(state.decision).not.toHaveBeenCalled();
});

it.each(["Success", "Failure"])(
  "waits for sidebar restoration before advancing after a decision when restoration returns %s",
  async (_tag) => {
    let finish!: (result: unknown) => void;
    state.unsettle.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await approve();
    expect(state.unsettle).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: "chat-next", reason: "user" },
    });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.decision).not.toHaveBeenCalled();
    await act(async () => finish({ _tag, value: undefined }));
    expect(state.navigate).toHaveBeenCalledTimes(_tag === "Success" ? 1 : 0);
    if (_tag === "Success") {
      expect(useRightPanelStore.getState().byThreadKey["test:chat-next"]?.activeSurfaceId).toBe(
        "ticket:next",
      );
    } else expect(useRightPanelStore.getState().byThreadKey["test:chat-next"]).toBeUndefined();
    await expire();
    expect(state.decision).toHaveBeenCalledOnce();
  },
);

it("keeps the current ticket while the queue reorders and opens the new first ticket after approval", async () => {
  await render();
  state.queue = [run("priority-prerequisite"), run("next"), run("current")];
  await act(async () =>
    renderer!.update(
      <WorkflowTicketPanel
        environmentId={environmentId}
        projectId={projectId}
        runId="current"
        cwd="/project"
      />,
    ),
  );
  expect(renderer!.root.findByType("h2").props.children).toBe("Current ticket");
  expect(state.navigate).not.toHaveBeenCalled();
  await approve();
  await expire();
  expect(state.decision).toHaveBeenCalledWith({
    environmentId,
    input: {
      runId: "current",
      decision: "approve",
      expectedUpdatedAt: "native-revision",
      targetProjectId: "target",
    },
  });
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-priority-prerequisite" },
  });
  expect(state.unsettle).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: "chat-priority-prerequisite", reason: "user" },
  });
  const ref = scopeThreadRef(environmentId, ThreadId.make("chat-priority-prerequisite"));
  expect(useRightPanelStore.getState().byThreadKey).toMatchObject({
    [`${ref.environmentId}:${ref.threadId}`]: { activeSurfaceId: "ticket:priority-prerequisite" },
  });
});
it.each([{ id: null }, { id: "intake" }])(
  "requires a delivery project when the current project is $id",
  async ({ id }) => {
    state.detail = {
      ...state.detail!,
      ticket: {
        ...state.detail!.ticket!,
        project: state.projects.find((project) => project.id === id) ?? null,
      },
    };
    await render();
    const button = () =>
      renderer!.root.findAllByType("button").find((entry) => entry.props.children === "Approve")!;
    expect(button().props.disabled).toBe(true);
    await approve();
    expect(state.decision).not.toHaveBeenCalled();
    expect(renderer!.root.findByType("select").props.value).toBe("");
    expect(renderer!.root.findAllByType("option").map((option) => option.props.value)).toEqual([
      "",
      "target",
    ]);
    await act(async () => {
      renderer!.root.findByType("select").props.onChange({ currentTarget: { value: "target" } });
    });
    expect(button().props.disabled).toBe(false);
    await approve();
    await expire();
    expect(state.decision).toHaveBeenCalledWith({
      environmentId,
      input: {
        runId: "current",
        decision: "approve",
        expectedUpdatedAt: "native-revision",
        targetProjectId: "target",
      },
    });
  },
);
it("stays on the ticket when recovery withdraws approval after a concurrent edit", async () => {
  state.decision.mockResolvedValue({
    _tag: "Success",
    value: { ...run("current"), phase: "review" },
  });
  await render();
  await approve();
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: { environmentId, threadId: "chat-next" } }),
  );
  await expire();
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: { environmentId, threadId: "chat-current" } }),
  );
  expect(currentQueue().map((run) => run.id)).toContain("current");
  expect(state.refresh).toHaveBeenCalled();
});
it("opens the next repository's refinement chat with its own project binding", async () => {
  const other = ProjectId.make("other-repository");
  state.queue = [run("current"), { ...run("other"), projectId: other }];
  await render();
  await approve();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-other" },
  });
  const ref = scopeThreadRef(environmentId, ThreadId.make("chat-other"));
  expect(
    useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.surfaces,
  ).toContainEqual({
    id: "ticket:other",
    kind: "ticket",
    runId: "other",
    projectId: other,
  });
});
it("retains the ticket after a failed decision", async () => {
  state.decision.mockResolvedValue({ _tag: "Failure" });
  await render();
  await approve();
  await expire();
  expect(state.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: { environmentId, threadId: "chat-current" } }),
  );
  expect(currentQueue().map((run) => run.id)).toContain("current");
  expect(renderer!.root.findByType("h2").props.children).toBe("Current ticket");
});
it("advances after Delay without selecting tickets that depend on the delayed ticket", async () => {
  state.queue = [run("current"), { ...run("dependent"), blockerIds: ["current"] }, run("next")];
  state.decision.mockResolvedValue({
    _tag: "Success",
    value: { ...run("current"), delayedAt: "2026-10-22" },
  });
  await render();
  const button = renderer!.root
    .findAllByType("button")
    .find((entry) => entry.props.children === "Delay")!;
  await act(async () => {
    await button.props.onClick();
  });
  expect(currentQueue().map((run) => run.id)).toEqual(["next"]);
  expect(state.decision).not.toHaveBeenCalled();
  await expire();
  expect(state.decision.mock.calls[0]?.[0].input.decision).toBe("delay");
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-next" },
  });
});

it("closes the delayed ticket when there is nothing else eligible to refine", async () => {
  state.queue = [run("current")];
  state.decision.mockResolvedValue({
    _tag: "Success",
    value: { ...run("current"), delayedAt: "2026-10-22" },
  });
  const ref = scopeThreadRef(environmentId, ThreadId.make("chat-current"));
  useRightPanelStore.getState().openTicket(ref, "current", projectId);
  await render();
  const button = renderer!.root
    .findAllByType("button")
    .find((entry) => entry.props.children === "Delay")!;
  await act(async () => {
    await button.props.onClick();
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(
    useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.surfaces ??
      [],
  ).not.toContainEqual(expect.objectContaining({ id: "ticket:current" }));
});

it.each(["Approve", "Reject", "Delay"])(
  "%s waits five seconds and commits once after navigation and unmount",
  async (label) => {
    await render();
    await click(label);
    expect(state.decision).not.toHaveBeenCalled();
    expect(currentQueue().map((run) => run.id)).toEqual(["next"]);
    await act(async () => {
      renderer!.unmount();
    });
    renderer = undefined;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(state.decision).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.decision).toHaveBeenCalledOnce();
    expect(state.decision.mock.calls[0]?.[0].input.decision).toBe(label.toLowerCase());
    expect(state.settle).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: "chat-current" },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.decision).toHaveBeenCalledOnce();
    expect(state.settle).toHaveBeenCalledOnce();
  },
);

it.each(["Approve", "Reject", "Delay"])(
  "Undo cancels %s and reopens the ticket after unmount without calling Linear",
  async (label) => {
    state.queue = [run("current"), { ...run("dependent"), blockerIds: ["current"] }, run("next")];
    await render();
    await click(label);
    await act(async () => {
      renderer!.unmount();
    });
    renderer = undefined;
    const notice = useThreadUndoNotice.getState().notice!;
    await act(async () => {
      await notice.undo();
      await notice.undo();
    });
    expect(undoLatestThreadAction()).toBe(false);
    expect(state.unsettle.mock.calls.map(([request]) => request.input)).toEqual([
      { threadId: label === "Delay" ? "chat-next" : "chat-dependent", reason: "user" },
      { threadId: "chat-current", reason: "user" },
    ]);
    expect(state.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { environmentId, threadId: "chat-current" } }),
    );
    const ref = scopeThreadRef(environmentId, ThreadId.make("chat-current"));
    expect(
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]
        ?.activeSurfaceId,
    ).toBe("ticket:current");
    expect(currentQueue().map((run) => run.id)).toContain("current");
    expect(currentQueue().map((run) => run.id)).toContain("dependent");
    await expire();
    expect(state.decision).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
  },
);

it("keeps the restored ticket open when the next chat finishes reopening after Undo", async () => {
  let finishNext!: (result: unknown) => void;
  let finishCurrent!: (result: unknown) => void;
  state.unsettle.mockImplementation(
    ({ input }: { input: { threadId: string } }) =>
      new Promise((resolve) => {
        if (input.threadId === "chat-next") finishNext = resolve;
        else finishCurrent = resolve;
      }),
  );
  await render();
  await approve();
  const notice = useThreadUndoNotice.getState().notice!;
  await act(async () => {
    void notice.undo();
  });
  await act(async () => finishCurrent({ _tag: "Success", value: undefined }));
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-current" },
  });
  await act(async () => finishNext({ _tag: "Success", value: undefined }));
  expect(state.navigate).toHaveBeenCalledTimes(1);
  expect(useRightPanelStore.getState().byThreadKey["test:chat-next"]).toBeUndefined();
  await expire();
  expect(state.decision).not.toHaveBeenCalled();
});

it("blocks a repeated click and keeps a successful decision hidden until the subscription catches up", async () => {
  await render();
  const handler = renderer!.root
    .findAllByType("button")
    .find((entry) => entry.props.children === "Approve")!.props.onClick;
  await act(async () => {
    handler();
    handler();
  });
  expect(useWorkflowDecisions.getState().decisions).toHaveLength(1);
  await expire();
  expect(state.decision).toHaveBeenCalledOnce();
  expect(currentQueue().map((run) => run.id)).not.toContain("current");
  state.queue = [{ ...run("current"), phase: "approved" }, run("next")];
  await act(async () => {
    renderer!.update(
      <WorkflowTicketPanel
        environmentId={environmentId}
        projectId={projectId}
        runId="current"
        cwd="/project"
      />,
    );
  });
  expect(useWorkflowDecisions.getState().decisions).toHaveLength(1);
  expect(currentQueue().map((run) => run.id)).toEqual(["next"]);
});

it("keeps committed decisions hidden across loading, fresh, and stale queue consumers", async () => {
  await render();
  await approve();
  await expire();
  function Snapshot({ runs }: { runs: ReadonlyArray<WorkflowRun> }) {
    return (
      <output>
        {useRefinementQueue(environmentId, runs)
          .map((run) => run.id)
          .join(",")}
      </output>
    );
  }
  const stale = [run("current"), run("next")];
  const loading: WorkflowRun[] = [];
  await act(async () => {
    renderer!.update(
      <>
        <Snapshot runs={stale} />
        <Snapshot runs={loading} />
      </>,
    );
  });
  expect(renderer!.root.findAllByType("output")[0]!.props.children).toBe("next");
  const fresh: WorkflowRun[] = [{ ...run("current"), phase: "approved" }, run("next")];
  await act(async () => {
    renderer!.update(
      <>
        <Snapshot runs={stale} />
        <Snapshot runs={fresh} />
      </>,
    );
  });
  expect(renderer!.root.findAllByType("output").map((node) => node.props.children)).toEqual([
    "next",
    "next",
  ]);
  await act(async () => {
    renderer!.update(
      <>
        <Snapshot runs={stale} />
        <Snapshot runs={stale} />
      </>,
    );
  });
  expect(renderer!.root.findAllByType("output").map((node) => node.props.children)).toEqual([
    "next",
    "next",
  ]);
});

it.each([
  { label: "Approve", phase: "approved" },
  { label: "Approve", phase: "implementing" },
  { label: "Approve", phase: "done" },
  { label: "Reject", phase: "rejected" },
  { label: "Delay", phase: "review", delayedAt: "2026-10-22T12:00:05Z" },
] as const)("settles only the refinement chat after $label saves as $phase", async (saved) => {
  let finish!: (result: unknown) => void;
  state.decision.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await click(saved.label);
  expect(state.settle).not.toHaveBeenCalled();
  await expire();
  expect(state.decision).toHaveBeenCalledOnce();
  expect(state.settle).not.toHaveBeenCalled();
  await act(async () => {
    finish({
      _tag: "Success",
      value: {
        ...run("current"),
        phase: saved.phase,
        delayedAt: "delayedAt" in saved ? saved.delayedAt : null,
        implementationThreadId: ThreadId.make("implementation-chat"),
      },
    });
  });
  expect(state.settle).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: "chat-current" },
  });
  expect(currentQueue().map((run) => run.id)).not.toContain("current");
});

it.each([
  { label: "Approve", outcome: "Failure" },
  { label: "Approve", outcome: "review" },
  { label: "Approve", outcome: "approving" },
  { label: "Reject", outcome: "Failure" },
  { label: "Reject", outcome: "review" },
  { label: "Reject", outcome: "rejecting" },
  { label: "Delay", outcome: "Failure" },
  { label: "Delay", outcome: "review" },
])(
  "does not settle the chat when $label returns $outcome without a saved decision",
  async ({ label, outcome }) => {
    state.decision.mockResolvedValue(
      outcome === "Failure"
        ? { _tag: "Failure" }
        : { _tag: "Success", value: { ...run("current"), phase: outcome } },
    );
    await render();
    await click(label);
    await expire();
    expect(state.settle).not.toHaveBeenCalled();
    expect(currentQueue().map((run) => run.id)).toContain("current");
  },
);

it.each(["Approve", "Reject", "Delay"])(
  "keeps a successful %s when settling its chat fails",
  async (label) => {
    state.settle.mockResolvedValue({ _tag: "Failure" });
    await render();
    await click(label);
    await expire();
    expect(state.settle).toHaveBeenCalledOnce();
    expect(currentQueue().map((run) => run.id)).not.toContain("current");
    expect(state.navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: { environmentId, threadId: "chat-current" } }),
    );
  },
);
