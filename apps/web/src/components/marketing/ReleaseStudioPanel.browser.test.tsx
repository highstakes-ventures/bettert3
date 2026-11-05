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
import { ReleaseStudioPanel, ReleaseStudioAutoOpen } from "./ReleaseStudioPanel";
import { useRightPanelStore, selectThreadRightPanelState } from "~/rightPanelStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
      company: { text: "Preview copy before approval", author: "" },
      xText: "Hello 👨‍👩‍👧‍👦 https://example.com/long/path",
      personal: { text: "", author: "", enabled: false },
      media: [
        {
          id: "preview",
          name: "preview.png",
          mimeType: "image/png",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          source: "Synthetic fixture",
          alt: "Announcement preview",
        },
      ],
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
  await expect.element(screen.getByText("Preview copy before approval")).toBeVisible();
  await expect.element(screen.getByRole("img", { name: "Announcement preview" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Approve LinkedIn posts and publish" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "X · Preview only", exact: true }).click();
  await expect.element(screen.getByText("Hello 👨‍👩‍👧‍👦 https://example.com/long/path")).toBeVisible();
  await expect.element(screen.getByText("32 / 280 weighted characters")).toBeVisible();
  await expect.element(screen.getByText("Preview copy before approval")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Personal repost · Not selected", exact: true }).click();
  await expect
    .element(screen.getByRole("article", { name: "LinkedIn personal repost preview" }))
    .toBeVisible();
  await expect.element(screen.getByText("Preview copy before approval")).toBeVisible();
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

it("opens Studio on entering a release chat after earlier panel actions and lets it close during the visit", async () => {
  const environmentId = EnvironmentId.make("studio-opening-test");
  const threadId = ThreadId.make("marketing-release:opening-test");
  const ref = scopeThreadRef(environmentId, threadId);
  const store = useRightPanelStore.getState();
  using _cleanup = { [Symbol.dispose]: () => useRightPanelStore.getState().removeThread(ref) };
  store.open(ref, "marketing");
  store.close(ref);
  expect(store.getUserActionRevision(ref)).toBeGreaterThan(0);
  const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  expect(panel().isOpen).toBe(false);
  await using screen = await render(
    <ReleaseStudioAutoOpen environmentId={environmentId} threadId={threadId} />,
  );
  expect(panel().isOpen).toBe(true);
  expect(panel().activeSurfaceId).toBe("marketing");
  await act(() => useRightPanelStore.getState().close(ref));
  await screen.rerender(
    <ReleaseStudioAutoOpen environmentId={environmentId} threadId={threadId} />,
  );
  expect(panel().isOpen).toBe(false);
  await screen.unmount();
});

it("expands the rendered LinkedIn fold without changing saved copy or approval", async () => {
  state.read.mockReset();
  const text = "A release headline.\n\n" + "A source-checked product change. ".repeat(24);
  const { SocialPostPreview } = await import("@highstakes/marketing/preview");
  await using screen = await render(
    <div style={{ width: 360 }}>
      <SocialPostPreview platform="linkedin" text={text} media={[]} dark={false} />
    </div>,
  );
  await expect.element(screen.getByRole("button", { name: "…see more" })).toBeVisible();
  await screen.getByRole("button", { name: "…see more" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Show less" }))
    .toHaveAttribute("aria-expanded", "true");
  await screen.getByRole("button", { name: "Show less" }).click();
  await expect
    .element(screen.getByRole("button", { name: "…see more" }))
    .toHaveAttribute("aria-expanded", "false");
});
