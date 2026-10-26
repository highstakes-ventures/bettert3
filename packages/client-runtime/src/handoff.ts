import type {
  MessageId,
  ModelSelection,
  OrchestrationV2Run,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ProviderInstanceId,
  RunId,
  ServerProvider,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";

export interface AcceptedModelSelection {
  readonly messageId: MessageId;
  readonly sequence: number;
  readonly selection: ModelSelection;
}

export interface AcceptedModelSelectionEvidence {
  readonly shellSequence: number | null;
  readonly shellLatestRun?: {
    readonly runId: RunId;
    readonly status: OrchestrationV2RunStatus;
  } | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly projectionSequence: number | null;
}

/** Keep a delivered choice until both subscriptions can account for its run. */
export function acceptedModelSelectionPending(
  input: AcceptedModelSelectionEvidence & {
    readonly accepted: AcceptedModelSelection;
    readonly threadSelection: ModelSelection;
  },
): boolean {
  const { accepted, threadSelection, shellSequence, projection, projectionSequence } = input;
  if (
    shellSequence === null ||
    shellSequence < accepted.sequence ||
    projectionSequence === null ||
    projectionSequence < accepted.sequence
  )
    return true;
  const run = projection?.runs.find((candidate) => candidate.userMessageId === accepted.messageId);
  // A sequenced command can steer an existing run or its run may have been
  // removed by a later rewind. Both snapshots already cover that acceptance.
  // Launch replies have no sequence, so they still need the new run as evidence.
  if (!run) return accepted.sequence === 0;
  if (run.status === "queued" || run.status === "preparing") return true;
  const shellRun = input.shellLatestRun;
  if (
    shellRun &&
    shellRun.status !== "queued" &&
    shellRun.status !== "preparing" &&
    (shellRun.runId === run.id ||
      projection?.runs.some(
        (candidate) => candidate.id === shellRun.runId && candidate.ordinal > run.ordinal,
      ))
  )
    return false;
  // The shell may still precede the run transition even though it has passed
  // admission. A matching selection is already authoritative; a different one
  // needs a shell at least as recent as the projection that saw the transition.
  return (
    !modelSelectionsEqual(threadSelection, accepted.selection) && shellSequence < projectionSequence
  );
}

/**
 * The subset of a projection run that handoff rows read. Kept minimal so the
 * timeline can hold a content-stable snapshot: run status/timestamps churn on
 * every stream event, but these fields only change when a run is added.
 */
export type HandoffTimelineRun = Pick<
  OrchestrationV2Run,
  "id" | "ordinal" | "providerInstanceId" | "modelSelection"
>;

export type HandoffEndpoints = ReturnType<typeof resolveHandoffEndpoints>;

/** Preview the next send's handoff without adding anything to durable history. */
export function resolvePendingHandoff(
  projection: OrchestrationV2ThreadProjection | null | undefined,
  selection: ModelSelection | null | undefined,
  providers: ReadonlyArray<ServerProvider>,
): HandoffEndpoints | null {
  const from = projection?.runs.findLast(
    (run) => run.startedAt !== null && run.status !== "rolled_back",
  )?.modelSelection;
  if (from === undefined || selection == null) return null;
  const source = providers.find((provider) => provider.instanceId === from.instanceId);
  const target = providers.find((provider) => provider.instanceId === selection.instanceId);
  if (!target || target.availability === "unavailable") return null;
  const needsHandoff =
    from.instanceId === selection.instanceId
      ? from.model !== selection.model && target?.requiresNewThreadForModelChange === true
      : // Accounts sharing a continuation group resume the same native thread.
        source?.continuation?.groupKey === undefined ||
        source.driver !== target?.driver ||
        source.continuation.groupKey !== target.continuation?.groupKey;
  return needsHandoff ? { from: [from], to: selection } : null;
}

export function resolveHandoffEndpoints(
  item: Pick<
    Extract<OrchestrationV2TurnItem, { type: "handoff" }>,
    "runId" | "fromModelSelections" | "fromProviderInstanceIds" | "toModel" | "toProviderInstanceId"
  >,
  runs: ReadonlyArray<HandoffTimelineRun>,
) {
  // Items persisted before models were stamped only carry instance ids;
  // recover the models from the thread's runs (the handoff's own run is
  // the target, the newest earlier run per source instance is the origin).
  // Clients fall back to the provider display name when neither source has a model.
  const handoffRun = item.runId === null ? undefined : runs.find((run) => run.id === item.runId);
  const toModel =
    item.toModel ??
    (handoffRun !== undefined && handoffRun.providerInstanceId === item.toProviderInstanceId
      ? handoffRun.modelSelection.model
      : undefined);
  const fromEndpoints: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly model?: string | undefined;
  }> =
    item.fromModelSelections !== undefined && item.fromModelSelections.length > 0
      ? item.fromModelSelections
      : item.fromProviderInstanceIds.map((instanceId) => ({
          instanceId,
          model: latestRunModelBefore(runs, instanceId, handoffRun?.ordinal),
        }));
  return { from: fromEndpoints, to: { instanceId: item.toProviderInstanceId, model: toModel } };
}

/**
 * Model of the newest run for `instanceId` that started before the handoff's
 * own run. Legacy handoff items don't record their source models, but the
 * covered runs are still in the projection.
 */
function latestRunModelBefore(
  runs: ReadonlyArray<HandoffTimelineRun>,
  instanceId: ProviderInstanceId,
  beforeOrdinal: number | undefined,
): string | undefined {
  let latest: HandoffTimelineRun | undefined;
  for (const run of runs) {
    if (run.providerInstanceId !== instanceId) continue;
    if (beforeOrdinal !== undefined && run.ordinal >= beforeOrdinal) continue;
    if (latest === undefined || run.ordinal > latest.ordinal) latest = run;
  }
  return latest?.modelSelection.model;
}
