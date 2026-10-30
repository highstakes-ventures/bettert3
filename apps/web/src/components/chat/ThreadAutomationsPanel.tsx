import { useAtomValue } from "@effect/atom-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  CalendarOffIcon,
  CircleAlertIcon,
  PencilIcon,
  PlayIcon,
  Settings2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { cn } from "../../lib/utils";
import { ScheduledRelativeLabel, scheduleLabel } from "../settings/ScheduledTasksSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";

import { readEnvironmentScope } from "../../state/session";
import { Switch } from "../ui/switch";
import { Button, type ButtonSize } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";

const STATUS_DOT_CLASS: Record<ScheduledTask["lastRunStatus"], string> = {
  never: "bg-muted-foreground/40",
  running: "bg-sky-500",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
};

/** Keeps bound schedules reachable even when the thread details card is closed or compact. */
export function ThreadAutomationsIndicator({
  size = "icon-xs",
  ...props
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly size?: ButtonSize;
}) {
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const tasks = (tasksQuery.data?.tasks ?? []).filter((task) => task.threadId === props.threadId);
  if (tasks.length === 0 && tasksQuery.error === null) return null;

  const activeCount = tasks.filter((task) => task.enabled).length;
  const task = tasks.length === 1 ? tasks[0] : undefined;
  const label =
    tasksQuery.error !== null
      ? "Could not load thread automations"
      : task
        ? `${task.title} · ${scheduleLabel(task.schedule)}${
            !task.enabled
              ? " · paused"
              : task.nextRunAt !== null
                ? ` · next ${new Date(task.nextRunAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""
          }`
        : `${tasks.length} automations · ${activeCount} active`;
  const Icon =
    tasksQuery.error !== null
      ? CircleAlertIcon
      : activeCount > 0
        ? CalendarClockIcon
        : CalendarOffIcon;

  return (
    <span
      className="inline-flex shrink-0"
      data-thread-automations-indicator
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={<Button variant={activeCount > 0 ? "ghost" : "ghost-muted"} size={size} />}
                aria-label={`Show thread automations: ${label}`}
              />
            }
          >
            <Icon
              aria-hidden
              className={
                size === "icon-micro" ? "size-3.5 text-sidebar-muted-foreground/70" : undefined
              }
            />
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
        <PopoverPopup width="md" padding="none" align="end" aria-label="Thread automations">
          <ThreadAutomationsPanel {...props} />
        </PopoverPopup>
      </Popover>
    </span>
  );
}

function taskScheduleLine(task: ScheduledTask) {
  return (
    <>
      {scheduleLabel(task.schedule)}
      {task.enabled && task.nextRunAt !== null ? (
        <>
          {" · next "}
          <ScheduledRelativeLabel value={task.nextRunAt} />
        </>
      ) : task.enabled ? (
        ""
      ) : (
        " · paused"
      )}
    </>
  );
}

export function ThreadAutomationsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const headingId = useId();
  const canOperate = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(props.environmentId),
  );
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const setTaskEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "thread automation toggle",
  });
  const runTaskNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "thread automation run now",
  });
  const navigate = useNavigate();
  const environment = useEnvironment(props.environmentId);
  const mationOwned =
    environment?.serverConfig?.environment.capabilities.scheduledTaskOwner === "mation";
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const boundTasks = (tasksQuery.data?.tasks ?? []).filter(
    (task) => task.threadId === props.threadId,
  );

  if (tasksQuery.error === null && boundTasks.length === 0) return null;

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const toggleEnabled = async (task: ScheduledTask, enabled: boolean) => {
    if (
      busyTaskId !== null ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    setBusyTaskId(task.id);
    // Partial update: only the enabled flag changes, so a toggle can never
    // revert concurrent edits made to the task elsewhere.
    const result = await setTaskEnabled({
      environmentId: props.environmentId,
      input: { id: task.id, enabled },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not update automation", squashAtomCommandFailure(result));
    }
  };

  const runNow = async (task: ScheduledTask) => {
    if (
      busyTaskId !== null ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    setBusyTaskId(task.id);
    const result = await runTaskNow({
      environmentId: props.environmentId,
      input: { id: task.id },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not run automation", squashAtomCommandFailure(result));
    }
  };

  return (
    <ThreadDetailsSection
      headingId={headingId}
      title="Automations"
      data-thread-automations-panel
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label="Manage scheduled tasks"
                onClick={() =>
                  void navigate({
                    to: "/settings/scheduled-tasks",
                    search: { environmentId: props.environmentId },
                  })
                }
              >
                <Settings2Icon className="size-3.5" />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>Manage scheduled tasks</TooltipPopup>
        </Tooltip>
      }
    >
      {tasksQuery.error !== null ? (
        <p className="px-2.5 py-1.5 text-2xs text-destructive">
          Could not load automations: {tasksQuery.error}
        </p>
      ) : null}

      <ul className="m-0 list-none p-0">
        {boundTasks.map((task) => (
          <li
            key={task.id}
            className={cn(
              "group flex items-center rounded-lg py-1.5",
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
            )}
          >
            <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
              <CalendarClockIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span
                className={cn(
                  "absolute -right-1 -top-1 size-1.5 rounded-full",
                  STATUS_DOT_CLASS[task.lastRunStatus],
                )}
                aria-hidden
              />
            </span>
            <Tooltip>
              <TooltipTrigger render={<div className="min-w-0 flex-1" />}>
                <span className="block truncate text-sm font-medium text-foreground/80">
                  {task.title}
                </span>
                <p className="truncate text-2xs text-muted-foreground">{taskScheduleLine(task)}</p>
              </TooltipTrigger>
              <TooltipPopup side="left">
                <p className="font-medium">{task.title}</p>
                <p className="text-muted-foreground">{taskScheduleLine(task)}</p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label={`Edit ${task.title}`}
                    disabled={mationOwned || task.schedule.type === "once"}
                    onClick={() =>
                      void navigate({
                        to: "/settings/scheduled-tasks",
                        search: { environmentId: props.environmentId, taskId: task.id },
                      })
                    }
                  >
                    <PencilIcon className="size-3.5" />
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup>Edit automation</TooltipPopup>
            </Tooltip>
            {/* A webhook task runs from its URL; there is no request to run it with. */}
            {task.schedule.type === "webhook" || task.schedule.type === "once" ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      size="icon-xs"
                      variant="ghost"
                      part="icon"
                      aria-label={`Run ${task.title} now`}
                      disabled={
                        mationOwned ||
                        !canOperate ||
                        busyTaskId !== null ||
                        task.lastRunStatus === "running"
                      }
                      onClick={() => void runNow(task)}
                    >
                      <PlayIcon className="size-3.5" />
                    </ThreadDetailsControl>
                  }
                />
                <TooltipPopup>Run now</TooltipPopup>
              </Tooltip>
            )}
            <Switch
              checked={task.enabled}
              disabled={
                mationOwned || task.schedule.type === "once" || !canOperate || busyTaskId !== null
              }
              aria-label={task.enabled ? `Pause ${task.title}` : `Resume ${task.title}`}
              onCheckedChange={(enabled) => void toggleEnabled(task, enabled)}
            />
          </li>
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
