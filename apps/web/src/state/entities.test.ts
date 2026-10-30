import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { isProjectMissing } from "./entities";

it.each(["new", "reused"] as const)(
  "preserves a %s draft's remote destination until a live snapshot confirms deletion",
  (kind) => {
    const previous = useComposerDraftStore.getState();
    useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
    onTestFinished(() => {
      useComposerDraftStore.setState(previous, true);
    });
    const local = scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("local-project"));
    const remote = scopeProjectRef(EnvironmentId.make("remote"), ProjectId.make("remote-project"));
    const cloud = {
      kind: "codexCloud" as const,
      accountId: "account",
      environmentConfigId: "cloud-workspace",
      name: "Cloud",
      cwd: "/workspace",
    };
    const first = DraftId.make("before-remote-snapshot");
    const second = kind === "reused" ? first : DraftId.make("during-remote-startup");
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId("shared-project", remote, first);
    store.setDraftThreadContext(first, { environmentSelection: "manual", runDestination: cloud });
    store.setPrompt(first, "Keep this draft");
    let shell: EnvironmentShellState = {
      status: "empty",
      snapshot: Option.none(),
      error: Option.none(),
    };
    using readShell = vi.spyOn(appAtomRegistry, "get").mockReturnValue(shell);

    expect(isProjectMissing(remote)).toBe(false);
    store.setLogicalProjectDraftThreadId("shared-project", local, second, { isProjectMissing });
    expect(store.getDraftSession(second)).toMatchObject({ ...remote, runDestination: cloud });

    shell = {
      status: "live",
      snapshot: Option.some({
        schemaVersion: 1,
        snapshotSequence: 2,
        projects: [],
        threads: [],
        archivedThreads: [],
      }),
      error: Option.none(),
    };
    readShell.mockReturnValue(shell);
    expect(isProjectMissing(remote)).toBe(true);
    store.setLogicalProjectDraftThreadId("shared-project", local, second, { isProjectMissing });
    expect(store.getDraftSession(second)).toMatchObject({ ...local, runDestination: null });
    expect(store.getComposerDraft(first)?.prompt).toBe("Keep this draft");
  },
);

it("does not infer deletion from a disconnected environment's old snapshot", () => {
  const remote = scopeProjectRef(EnvironmentId.make("remote"), ProjectId.make("remote-project"));
  const shell: EnvironmentShellState = {
    status: "cached",
    snapshot: Option.some({
      schemaVersion: 1,
      snapshotSequence: 1,
      projects: [],
      threads: [],
      archivedThreads: [],
    }),
    error: Option.none(),
  };
  using _readShell = vi.spyOn(appAtomRegistry, "get").mockReturnValue(shell);
  expect(isProjectMissing(remote)).toBe(false);
});
