import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../../test/render";
import { startWorkspaceFocus } from "../../lib/workspaceFocus";
import { usePreviewMiniPlayerStore } from "../../previewMiniPlayerStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { RightPanelSheet } from "../RightPanelSheet";
import { revealServerTabs } from "./agentOpenedPreviews";

vi.mock("../../state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => true,
}));

function Workspace({ threadRef, sheet }: { threadRef: ScopedThreadRef; sheet: boolean }) {
  const open = useRightPanelStore((state) => state.byThreadKey[scopedThreadKey(threadRef)]?.isOpen);
  const panel = (
    <section data-workspace-area="panel">
      <input aria-label="Browser address" />
    </section>
  );
  return (
    <>
      <section data-workspace-area="composer">
        <textarea aria-label="Message" />
      </section>
      {sheet ? (
        <RightPanelSheet
          animationDurationMs={0}
          open={open === true}
          onClose={() => useRightPanelStore.getState().close(threadRef)}
        >
          {panel}
        </RightPanelSheet>
      ) : (
        panel
      )}
      <button
        onClick={() =>
          useRightPanelStore.getState().activateSurface(threadRef, "browser:browser-tab")
        }
      >
        Show browser
      </button>
    </>
  );
}

it.each([false, true])(
  "keeps typing during an agent reveal with a closed sheet: %s",
  async (sheet) => {
    const ref = scopeThreadRef(EnvironmentId.make("focus-env"), ThreadId.make("focus-thread"));
    const panels = useRightPanelStore.getState();
    using _panel = {
      [Symbol.dispose]: () => {
        panels.removeThread(ref);
        usePreviewMiniPlayerStore.getState().removeThread(ref);
      },
    };
    const tab: PreviewSessionSnapshot = {
      threadId: ref.threadId,
      tabId: "browser-tab",
      navStatus: { _tag: "Loading", url: "https://example.com", title: "" },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      runtime: "server",
      reveal: true,
      revealRequest: { id: "reveal-1", force: true },
    };
    panels.openBrowser(ref, tab.tabId);
    panels.open(ref, "files");
    if (sheet) panels.close(ref);

    await using screen = await render(<Workspace threadRef={ref} sheet={sheet} />);
    using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
    const message = screen.getByRole("textbox", { name: "Message", exact: true });
    await userEvent.click(message);
    await userEvent.keyboard("unfinished");
    const messageElement = message.element();

    {
      using _timers = fakeTimers();
      await act(() => revealServerTabs(ref, [tab], { autoShowFloatingPreview: false }));
      await act(() => vi.runOnlyPendingTimersAsync());
      expect(document.activeElement).toBe(messageElement);
      const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)];
      expect(panel?.isOpen).toBe(!sheet);
      if (sheet) {
        expect(
          usePreviewMiniPlayerStore.getState().byThreadKey[scopedThreadKey(ref)]?.source,
        ).toEqual({
          kind: "browser",
          tabId: tab.tabId,
        });
      } else {
        expect(panel?.activeSurfaceId).toBe(`browser:${tab.tabId}`);
      }
    }

    await userEvent.keyboard(" draft");
    await expect.element(message).toHaveValue("unfinished draft");

    await act(() => panels.open(ref, "files"));
    if (sheet) await act(() => panels.close(ref));
    await userEvent.click(screen.getByRole("button", { name: "Show browser" }));
    await expect.element(page.getByRole("textbox", { name: "Browser address" })).toHaveFocus();
  },
);
