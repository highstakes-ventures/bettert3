import {
  ProviderInstanceId,
  MessageId,
  RunId,
  type OrchestrationV2ThreadProjection,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveHandoffEndpoints,
  resolvePendingHandoff,
  acceptedModelSelectionPending,
  type HandoffTimelineRun,
} from "./handoff.ts";

const from = ProviderInstanceId.make("codex_personal");
const to = ProviderInstanceId.make("claudeAgent");
const item = {
  runId: RunId.make("target"),
  fromProviderInstanceIds: [from],
  toProviderInstanceId: to,
};
const run = (
  id: string,
  ordinal: number,
  instanceId: ProviderInstanceId,
  model: string,
): HandoffTimelineRun => ({
  id: RunId.make(id),
  ordinal,
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model },
});

describe("handoff endpoints shared by web and mobile", () => {
  it("preserves stamped models including several models from the same provider", () => {
    const fromModelSelections = [
      { instanceId: from, model: "source-a" },
      { instanceId: from, model: "source-b" },
    ];
    expect(
      resolveHandoffEndpoints({ ...item, fromModelSelections, toModel: "destination" }, [
        run("target", 2, to, "later-model"),
      ]),
    ).toEqual({
      from: fromModelSelections,
      to: { instanceId: to, model: "destination" },
    });
  });

  it("recovers legacy models from the handoff run and latest earlier source run", () => {
    const runs = [
      run("later", 4, from, "wrong-later-model"),
      run("old", 1, from, "old-model"),
      run("target", 3, to, "destination"),
      run("source", 2, from, "source-model"),
    ];
    expect(resolveHandoffEndpoints(item, runs)).toEqual({
      from: [{ instanceId: from, model: "source-model" }],
      to: { instanceId: to, model: "destination" },
    });
  });

  it("retains provider identities when historical runs are not loaded", () => {
    expect(resolveHandoffEndpoints(item, [])).toEqual({
      from: [{ instanceId: from, model: undefined }],
      to: { instanceId: to, model: undefined },
    });
  });

  it("does not borrow a target model from another provider", () => {
    expect(
      resolveHandoffEndpoints(item, [run("target", 2, from, "wrong-model")]).to.model,
    ).toBeUndefined();
  });
});

const projection = {
  runs: [{ ...run("source", 1, from, "source"), startedAt: "2026-10-11T00:00:00Z" }],
} as unknown as OrchestrationV2ThreadProjection;

describe("pending context handoff", () => {
  it("does not preview a handoff to a missing provider", () => {
    const providers = [
      { instanceId: from, driver: "codex", enabled: true },
    ] as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "target" }, providers),
    ).toBeNull();
  });

  it("uses the caller's project-effective provider choice while a raw enabled flag lags", () => {
    const providers = [
      { instanceId: from, driver: "codex", enabled: true },
      { instanceId: to, driver: "claudeAgent", enabled: false },
    ] as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "target" }, providers),
    ).toEqual({
      from: [{ instanceId: from, model: "source" }],
      to: { instanceId: to, model: "target" },
    });
  });

  it("does not preview a handoff to an unavailable provider", () => {
    const providers = [
      { instanceId: from, driver: "codex", enabled: true },
      { instanceId: to, driver: "claudeAgent", enabled: true, availability: "unavailable" },
    ] as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "target" }, providers),
    ).toBeNull();
  });

  it("appears on selection, updates the destination, and disappears on returning", () => {
    const providers = [from, to].map((instanceId) => ({
      instanceId,
      driver: instanceId === from ? "codex" : "claudeAgent",
      enabled: true,
    })) as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "first" }, providers),
    ).toEqual({
      from: [{ instanceId: from, model: "source" }],
      to: { instanceId: to, model: "first" },
    });
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "second" }, providers)?.to.model,
    ).toBe("second");
    expect(
      resolvePendingHandoff(projection, { instanceId: from, model: "source" }, providers),
    ).toBeNull();
    expect(
      resolvePendingHandoff(projection, { instanceId: from, model: "other" }, providers),
    ).toBeNull();
  });
  it("only previews a same-provider model change when it needs a fresh native thread", () => {
    const providers = [
      { instanceId: from, enabled: true, requiresNewThreadForModelChange: true },
    ] as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: from, model: "other" }, providers)?.to.model,
    ).toBe("other");
  });
  it("resumes compatible account overlays without showing a handoff", () => {
    const providers = [from, to].map((instanceId) => ({
      instanceId,
      driver: "codex",
      enabled: true,
      continuation: { groupKey: "shared" },
    })) as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "target" }, providers),
    ).toBeNull();
  });

  it("previews a switch between accounts in different continuation groups", () => {
    const providers = [
      { instanceId: from, driver: "codex", enabled: true, continuation: { groupKey: "work" } },
      { instanceId: to, driver: "codex", enabled: true, continuation: { groupKey: "personal" } },
    ] as unknown as ServerProvider[];
    expect(
      resolvePendingHandoff(projection, { instanceId: to, model: "target" }, providers),
    ).toEqual({
      from: [{ instanceId: from, model: "source" }],
      to: { instanceId: to, model: "target" },
    });
  });
});

