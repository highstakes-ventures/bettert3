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
  navigate: vi.fn(),
  refresh: vi.fn(),
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
            runs: state.queue.filter(
              (run) => key.input.includeAllProjects || run.projectId === key.input.projectId,
            ),
          }
        : key === "detail"
          ? state.detail
          : { projects: [] },
    refresh: state.refresh,
    error: null,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.decision }));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("../ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: () => null,
  SelectPopup: () => null,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectValue: () => <span>No project</span>,
}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

import { WorkflowTicketPanel } from "./WorkflowTicketPanel";
import { useRightPanelStore } from "~/rightPanelStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
      project: null,
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
    .mockResolvedValue({ _tag: "Success", value: { ...current, phase: "approved" } });
  state.navigate.mockReset().mockResolvedValue(undefined);
  state.refresh.mockReset();
  useRightPanelStore.setState({ byThreadKey: {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
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
const approve = async () => {
  const button = renderer!.root
    .findAllByType("button")
    .find((entry) => entry.props.children === "Approve")!;
  await act(async () => {
    await button.props.onClick();
  });
};
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
  expect(state.decision).toHaveBeenCalledWith({
    environmentId,
    input: {
      runId: "current",
      decision: "approve",
      expectedUpdatedAt: "native-revision",
      targetProjectId: null,
    },
  });
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: "chat-priority-prerequisite" },
  });
  const ref = scopeThreadRef(environmentId, ThreadId.make("chat-priority-prerequisite"));
  expect(useRightPanelStore.getState().byThreadKey).toMatchObject({
    [`${ref.environmentId}:${ref.threadId}`]: { activeSurfaceId: "ticket:priority-prerequisite" },
  });
});
it("stays on the ticket when recovery withdraws approval after a concurrent edit", async () => {
  state.decision.mockResolvedValue({
    _tag: "Success",
    value: { ...run("current"), phase: "review" },
  });
  await render();
  await approve();
  expect(state.navigate).not.toHaveBeenCalled();
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
  expect(state.navigate).not.toHaveBeenCalled();
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
