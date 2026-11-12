import {
  CodexCloudDestination,
  EnvironmentId,
  ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import type { DraftSessionState } from "./composerDraftStore";

export const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);

export const RunDestinationPreferences = Schema.Record(
  Schema.String,
  Schema.Struct({
    environmentId: EnvironmentId,
    projectId: ProjectId,
    runDestination: Schema.NullOr(CodexCloudDestination),
    environmentSelection: Schema.optionalKey(Schema.Literals(["auto", "manual"])),
    workspace: Schema.optionalKey(
      Schema.Struct({
        envMode: DraftThreadEnvModeSchema,
        startFromOrigin: Schema.Boolean,
        branch: Schema.NullOr(Schema.String),
        worktreePath: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

export const isRunDestinationPreferences = Schema.is(RunDestinationPreferences);

type Preference = (typeof RunDestinationPreferences.Type)[string];
type DestinationOptions = Partial<
  Pick<
    DraftSessionState,
    | "environmentSelection"
    | "runDestination"
    | "branch"
    | "worktreePath"
    | "envMode"
    | "startFromOrigin"
    | "sectionId"
    | "loadBalancedEnvironmentId"
    | "createdAt"
    | "runtimeMode"
    | "interactionMode"
  >
> & {
  projectRef?: ScopedProjectRef;
  isProjectMissing?: (projectRef: ScopedProjectRef) => boolean;
  rememberWorkspace?: boolean;
};

export function resolveDraftDestination(input: {
  logicalProjectKey: string;
  projectRef: ScopedProjectRef;
  existingThread: DraftSessionState | undefined;
  savedPreference: Preference | undefined;
  options: DestinationOptions | undefined;
}): { projectRef: ScopedProjectRef; options: DestinationOptions | undefined } {
  const {
    logicalProjectKey: normalizedLogicalProjectKey,
    projectRef,
    existingThread,
    savedPreference,
    options,
  } = input;
  const logicalProjectChanged =
    existingThread !== undefined &&
    existingThread.logicalProjectKey !== normalizedLogicalProjectKey;
  const projectIsAvailable = (environmentId: EnvironmentId, projectId: ProjectId) =>
    !options?.isProjectMissing?.(scopeProjectRef(environmentId, projectId));
  const draftProjectMissing =
    existingThread !== undefined &&
    !projectIsAvailable(existingThread.environmentId, existingThread.projectId);
  const preference =
    (!existingThread || existingThread.logicalProjectKey !== normalizedLogicalProjectKey) &&
    options?.environmentSelection === undefined &&
    savedPreference !== undefined &&
    projectIsAvailable(savedPreference.environmentId, savedPreference.projectId)
      ? savedPreference
      : undefined;
  const keepDraftDestination =
    existingThread?.logicalProjectKey === normalizedLogicalProjectKey &&
    existingThread.environmentSelection === "manual" &&
    options?.environmentSelection === undefined &&
    !draftProjectMissing;
  const preferredProjectRef =
    preference && preference.environmentSelection !== "auto"
      ? scopeProjectRef(preference.environmentId, preference.projectId)
      : keepDraftDestination
        ? scopeProjectRef(existingThread.environmentId, existingThread.projectId)
        : projectRef;
  return {
    projectRef: preferredProjectRef,
    options: preference
      ? {
          ...options,
          ...preference.workspace,
          runDestination: preference.runDestination,
          environmentSelection: preference.environmentSelection ?? "manual",
          ...(preference.runDestination
            ? {
                branch: null,
                worktreePath: null,
                envMode: "local",
                startFromOrigin: false,
              }
            : {}),
        }
      : logicalProjectChanged || draftProjectMissing
        ? {
            runDestination: null,
            environmentSelection: "auto",
            loadBalancedEnvironmentId: null,
            branch: null,
            worktreePath: null,
            envMode: "local",
            startFromOrigin: false,
            sectionId: null,
            ...options,
          }
        : options,
  };
}

export function rememberNewDraftDestination(
  savedPreference: Preference | undefined,
  nextDraftThread: DraftSessionState,
): Preference {
  return {
    ...savedPreference,
    environmentId: nextDraftThread.environmentId,
    projectId: nextDraftThread.projectId,
    runDestination: nextDraftThread.runDestination ?? null,
    environmentSelection: "manual",
    ...(savedPreference?.workspace &&
    (savedPreference.environmentId !== nextDraftThread.environmentId ||
      savedPreference.projectId !== nextDraftThread.projectId)
      ? {
          workspace: {
            ...savedPreference.workspace,
            branch: null,
            worktreePath: null,
          },
        }
      : {}),
  };
}

export function restoreLocalWorkspace(
  preference: Preference | undefined,
  existing: DraftSessionState,
  requestedOptions: DestinationOptions,
): DestinationOptions {
  // Cloud has no local workspace controls. Returning to a machine
  // restores the last workspace choice without saving Cloud's forced local mode.
  const options =
    requestedOptions.runDestination === null && existing.runDestination
      ? {
          ...preference?.workspace,
          ...requestedOptions,
          ...(requestedOptions.projectRef &&
          (requestedOptions.projectRef.environmentId !== existing.environmentId ||
            requestedOptions.projectRef.projectId !== existing.projectId)
            ? { branch: null, worktreePath: null }
            : {}),
        }
      : requestedOptions;
  return options;
}

export function rememberDraftDestination(
  preference: Preference | undefined,
  nextDraftThread: DraftSessionState,
  options: DestinationOptions,
  projectChanged: boolean,
): Preference | undefined {
  const rememberEnvironment = options.environmentSelection !== undefined;
  const nextPreference =
    rememberEnvironment || options.rememberWorkspace
      ? {
          ...preference,
          environmentId: nextDraftThread.environmentId,
          projectId: nextDraftThread.projectId,
          runDestination: nextDraftThread.runDestination ?? null,
          environmentSelection: nextDraftThread.environmentSelection ?? "auto",
          ...(preference?.workspace && (projectChanged || options.environmentSelection === "auto")
            ? { workspace: { ...preference.workspace, branch: null, worktreePath: null } }
            : {}),
          ...(options.rememberWorkspace && !nextDraftThread.runDestination
            ? {
                workspace: {
                  envMode: nextDraftThread.envMode,
                  startFromOrigin: nextDraftThread.startFromOrigin,
                  branch: nextDraftThread.worktreePath ? nextDraftThread.branch : null,
                  worktreePath: nextDraftThread.worktreePath,
                },
              }
            : {}),
        }
      : preference;
  return nextPreference;
}
