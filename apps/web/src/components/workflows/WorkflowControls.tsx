import { randomUUID } from "~/lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { useShortcutModifierState } from "~/shortcutModifierState";
import { useRightPanelStore } from "~/rightPanelStore";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WORKFLOW_ACTION_EVENT } from "./workflowActions";

type Props = {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  keybindings: ResolvedKeybindingsConfig;
};
export function WorkflowControls(props: Props) {
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
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: props.environmentId, threadId },
    });
  }
  const refine = () => {
    const run = queue.find((entry) => entry.threadId === props.threadId) ?? queue[0];
    if (run) void openRun(run);
    else setOpen(true);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const terminalFocus =
        event.target instanceof Element && event.target.closest(".xterm") !== null;
      const command = resolveShortcutCommand(event, props.keybindings, {
        context: { terminalFocus },
      });
      if (command !== "workflow.ticket" && command !== "workflow.refine") return;
      event.preventDefault();
      if (command === "workflow.ticket") setOpen(true);
      else refine();
    };
    const action = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail === "ticket") setOpen(true);
      else if (event.detail === "refine") refine();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener(WORKFLOW_ACTION_EVENT, action);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener(WORKFLOW_ACTION_EVENT, action);
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
  const hint = (command: "workflow.ticket" | "workflow.refine") =>
    modifiers.metaKey || modifiers.ctrlKey ? (
      <Kbd>{shortcutLabelForCommand(props.keybindings, command)}</Kbd>
    ) : null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button size="xs" variant="ghost" data-workflow-action="ticket" />}>
          + Ticket {hint("workflow.ticket")}
        </PopoverTrigger>
        <PopoverPopup side="top" align="end" width="auto">
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
      <Button
        size="xs"
        variant="ghost"
        onClick={refine}
        aria-label={`Refine ${queue.length} tickets`}
      >
        Refine · {queue.length} {hint("workflow.refine")}
      </Button>
    </div>
  );
}

function WorkflowSetup(
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
          void connect({
            environmentId: props.environmentId,
            input: { apiKey: apiKey.trim() },
          }).then((result) => {
            setApiKey("");
            setBusy(false);
            if (result._tag === "Success") {
              connection.refresh();
              props.onSaved();
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
        {connection.error && (
          <p role="alert" className="text-xs text-destructive">
            {connection.error}
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
