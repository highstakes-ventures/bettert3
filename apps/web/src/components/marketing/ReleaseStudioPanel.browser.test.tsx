import "../../index.css";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { StudioResponse } from "@highstakes/marketing/contracts";
const state = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn() }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.request }));
vi.mock("~/state/marketing", () => ({ marketingEnvironment: { request: {}, read: state.read } }));
import { ReleaseStudioPanel } from "./ReleaseStudioPanel";
it("hides the previous environment's review while the next draft is loading", async () => {
  state.request.mockReset();
  state.read.mockReset();
  const first: StudioResponse = {
    draft: {
      id: "42",
      revision: 2,
      projectId: "project",
      threadId: "marketing-release:42",
      release: {
        id: "42",
        tag: "v3.0.4",
        url: "https://github.com/recuut/platform/releases/tag/v3.0.4",
        revision: "a".repeat(40),
        publishedAt: "2026-11-01T23:46:08Z",
        notes: "Fixture",
        productionRunUrl: "https://github.com/recuut/platform/actions/runs/7",
      },
      stage: "selecting",
      highlights: {
        title: "First environment's selection",
        summary: "Visible selection",
        items: ["Passkey setup"],
      },
      selectionApproved: false,
      company: { text: "", author: "" },
      personal: { text: "", author: "", enabled: false },
      media: [],
      approvedRevision: null,
      companyPublication: { status: "pending", urn: null, url: null },
      personalPublication: { status: "pending", urn: null, url: null },
      pendingMessage: null,
      error: null,
      updatedAt: "2026-11-04T00:00:00Z",
    },
    publishingConfigured: false,
    publishingReason: "Not connected",
  };

  const second = {
    ...first,
    draft: {
      ...first.draft!,
      highlights: { ...first.draft!.highlights!, title: "Second environment's selection" },
    },
  };
  const firstAtom = Atom.make(AsyncResult.success(first));
  const secondAtom = Atom.make<AsyncResult.AsyncResult<StudioResponse, never>>(
    AsyncResult.initial(),
  );
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  state.read.mockImplementation(({ environmentId }) =>
    environmentId === "first" ? firstAtom : secondAtom,
  );
  state.request.mockResolvedValue({ _tag: "Success", value: second });
  const threadId = ThreadId.make("marketing-release:42");
  const view = (environmentId: string) => (
    <RegistryContext value={registry}>
      <ReleaseStudioPanel environmentId={EnvironmentId.make(environmentId)} threadId={threadId} />
    </RegistryContext>
  );
  await using screen = await render(view("first"));
  await expect
    .element(screen.getByRole("button", { name: "Approve highlights and prepare" }))
    .toBeVisible();
  await screen.rerender(view("second"));
  await expect.element(screen.getByText("First environment's selection")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Approve highlights and prepare" }))
    .not.toBeInTheDocument();
  await act(() => registry.set(secondAtom, AsyncResult.success(second)));
  await screen.getByRole("button", { name: "Approve highlights and prepare" }).click();
  await vi.waitFor(() =>
    expect(state.request).toHaveBeenLastCalledWith({
      environmentId: "second",
      input: { threadId, command: { type: "approve_highlights", expectedRevision: 2 } },
    }),
  );
});
