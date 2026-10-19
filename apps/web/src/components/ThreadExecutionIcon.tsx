import type { CodexCloudDestination, EnvironmentMachineKind } from "@t3tools/contracts";
import { CircleHelpIcon, CloudIcon, type LucideProps } from "lucide-react";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";

export function executionLocationLabel(
  destination: CodexCloudDestination | null | undefined,
  localLabel = "T3 host",
) {
  return destination === undefined
    ? "Execution location unknown"
    : destination === null
      ? localLabel
      : `Codex Cloud · ${destination.name}`;
}

/** Only recorded runtime provenance can claim that a chat ran on a machine. */
export function ThreadExecutionIcon({
  destination,
  machine,
  ...props
}: LucideProps & {
  readonly destination: CodexCloudDestination | null | undefined;
  readonly machine: EnvironmentMachineKind;
}) {
  if (destination === undefined) return <CircleHelpIcon {...props} />;
  if (destination !== null) return <CloudIcon {...props} />;
  return <EnvironmentMachineIcon kind={machine} {...props} />;
}
