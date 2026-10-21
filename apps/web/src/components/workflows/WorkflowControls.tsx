import { randomUUID } from "~/lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ThreadId,
  WorkflowConfiguration,
  WorkflowConnection,
  WorkflowRun,
  WorkflowListResult,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { ListFilterIcon, TicketPlusIcon } from "lucide-react";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { useShortcutModifierState } from "~/shortcutModifierState";
import { useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom, serverEnvironment } from "~/state/server";
import { useProject, useProjects } from "~/state/entities";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  requestWorkflowAction,
  takeWorkflowAction,
  WORKFLOW_ACTION_EVENT,
} from "./workflowActions";

type Props = {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  keybindings: ResolvedKeybindingsConfig;
};

export function WorkflowActionShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile, setOpen } = useSidebar();
  const route = useParams({
    strict: false,
    select: (params) =>
      params.draftId ??
      (params.environmentId && params.threadId
        ? `${params.environmentId}:${params.threadId}`
        : null),
  });
  useEffect(() => {
    const showControls = () => {
      if (!route) {
        takeWorkflowAction();
        return;
      }
      if (isMobile) setOpenMobile(true);
      else setOpen(true);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!route || event.defaultPrevented || event.repeat) return;
      const terminalFocus =
        event.target instanceof Element && event.target.closest(".xterm") !== null;
      const command = resolveShortcutCommand(event, keybindings, { context: { terminalFocus } });
      if (command !== "workflow.ticket" && command !== "workflow.refine") return;
      event.preventDefault();
      requestWorkflowAction(command === "workflow.ticket" ? "ticket" : "refine");
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener(WORKFLOW_ACTION_EVENT, showControls);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener(WORKFLOW_ACTION_EVENT, showControls);
    };
  }, [keybindings, isMobile, route, setOpen, setOpenMobile]);
  useEffect(() => {
    if (!route) takeWorkflowAction();
    return () => {
      takeWorkflowAction();
    };
  }, [route]);
  return null;
}

