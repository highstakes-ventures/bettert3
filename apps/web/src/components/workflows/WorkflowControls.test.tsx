import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkflowError,
} from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connect: vi.fn(),
  refresh: vi.fn(),
  onSaved: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    workflowConnection: () => "connection",
    connectWorkflow: { permissionAtom: () => null },
    disconnectWorkflow: {},
  },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { connected: false, teams: [], projects: [] },
    error: null,
    refresh: state.refresh,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.connect }));
vi.mock("~/hooks/useHandleNewThread", () => ({}));
vi.mock("~/hooks/useSettings", () => ({}));
vi.mock("~/composerDraftStore", () => ({}));
vi.mock("~/state/entities", () => ({}));
vi.mock("~/state/environments", () => ({}));
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

import { WorkflowSetup } from "./WorkflowControls";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  state.connect.mockReset().mockResolvedValue({
    _tag: "Failure",
    cause: Cause.fail(new WorkflowError({ message: "Linear could not complete this request." })),
  });
  state.refresh.mockReset();
  state.onSaved.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

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
