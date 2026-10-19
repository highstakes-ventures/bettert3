import type { CodexCloudDestination } from "@t3tools/contracts";
import { ComposerSelectControl } from "./chat/ComposerControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, ScaleIcon } from "lucide-react";
import { memo, useMemo } from "react";

import type { EnvironmentOption } from "./BranchToolbar.logic";
import { ThreadExecutionIcon, executionLocationLabel } from "./ThreadExecutionIcon";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  cloudDestinations?: readonly CodexCloudDestination[] | undefined;
  runDestination?: CodexCloudDestination | null | undefined;
  executionLocation?:
    | { readonly executionDestination?: CodexCloudDestination | null | undefined }
    | undefined;
  onCloudDestinationChange?: ((destination: CodexCloudDestination) => void) | undefined;

  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  environmentId,
  availableEnvironments,
  cloudDestinations,
  runDestination,
  executionLocation,
  onCloudDestinationChange,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const destinationLabel = executionLocation
    ? executionLocationLabel(executionLocation.executionDestination, activeEnvironment?.label)
    : runDestination
      ? `Codex Cloud · ${runDestination.name}`
      : (autoEnvironmentLabel ?? activeEnvironment?.label ?? "Run on");
  const destinationIcon = executionLocation ? (
    <ThreadExecutionIcon
      destination={executionLocation.executionDestination}
      machine={activeEnvironment?.machine ?? "server"}
      className="size-3 shrink-0"
    />
  ) : runDestination ? (
    <CloudIcon className="size-3 shrink-0" aria-hidden="true" />
  ) : (
    <EnvironmentMachineIcon
      kind={activeEnvironment?.machine ?? "server"}
      className="size-3 shrink-0"
    />
  );

  const environmentItems = useMemo(
    () => [
      ...(onAutoEnvironment
        ? [{ value: "auto", label: autoEnvironmentLabel ?? "Auto balance" }]
        : []),
      ...(cloudDestinations ?? []).map((destination) => ({
        value: `cloud:${destination.environmentConfigId}`,
        label: `Codex Cloud · ${destination.name}`,
      })),
      ...availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    ],
    [availableEnvironments, autoEnvironmentLabel, onAutoEnvironment, cloudDestinations],
  );

  // The static label carries the xs control's height (h-7 sm:h-6) as well as
  // its padding: the composer context strip has no min-height of its own, and
  // the glass seam joining it to the composer assumes a fixed strip height, so
  // a shorter label would drag the seam out of line whenever this label is the
  // only thing in the strip.
  if (envLocked || onEnvironmentChange === undefined) {
    const lockedRow = (
      <span
        className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
        data-composer-context-control
      >
        {destinationIcon}
        <ComposerContextLabel>{destinationLabel}</ComposerContextLabel>
      </span>
    );
    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup>{destinationLabel}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={
        runDestination
          ? `cloud:${runDestination.environmentConfigId}`
          : autoEnvironmentLabel
            ? "auto"
            : environmentId
      }
      onValueChange={(value) => {
        const cloud = cloudDestinations?.find(
          (destination) => `cloud:${destination.environmentConfigId}` === value,
        );
        if (cloud) onCloudDestinationChange?.(cloud);
        else if (value === "auto") onAutoEnvironment?.();
        else onEnvironmentChange(value as EnvironmentId);
      }}
      items={environmentItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerSelectControl
              size="xs"
              className="min-w-0 max-w-full"
              aria-label="Run on"
              data-composer-shortcut="composer.host"
              data-composer-context-control
            />
          }
        >
          {autoEnvironmentLabel ? (
            <ScaleIcon className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            destinationIcon
          )}
          <ComposerContextLabel>
            {executionLocation ? destinationLabel : <SelectValue />}
          </ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>{destinationLabel}</TooltipPopup>
      </Tooltip>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {onAutoEnvironment && (
            <SelectItem
              value="auto"
              onClick={() => {
                if (autoEnvironmentLabel) onAutoEnvironment?.();
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <ScaleIcon className="size-3" aria-hidden="true" />
                {autoEnvironmentLabel ?? "Auto balance"}
              </span>
            </SelectItem>
          )}
          {cloudDestinations?.map((destination) => (
            <SelectItem
              key={destination.environmentConfigId}
              value={`cloud:${destination.environmentConfigId}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <CloudIcon className="size-3" />
                Codex Cloud · {destination.name}
              </span>
            </SelectItem>
          ))}
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                <EnvironmentMachineIcon kind={env.machine} className="size-3" />
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