describe("accepted next-send selection", () => {
  const chosen = { instanceId: to, model: "target" };
  const old = { instanceId: from, model: "source" };
  const accepted = {
    messageId: MessageId.make("accepted-handoff"),
    sequence: 10,
    selection: chosen,
  };
  const acceptedRun = (status: "queued" | "running" | "completed" | "cancelled") =>
    ({
      runs: [{ userMessageId: accepted.messageId, status }],
    }) as unknown as OrchestrationV2ThreadProjection;
  const pending = (input: {
    shellSequence: number;
    projectionSequence: number;
    status: "queued" | "running" | "completed" | "cancelled";
    threadSelection: typeof old;
  }) =>
    acceptedModelSelectionPending({
      accepted,
      projection: acceptedRun(input.status),
      ...input,
    });

  it("keeps a queued choice through unrelated shell updates and a lagging run start", () => {
    expect(
      pending({ shellSequence: 9, projectionSequence: 9, status: "queued", threadSelection: old }),
    ).toBe(true);
    expect(
      pending({
        shellSequence: 11,
        projectionSequence: 10,
        status: "queued",
        threadSelection: old,
      }),
    ).toBe(true);
    expect(
      pending({
        shellSequence: 11,
        projectionSequence: 12,
        status: "running",
        threadSelection: old,
      }),
    ).toBe(true);
  });

  it("uses the authoritative shell after the run starts or later migrates", () => {
    expect(
      pending({
        shellSequence: 12,
        projectionSequence: 12,
        status: "running",
        threadSelection: chosen,
      }),
    ).toBe(false);
    expect(
      pending({
        shellSequence: 14,
        projectionSequence: 13,
        status: "completed",
        threadSelection: old,
      }),
    ).toBe(false);
    expect(
      pending({
        shellSequence: 14,
        projectionSequence: 13,
        status: "cancelled",
        threadSelection: old,
      }),
    ).toBe(false);
  });

  it("waits for run evidence when a launch reply has no sequence", () => {
    expect(
      acceptedModelSelectionPending({
        accepted: { ...accepted, sequence: 0 },
        threadSelection: old,
        shellSequence: 10,
        projectionSequence: 10,
        projection: { runs: [] } as unknown as OrchestrationV2ThreadProjection,
      }),
    ).toBe(true);
  });

  it("retires accepted steering without waiting for a new run", () => {
    const activeRunId = RunId.make("steered-run");
    const steered = {
      runs: [
        { id: activeRunId, userMessageId: MessageId.make("original-message"), status: "running" },
      ],
      messages: [{ id: accepted.messageId, runId: activeRunId }],
    } as unknown as OrchestrationV2ThreadProjection;
    expect(
      acceptedModelSelectionPending({
        accepted,
        threadSelection: old,
        shellSequence: 9,
        projectionSequence: 10,
        projection: steered,
      }),
    ).toBe(true);
    expect(
      acceptedModelSelectionPending({
        accepted,
        threadSelection: chosen,
        shellSequence: 10,
        projectionSequence: 10,
        projection: steered,
      }),
    ).toBe(false);
  });

  it("accepts a shell that saw the completed run even when later detail events advance its sequence", () => {
    const acceptedRunId = RunId.make("accepted-run");
    expect(
      acceptedModelSelectionPending({
        accepted,
        threadSelection: old,
        shellSequence: 12,
        shellLatestRun: { runId: acceptedRunId, status: "completed" },
        projectionSequence: 13,
        projection: {
          runs: [
            {
              id: acceptedRunId,
              ordinal: 2,
              userMessageId: accepted.messageId,
              status: "completed",
            },
          ],
        } as unknown as OrchestrationV2ThreadProjection,
      }),
    ).toBe(false);
  });
});