export function SidebarWorkflowControls() {
  const { activeThread, activeDraftThread, routeDraftId, routeThreadRef } = useHandleNewThread();
  const primary = usePrimaryEnvironment();
  const projects = useProjects();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId;
  const composer = useComposerDraftStore((store) => {
    const target = routeDraftId ?? routeThreadRef;
    return target ? store.getComposerDraft(target) : null;
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  if (!thread || !threadId || !project) {
    const fallback = projects.find((entry) => entry.environmentId === primary?.environmentId);
    return fallback ? (
      <SidebarWorkflowSlots environmentId={fallback.environmentId} projectId={fallback.id} />
    ) : null;
  }
  return (
    <WorkflowControls
      key={`${project.environmentId}:${project.id}`}
      environmentId={project.environmentId}
      projectId={project.id}
      threadId={threadId}
      modelSelection={
        (composer?.activeProvider
          ? composer.modelSelectionByProvider[composer.activeProvider]
          : null) ?? activeThread?.modelSelection
      }
      runtimeMode={composer?.runtimeMode ?? thread.runtimeMode}
      keybindings={keybindings}
    />
  );
}

function SidebarWorkflowSlots(props: { environmentId: EnvironmentId; projectId: ProjectId }) {
  const live = useEnvironmentQuery(
    serverEnvironment.workflowLive({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  return (
    <SidebarMenuItem>
      <WorkflowSlots environmentId={props.environmentId} slots={live.data?.implementationSlots} />
    </SidebarMenuItem>
  );
}

function WorkflowControls(
  input: Omit<Props, "modelSelection"> & { modelSelection: ModelSelection | undefined },
) {
  const environmentSettings = useEnvironmentSettings(input.environmentId);
  const project = useProject(scopeProjectRef(input.environmentId, input.projectId));
  const defaults = resolveProjectSettings(
    environmentSettings,
    input.projectId,
    project ?? undefined,
  ).settings;
  const props = {
    ...input,
    modelSelection: input.modelSelection ??
      defaults.defaultModelSelection ?? {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      },
  };
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const live = useEnvironmentQuery(
    serverEnvironment.workflowLive({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  const canIntake = useAtomValue(
    serverEnvironment.intakeWorkflow.permissionAtom(props.environmentId),
  );
  const intake = useAtomCommand(serverEnvironment.intakeWorkflow);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile, setOpen: setSidebarOpen } = useSidebar();
  const modifiers = useShortcutModifierState();
  const queue = live.data?.runs.filter((run) => run.phase === "review") ?? [];
  const configured = live.data?.connected && live.data.configuration !== null;
  async function openRun(run: WorkflowRun) {
    const threadId = run.phase === "implementing" ? run.implementationThreadId : run.threadId;
    if (!threadId) return;
    if (run.phase === "review")
      useRightPanelStore
        .getState()
        .openTicket(scopeThreadRef(props.environmentId, threadId), run.id, props.projectId);
    setOpen(false);
    if (isMobile) setOpenMobile(false);
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: props.environmentId, threadId },
    });
  }
  const openIntake = () => {
    if (isMobile) setOpenMobile(true);
    else setSidebarOpen(true);
    setOpen(true);
  };
  const refine = () => {
    const run = queue.find((entry) => entry.threadId === props.threadId) ?? queue[0];
    if (run) void openRun(run);
    else openIntake();
  };
  useEffect(() => {
    const handleAction = () => {
      if (!live.data) return;
      const action = takeWorkflowAction();
      if (action === "ticket") openIntake();
      else if (action === "refine") refine();
    };
    window.addEventListener(WORKFLOW_ACTION_EVENT, handleAction);
    handleAction();
    return () => {
      window.removeEventListener(WORKFLOW_ACTION_EVENT, handleAction);
    };
  });
  async function submit() {
    if (busy || !canIntake || !text.trim() || !configured) return;
    setBusy(true);
    const id = requestId ?? randomUUID();
    setRequestId(id);
    const result = await intake({
      environmentId: props.environmentId,
      input: { projectId: props.projectId, requestId: id, text: text.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") {
      setText("");
      setRequestId(null);
      setOpen(false);
    }
  }
  const showShortcuts = modifiers.metaKey || modifiers.ctrlKey;
  const ticketShortcut = shortcutLabelForCommand(props.keybindings, "workflow.ticket");
  const refineShortcut = shortcutLabelForCommand(props.keybindings, "workflow.refine");
  const refineLabel = `Refine ${queue.length} ${queue.length === 1 ? "ticket" : "tickets"}`;
  return (
    <SidebarMenuItem className="flex shrink-0 items-center">
      <span aria-hidden="true" className="mr-2 ml-1 h-3.5 w-px bg-sidebar-border" />
      {showShortcuts && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-full z-50 mb-2 space-y-1 whitespace-nowrap rounded-md border border-sidebar-border bg-sidebar p-2 text-xs text-sidebar-foreground shadow-sm"
        >
          <div className="flex items-center justify-between gap-4">
            <span>+ Ticket</span>
            <Kbd>{ticketShortcut}</Kbd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Refine</span>
            <Kbd>{refineShortcut}</Kbd>
          </div>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip open={showShortcuts || open ? false : undefined}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    className="mr-1"
                    aria-label="Add ticket"
                    data-workflow-action="ticket"
                  />
                }
              />
            }
          >
            <TicketPlusIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <span className="flex items-center gap-2">
              + Ticket <Kbd>{ticketShortcut}</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="start" width="auto">
          <div className="w-80 max-w-full space-y-3 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Add a ticket</h2>
              <Button size="xs" variant="ghost" onClick={() => setSettings(!settings)}>
                {settings ? "Back" : "Workflow settings"}
              </Button>
            </div>
            {!configured || settings ? (
              <WorkflowSetup
                {...props}
                configuration={live.data?.configuration ?? null}
                onSaved={() => {
                  live.refresh();
                  setSettings(false);
                }}
              />
            ) : (
              <>
                <label className="block text-xs text-muted-foreground">
                  What should we work on?
                  <Textarea
                    aria-label="Ticket request"
                    value={text}
                    maxLength={20_000}
                    disabled={busy || !canIntake}
                    onChange={(event) => {
                      setText(event.target.value);
                      setRequestId(null);
                    }}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  An agent checks existing work, prepares the ticket in Linear, and puts it in your
                  refinement queue.
                </p>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !canIntake || !text.trim()}
                    onClick={() => void submit()}
                  >
                    {busy ? "Adding…" : "Add ticket"}
                  </Button>
                </div>
              </>
            )}
            {live.error && (
              <p role="alert" className="text-xs text-destructive">
                {live.error}
              </p>
            )}
            {live.data?.runs.some(
              (run) => run.phase === "queued" || run.phase === "preparing" || run.error !== null,
            ) && (
              <details className="border-t pt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Workflow activity
                </summary>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {live.data.runs
                    .filter(
                      (run) =>
                        run.phase === "queued" || run.phase === "preparing" || run.error !== null,
                    )
                    .map((run) => (
                      <div key={run.id}>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!run.threadId}
                          onClick={() => void openRun(run)}
                        >
                          {run.title}
                        </Button>
                        <p className="text-muted-foreground">{run.error ?? run.phase}</p>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        </PopoverPopup>
      </Popover>
      <div className="relative">
        <Tooltip open={showShortcuts ? false : undefined}>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                size="icon"
                onClick={refine}
                aria-label={refineLabel}
                data-workflow-action="refine"
              />
            }
          >
            <ListFilterIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <span className="flex items-center gap-2">
              {refineLabel} <Kbd>{refineShortcut}</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>
        {queue.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sidebar-control-surface px-0.5 text-3xs font-medium text-sidebar-foreground tabular-nums"
          >
            {queue.length > 99 ? "99+" : queue.length}
          </span>
        )}
      </div>
      <WorkflowSlots environmentId={props.environmentId} slots={live.data?.implementationSlots} />
    </SidebarMenuItem>
  );
}

function WorkflowSlots({
  environmentId,
  slots,
}: {
  environmentId: EnvironmentId;
  slots: WorkflowListResult["implementationSlots"] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const canSave = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const save = useAtomCommand(serverEnvironment.updateSettings);
  const value = Number(limit);
  const valid = limit.trim() !== "" && Number.isSafeInteger(value) && value >= 0;
  const label = slots
    ? `Ticket slots: ${slots.used} of ${slots.limit} in use`
    : "Loading ticket slots";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setLimit(String(slots?.limit ?? 8));
        setOpen(next);
      }}
    >
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger
          render={
            <PopoverTrigger render={<Button size="xs" variant="ghost" aria-label={label} />} />
          }
        >
          <span className="whitespace-nowrap text-(--sidebar-icon-color) tabular-nums">
            {slots ? `${slots.used} / ${slots.limit}` : "…"}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="end" width="auto">
        <form
          className="w-64 space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy || !canSave) return;
            setBusy(true);
            void save({
              environmentId,
              input: { patch: { ticketImplementationSlots: value } },
            }).then((result) => {
              setBusy(false);
              if (result._tag === "Success") setOpen(false);
            });
          }}
        >
          <h2 className="text-sm font-medium">Ticket implementation slots</h2>
          <p className="text-xs text-muted-foreground">
            {slots?.used ?? "…"} in use across all projects. Your own chats and other automations do
            not count.
          </p>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Maximum active tickets</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={limit}
              disabled={busy || !canSave}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Set 0 to pause new starts. Existing chats can always resume.
          </p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!valid || busy || !canSave}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
}

export function WorkflowSetup(
  props: Props & { configuration: WorkflowConfiguration | null; onSaved: () => void },
) {
  const connection = useEnvironmentQuery(
    serverEnvironment.workflowConnection({ environmentId: props.environmentId, input: {} }),
  );
  const connect = useAtomCommand(serverEnvironment.connectWorkflow);
  const disconnect = useAtomCommand(serverEnvironment.disconnectWorkflow);
  const canConnect = useAtomValue(
    serverEnvironment.connectWorkflow.permissionAtom(props.environmentId),
  );
  const [apiKey, setApiKey] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyId = useId();
  if (!connection.data?.connected)
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!apiKey.trim() || busy || !canConnect) return;
          setBusy(true);
          setConnectError(null);
          void connect({
            environmentId: props.environmentId,
            input: { apiKey: apiKey.trim() },
          }).then((result) => {
            setBusy(false);
            if (result._tag === "Success") {
              setApiKey("");
              connection.refresh();
              props.onSaved();
            } else {
              const error = squashAtomCommandFailure(result);
              setConnectError(
                error instanceof Error ? error.message : "Could not connect to Linear.",
              );
            }
          });
        }}
      >
        <p className="text-xs text-muted-foreground">
          Connect Linear to this environment. The key stays in its secret store.
        </p>
        <label htmlFor={keyId} className="text-xs">
          Linear API key
        </label>
        <Input
          id={keyId}
          type="password"
          autoComplete="off"
          value={apiKey}
          disabled={busy || !canConnect}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <Button size="sm" type="submit" disabled={busy || !canConnect || !apiKey.trim()}>
          {busy ? "Connecting…" : "Connect Linear"}
        </Button>
        {(connectError ?? connection.error) && (
          <p role="alert" className="text-xs text-destructive">
            {connectError ?? connection.error}
          </p>
        )}
      </form>
    );
  return (
    <>
      <ConfigurationForm
        key={props.configuration?.linearTeamId ?? "new"}
        {...props}
        connection={connection.data}
      />
      <Button
        size="xs"
        variant="ghost"
        disabled={!canConnect || busy}
        onClick={() => {
          setBusy(true);
          void disconnect({ environmentId: props.environmentId, input: {} }).then(() => {
            setBusy(false);
            connection.refresh();
            props.onSaved();
          });
        }}
      >
        Disconnect Linear
      </Button>
    </>
  );
}
function ConfigurationForm(
  props: Props & {
    configuration: WorkflowConfiguration | null;
    connection: WorkflowConnection;
    onSaved: () => void;
  },
) {
  const [teamId, setTeamId] = useState(
    props.configuration?.linearTeamId ?? props.connection.teams[0]?.id ?? "",
  );
  const [projectId, setProjectId] = useState(props.configuration?.intakeProjectId ?? "");
  const [baseBranch, setBaseBranch] = useState(props.configuration?.baseBranch ?? "main");
  const [performanceEnabled, setPerformanceEnabled] = useState(
    props.configuration?.performanceEnabled ?? false,
  );
  const [refactorEnabled, setRefactorEnabled] = useState(
    props.configuration?.refactorEnabled ?? false,
  );
  const [busy, setBusy] = useState(false);
  const canConfigure = useAtomValue(
    serverEnvironment.configureWorkflow.permissionAtom(props.environmentId),
  );
  const configure = useAtomCommand(serverEnvironment.configureWorkflow);
  const team = props.connection.teams.find((entry) => entry.id === teamId);
  return (
    <form
      className="space-y-3 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !canConfigure || !teamId) return;
        setBusy(true);
        void configure({
          environmentId: props.environmentId,
          input: {
            projectId: props.projectId,
            linearTeamId: teamId,
            intakeProjectId: projectId || null,
            baseBranch,
            modelSelection: props.modelSelection,
            runtimeMode: props.runtimeMode,
            performanceEnabled,
            refactorEnabled,
          },
        }).then((result) => {
          setBusy(false);
          if (result._tag === "Success") props.onSaved();
        });
      }}
    >
      <p className="text-muted-foreground">
        Choose where incoming tickets wait. Each approved ticket can target another project.
      </p>
      <div className="space-y-1">
        <span>Linear team</span>
        <Select
          value={teamId}
          onValueChange={(value) => {
            setTeamId(value ?? "");
            setProjectId("");
          }}
        >
          <SelectTrigger size="sm" aria-label="Linear team">
            <SelectValue>
              {(value: string) =>
                props.connection.teams.find((entry) => entry.id === value)?.name ?? "Choose team"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.connection.teams.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="space-y-1">
        <span>Intake project</span>
        <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
          <SelectTrigger size="sm" aria-label="Intake project">
            <SelectValue>
              {(value: string) =>
                props.connection.projects.find((entry) => entry.id === value)?.name ?? "No project"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">No project</SelectItem>
            {props.connection.projects
              .filter((entry) => entry.teamIds.includes(teamId))
              .map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
          </SelectPopup>
        </Select>
      </div>
      <label className="block space-y-1">
        <span>Implementation base branch</span>
        <Input
          size="sm"
          value={baseBranch}
          onChange={(event) => setBaseBranch(event.target.value)}
          required
        />
      </label>
      <fieldset className="space-y-2 border-t pt-3">
        <legend className="pt-2 font-medium">Daily scanners</legend>
        <p className="text-muted-foreground">
          07:00 Amsterdam time. A missed run starts once when this environment wakes. Every run
          opens a fresh chat.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={performanceEnabled}
            onChange={(event) => setPerformanceEnabled(event.target.checked)}
          />
          Performance
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={refactorEnabled}
            onChange={(event) => setRefactorEnabled(event.target.checked)}
          />
          Refactor
        </label>
      </fieldset>
      {team && (!team.refinedStateId || !team.canceledStateId) && (
        <p role="status" className="text-muted-foreground">
          This team needs Refined and Canceled states before review decisions can finish.
        </p>
      )}
      <Button size="sm" type="submit" disabled={busy || !canConfigure || !teamId}>
        {busy ? "Saving…" : "Save workflow"}
      </Button>
    </form>
  );
}
