import type {
  MessageId,
  ModelSelection,
  OrchestrationV2ModelSwitch,
  OrchestrationV2Run,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ProviderInstanceId,
  RunId,
  ServerProvider,
  ServerProviderModel,
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
  readonly projection: Pick<OrchestrationV2ThreadProjection, "runs"> | null;
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
import {
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

import { isReasoningSelect } from "./modelTraits.ts";
import type { ThreadStructure } from "./state/models.ts";
import { REASONING_EFFORT_OPTION_IDS } from "./state/threadExecution.ts";

export type HandoffTimelineRun = Pick<
  OrchestrationV2Run,
  "id" | "ordinal" | "providerInstanceId" | "modelSelection"
>;

export type HandoffEndpoints = ReturnType<typeof resolveHandoffEndpoints>;

export function resolvePendingHandoff(
  projection: Pick<ThreadStructure, "runs" | "visibleTurnItems"> | null | undefined,
  selection: ModelSelection | null | undefined,
  providers: ReadonlyArray<ServerProvider>,
): HandoffEndpoints | null {
  // A thread with an empty timeline has nothing to hand off. Any loaded row
  // counts: paging can leave a window of only tool rows.
  if (!projection?.visibleTurnItems.length) return null;
  // The handoff row is committed before the provider starts. Use its destination
  // during startup so the footer does not duplicate the committed handoff.
  const from = projection.runs.findLast(
    (run) =>
      run.status !== "rolled_back" &&
      (run.startedAt !== null || (run.status === "starting" && run.contextHandoffId !== null)),
  )?.modelSelection;
  if (from === undefined || selection == null) return null;
  const source = providers.find((provider) => provider.instanceId === from.instanceId);
  const target = providers.find((provider) => provider.instanceId === selection.instanceId);
  if (!target || target.availability === "unavailable") return null;
  const needsHandoff =
    from.instanceId !== selection.instanceId &&
    (source?.continuation?.groupKey === undefined ||
      source.driver !== target.driver ||
      source.continuation.groupKey !== target.continuation?.groupKey);
  return needsHandoff ? { from: [from], to: selection } : null;
}

export function resolveHandoffEndpoints(
  item: Pick<
    Extract<OrchestrationV2TurnItem, { type: "handoff" }>,
    "runId" | "fromModelSelections" | "fromProviderInstanceIds" | "toModel" | "toProviderInstanceId"
  >,
  runs: ReadonlyArray<HandoffTimelineRun>,
) {
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

export interface ModelSwitchChange {
  readonly modelChanged: boolean;
  /** Effort labels, set only when the effort changed. */
  readonly effort: { readonly from: string; readonly to: string } | null;
}

/**
 * What a recorded model switch visibly changed, or null when it changed neither the model nor the
 * effort. The composer omits an untouched effort, so an unset effort reads as the model's default.
 */
export function resolveModelSwitchChange(
  { from, to }: OrchestrationV2ModelSwitch,
  providers: ReadonlyArray<ServerProvider>,
): ModelSwitchChange | null {
  const modelsOf = (selection: ModelSelection) =>
    providers.find((provider) => provider.instanceId === selection.instanceId)?.models;
  const fromEffort = resolveEffort(from, modelsOf(from));
  const toEffort = resolveEffort(to, modelsOf(to));
  const modelChanged = from.model !== to.model;
  const effort =
    fromEffort && toEffort && fromEffort.value !== toEffort.value
      ? { from: fromEffort.label, to: toEffort.label }
      : null;
  return modelChanged || effort ? { modelChanged, effort } : null;
}

/** The composer's reasoning control for the model; stated values only when the catalog lacks it. */
function resolveEffort(
  selection: ModelSelection,
  models: ReadonlyArray<ServerProviderModel> | undefined,
): { readonly value: string; readonly label: string } | undefined {
  const model = models?.find((candidate) => candidate.slug === selection.model);
  if (model === undefined) {
    // Pi states its effort as `thinking`; the catalog would otherwise mark it a reasoning control.
    const value = [...REASONING_EFFORT_OPTION_IDS, "thinking"]
      .map((id) => getModelSelectionStringOptionValue(selection, id))
      .find((candidate) => candidate !== undefined);
    return value === undefined ? undefined : { value, label: value };
  }
  const descriptor = model.capabilities?.optionDescriptors?.find(isReasoningSelect);
  if (descriptor === undefined) return undefined;
  const value =
    getModelSelectionStringOptionValue(selection, descriptor.id) ??
    getProviderOptionCurrentValue(descriptor, selection);
  if (typeof value !== "string") return undefined;
  return { value, label: descriptor.options.find((option) => option.id === value)?.label ?? value };
}
