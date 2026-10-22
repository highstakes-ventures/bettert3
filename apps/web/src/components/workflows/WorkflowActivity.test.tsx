import { EnvironmentId, ProjectId, ThreadId, type WorkflowRun } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ runs: [] as WorkflowRun[] }));
vi.mock("~/state/server", () => ({
  serverEnvironment: { workflowLive: (input: unknown) => input },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (input: { input: { includeDelayed: boolean } } | null) => ({
    data: input
      ? { runs: state.runs.filter((run) => !run.delayedAt || input.input.includeDelayed) }
      : null,
    error: null,
  }),
}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
import { WorkflowActivity } from "./WorkflowActivity";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

it("keeps completed scan and delayed-ticket history accessible when activity is expanded", async () => {
  const projectId = ProjectId.make("project");
  const run: WorkflowRun = {
    id: "scan",
    projectId,
    kind: "performance",
    phase: "done",
    title: "Completed performance scan",
    priority: 0,
    blockerIds: [],
    threadId: ThreadId.make("scan-chat"),
    implementationThreadId: null,
    issueId: null,
    error: null,
    createdAt: "2026-10-22T07:00:00Z",
    updatedAt: "2026-10-22T07:00:00Z",
  };
  state.runs = [
    run,
    {
      ...run,
      id: "delayed",
      kind: "tickets",
      phase: "review",
      title: "Delayed ticket",
      delayedAt: run.createdAt,
    },
  ];
  await act(async () => {
    renderer = create(
      <WorkflowActivity
        environmentId={EnvironmentId.make("local")}
        projectId={projectId}
        onOpenRun={() => {}}
      />,
    );
  });
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  await act(async () =>
    renderer!.root.findByType("details").props.onToggle({ currentTarget: { open: true } }),
  );
  expect(
    renderer!.root.findAllByType("button").map((node) => node.findByType("span").children.join("")),
  ).toEqual(["Completed performance scan", "Delayed ticket"]);
});
