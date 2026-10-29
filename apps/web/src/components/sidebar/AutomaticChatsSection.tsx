import { Link, useParams } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CloudChatSummary } from "@t3tools/contracts";
import {
  CheckCheckIcon,
  CircleHelpIcon,
  ClockIcon,
  CloudIcon,
  FolderIcon,
  PlusIcon,
  WebhookIcon,
  WorkflowIcon,
} from "lucide-react";
import { useLayoutEffect, useState, type ComponentProps, type ReactNode } from "react";
import * as DateTime from "effect/DateTime";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { cloudChatVisitKey, isUnopenedAutomaticChat } from "../../lib/cloudChatVisits";
import { cn } from "../../lib/utils";
import { deriveProjectIdentity } from "../../projectIdentity";
import {
  readEnvironmentSupportsVisitedTracking,
  useProject,
  useThreadShells,
} from "../../state/entities";
import { cloudChats } from "../../state/cloudChats";
import { useEnvironmentMachines, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadShell } from "../../types";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectMonogram } from "../ProjectMonogram";
import { executionLocationLabel, ThreadExecutionIcon } from "../ThreadExecutionIcon";
import { AgentElapsed, formatCompactElapsedSeconds } from "../chat/AgentElapsed";
import {
  hasUnseenCompletion,
  isAutomaticSidebarThread,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const AUTOMATIC_INITIAL_COUNT = 10;
const AUTOMATIC_PAGE_COUNT = 25;

type RunTiming = { completedMs: number; activeStartedAt: string | null };

function AutomaticOriginIcon({ origin }: { origin: ThreadShell["source"]["automationOrigin"] }) {
  const label =
    origin === "t3"
      ? "Started by T3"
      : origin === "external"
        ? "Triggered externally"
        : "Origin unknown";
  const Icon =
    origin === "t3" ? WorkflowIcon : origin === "external" ? WebhookIcon : CircleHelpIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className="inline-flex shrink-0 items-center text-secondary-label"
          />
        }
      >
        <Icon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function cloudRunTiming(chat: CloudChatSummary): RunTiming | null {
  if (chat.completedRunDurationMs == null) return null;
  const running = chat.status === "active";
  const start = chat.latestTurn?.startedAt;
  if (running && start == null) return null;
  return {
    completedMs: chat.completedRunDurationMs,
    activeStartedAt: running && start != null ? new Date(start * 1000).toISOString() : null,
  };
}

function AutomaticRunDuration({ elapsed }: { elapsed: RunTiming | null }) {
  if (!elapsed) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label="Total task duration"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-secondary-label"
          />
        }
      >
        <ClockIcon aria-hidden className="size-3" />
        {elapsed.activeStartedAt ? (
          <AgentElapsed
            agent={{ status: "running", startedAt: elapsed.activeStartedAt, completedAt: null }}
            elapsedOffsetMs={elapsed.completedMs}
            compact
          />
        ) : (
          formatCompactElapsedSeconds(elapsed.completedMs / 1000)
        )}
      </TooltipTrigger>
      <TooltipPopup>
        Total task duration · {formatDuration(elapsed.completedMs)} completed
        {elapsed.activeStartedAt
          ? ` · Running since ${new Date(elapsed.activeStartedAt).toLocaleString()}`
          : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function automaticRowClassName(active: boolean, unopened: boolean, running: boolean) {
  return cn(
    "group/sidebar-row relative grid h-12 w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_0.875rem_0.875rem_2.75rem_1.5rem] grid-rows-2 items-center gap-x-1 overflow-hidden rounded-md px-2 py-1 text-left text-sm outline-none select-none [content-visibility:auto] [contain-intrinsic-size:auto_48px] @min-[24rem]/automatic-row:h-9 @min-[24rem]/automatic-row:grid-cols-[minmax(0,5rem)_minmax(0,1fr)_0.875rem_0.875rem_3.5rem_2rem] @min-[24rem]/automatic-row:grid-rows-1 @min-[24rem]/automatic-row:gap-x-2.5 @min-[24rem]/automatic-row:px-2.5 @min-[24rem]/automatic-row:py-0 @min-[24rem]/automatic-row:[contain-intrinsic-size:auto_36px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    !active &&
      !unopened &&
      !running &&
      "[&:not(:hover):not(:focus-within)_*]:text-secondary-label/70",
    active
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : unopened || running
        ? "text-sidebar-foreground hover:bg-sidebar-row-hover"
        : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
  );
}

function AutomaticRowContent({
  title,
  projectName,
  projectDescription = projectName,
  origin,
  executionIcon,
  location,
  elapsed,
  updatedAt,
  status,
  unopened,
}: {
  title: string;
  projectName: string | null;
  projectDescription?: string | null;
  origin: ThreadShell["source"]["automationOrigin"];
  executionIcon: ReactNode;
  location: string;
  elapsed: RunTiming | null;
  updatedAt: string;
  status: string;
  unopened: boolean;
}) {
  const identity = projectName ? deriveProjectIdentity(projectName) : null;
  const relativeTime = formatRelativeTimeLabel(updatedAt);
  const timeLabel = relativeTime === "just now" ? "now" : relativeTime.replace(/ ago$/, "");
  return (
    <>
      <span className="col-start-1 row-start-1 contents min-w-0 items-center gap-1.5 @min-[24rem]/automatic-row:flex">
        <span className="col-start-1 row-start-1 flex shrink-0 items-center opacity-40 grayscale transition-opacity group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0">
          {identity ? (
            <ProjectMonogram text={identity.monogram} color={identity.color} />
          ) : (
            <FolderIcon aria-hidden className="size-4" />
          )}
        </span>
        <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-1 @min-[24rem]/automatic-row:contents">
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={status}
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    status === "Running" ? "bg-primary" : "bg-current",
                  )}
                />
              }
            />
            <TooltipPopup>{status}</TooltipPopup>
          </Tooltip>
          {projectName ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="min-w-0 truncate text-xs text-secondary-label" />}
              >
                {projectName}
              </TooltipTrigger>
              <TooltipPopup>{projectDescription}</TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      </span>
      <span className="col-start-2 col-end-7 row-start-1 flex min-w-0 items-center gap-1 @min-[24rem]/automatic-row:col-end-3">
        <span
          className={cn(
            "min-w-0 flex-1 truncate group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
            unopened && "font-medium",
          )}
        >
          {title}
        </span>
        {unopened ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : null}
      </span>
      <span className="col-start-3 row-start-2 flex items-center @min-[24rem]/automatic-row:row-start-1">
        <AutomaticOriginIcon origin={origin} />
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={location}
              className="col-start-4 row-start-2 inline-flex shrink-0 items-center text-secondary-label @min-[24rem]/automatic-row:row-start-1"
            />
          }
        >
          {executionIcon}
        </TooltipTrigger>
        <TooltipPopup>{location}</TooltipPopup>
      </Tooltip>
      <span className="col-start-5 row-start-2 flex min-w-0 justify-end tabular-nums @min-[24rem]/automatic-row:row-start-1">
        <AutomaticRunDuration elapsed={elapsed} />
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <time
              dateTime={updatedAt}
              className="col-start-6 row-start-2 text-right text-xs text-secondary-label tabular-nums @min-[24rem]/automatic-row:row-start-1"
            />
          }
        >
          {timeLabel}
        </TooltipTrigger>
        <TooltipPopup>
          {status} · {new Date(updatedAt).toLocaleString()}
        </TooltipPopup>
      </Tooltip>
    </>
  );
}

function localAutomaticState(
  thread: ThreadShell,
  enabled: boolean,
  bound: boolean,
  cloudChat: CloudChatSummary | undefined,
) {
  const source = thread.source;
  const threadStatus = resolveSidebarThreadStatus(thread, [{ threadId: thread.id, enabled }]);
  const hasNativeRun =
    source.latestRunId != null ||
    source.latestRunStartedAt != null ||
    source.activityRunStartedAt != null;
  const status =
    !hasNativeRun && cloudChat
      ? cloudChat.status === "active"
        ? "Running"
        : cloudChat.status === "unknown"
          ? "No status"
          : "Completed"
      : {
          approval: "Approval needed",
          input: "Input needed",
          working: "Running",
          failed: "Failed",
          limited: "Usage limit",
          waiting: "Waiting",
          ready: bound ? "Paused" : "Completed",
        }[threadStatus];
  return { hasNativeRun, status };
}

function LocalAutomaticRow({
  thread,
  enabled,
  bound,
  cloudChat,
  accountId,
  unopened,
  machine,
  onThreadOpen,
}: {
  thread: ThreadShell;
  enabled: boolean;
  bound: boolean;
  cloudChat: CloudChatSummary | undefined;
  accountId: string | undefined;
  unopened: boolean;
  machine: ComponentProps<typeof ThreadExecutionIcon>["machine"];
  onThreadOpen: (() => void) | undefined;
}) {
  const project = useProject({ environmentId: thread.environmentId, projectId: thread.projectId });
  const { setOpenMobile } = useSidebar();
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const params = useParams({ strict: false });
  const active =
    ("threadId" in params &&
      params.threadId === thread.id &&
      params.environmentId === thread.environmentId) ||
    ("cloudThreadId" in params &&
      params.cloudThreadId === cloudChat?.id &&
      params.cloudEnvironmentId === thread.environmentId);
  const source = thread.source;
  const { hasNativeRun, status } = localAutomaticState(thread, enabled, bound, cloudChat);
  // Imported timestamps may be ordering fallbacks; Cloud owns their measured timing.
  const importedRun = source.latestRunId?.startsWith(`cloud-run:${thread.id}:`) === true;
  const elapsed: RunTiming | null =
    !hasNativeRun || importedRun || source.completedRunDurationMs === null
      ? cloudChat
        ? cloudRunTiming(cloudChat)
        : null
      : source.completedRunDurationMs == null
        ? null
        : {
            completedMs: source.completedRunDurationMs,
            activeStartedAt:
              source.activityRunExecutionStartedAt == null
                ? null
                : DateTime.formatIso(source.activityRunExecutionStartedAt),
          };
  // Cloud history proves execution there when an import has no attached native runtime yet.
  const importedCloud =
    !hasNativeRun && source.executionDestination === undefined && cloudChat !== undefined;
  const location = importedCloud
    ? "Codex Cloud"
    : executionLocationLabel(source.executionDestination);
  return (
    <li className="@container/automatic-row list-none">
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        aria-current={active ? "page" : undefined}
        aria-label={`${thread.title}, ${status.toLowerCase()}${unopened ? ", new" : ""}`}
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
            onThreadOpen?.();
          setOpenMobile(false);
          if (cloudChat && accountId)
            markThreadVisited(
              cloudChatVisitKey(thread.environmentId, accountId, cloudChat.id),
              new Date().toISOString(),
            );
        }}
        className={automaticRowClassName(active, unopened, status === "Running")}
      >
        <AutomaticRowContent
          title={thread.title}
          projectName={project?.title ?? cloudChat?.repository?.split("/").at(-1) ?? null}
          projectDescription={project?.title ?? cloudChat?.repository ?? null}
          status={status}
          unopened={unopened}
          updatedAt={thread.updatedAt}
          elapsed={elapsed}
          origin={
            source.automationOrigin !== undefined
              ? source.automationOrigin
              : source.runDestination?.origin === "automatic"
                ? "external"
                : undefined
          }
          location={location}
          executionIcon={
            importedCloud ? (
              <CloudIcon aria-hidden className="size-3.5" />
            ) : (
              <ThreadExecutionIcon
                destination={source.executionDestination}
                machine={machine}
                aria-hidden
                className="size-3.5"
              />
            )
          }
        />
      </Link>
    </li>
  );
}

function AutomaticChatRow({
  chat,
  environmentId,
  accountId,
  unopened,
  normalThreadId,
  onThreadOpen,
}: {
  chat: CloudChatSummary;
  environmentId: string;
  accountId: string;
  unopened: boolean;
  normalThreadId: string | undefined;
  onThreadOpen: (() => void) | undefined;
}) {
  const params = useParams({ strict: false });
  const { setOpenMobile } = useSidebar();
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const active =
    ("cloudThreadId" in params &&
      params.cloudThreadId === chat.id &&
      params.cloudEnvironmentId === environmentId) ||
    ("threadId" in params &&
      params.threadId === normalThreadId &&
      params.environmentId === environmentId);
  const running = chat.status === "active";
  const elapsed = cloudRunTiming(chat);
  const repositoryName = chat.repository?.split("/").at(-1);
  const updatedAt = new Date(chat.updatedAt * 1000).toISOString();
  return (
    <li className="@container/automatic-row list-none">
      <Link
        {...(normalThreadId
          ? {
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: normalThreadId },
            }
          : {
              to: "/cloud/$cloudEnvironmentId/$cloudThreadId",
              params: { cloudEnvironmentId: environmentId, cloudThreadId: chat.id },
            })}
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            onThreadOpen?.();
          }
          setOpenMobile(false);
          if (normalThreadId)
            markThreadVisited(
              cloudChatVisitKey(environmentId, accountId, chat.id),
              new Date().toISOString(),
            );
        }}
        aria-current={active ? "page" : undefined}
        aria-label={`${chat.title}${chat.repository ? `, ${chat.repository}` : ""}${unopened ? ", new" : ""}${running ? ", running" : ""}`}
        className={automaticRowClassName(active, unopened, running)}
      >
        <AutomaticRowContent
          title={chat.title}
          projectName={repositoryName ?? null}
          projectDescription={chat.repository}
          origin="external"
          executionIcon={<CloudIcon aria-hidden className="size-3.5" />}
          location="Codex Cloud"
          elapsed={elapsed}
          updatedAt={updatedAt}
          status={running ? "Running" : chat.status === "unknown" ? "No status" : "Completed"}
          unopened={unopened}
        />
      </Link>
    </li>
  );
}

export function AutomaticChatsSection({
  expanded,
  onToggle,
  onLayoutChange,
  onThreadOpen,
}: {
  expanded: boolean;
  onToggle: () => void;
  onLayoutChange: () => void;
  onThreadOpen?: () => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const machines = useEnvironmentMachines();
  const params = useParams({ strict: false });
  const threads = useThreadShells();
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const query = useEnvironmentQuery(
    environmentId ? cloudChats.list({ environmentId, input: {} }) : null,
  );
  const localQuery = useEnvironmentQuery(
    environmentId ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  const visitThread = useAtomCommand(threadEnvironment.visit);
  const localTasks = localQuery.data?.tasks ?? [];
  const localRows = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.archivedAt === null &&
        isAutomaticSidebarThread(thread),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const data = query.data;
  const rows = (query.error ? [] : (data?.chats ?? []))
    .filter((chat) => chat.origin === "automatic")
    .toSorted(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") || b.updatedAt - a.updatedAt,
    );
  const localCloudIds = new Set(
    localRows.flatMap((thread) => {
      const destination = thread.source.runDestination;
      return destination?.accountId === data?.accountId && destination?.existingThreadId
        ? [destination.existingThreadId]
        : [];
    }),
  );
  const cloudOnlyRows = rows.filter((chat) => !localCloudIds.has(chat.id));
  const localCloudChat = (thread: ThreadShell) =>
    thread.source.runDestination?.accountId === data?.accountId
      ? rows.find((chat) => chat.id === thread.source.runDestination?.existingThreadId)
      : undefined;

  const [visibleCount, setVisibleCount] = useState(AUTOMATIC_INITIAL_COUNT);
  const resetKey = `${environmentId}:${query.data?.accountId ?? ""}`;
  const [previousResetKey, setPreviousResetKey] = useState(resetKey);
  if (previousResetKey !== resetKey) {
    setPreviousResetKey(resetKey);
    setVisibleCount(AUTOMATIC_INITIAL_COUNT);
  }
  const routeChatId =
    "cloudThreadId" in params && params.cloudEnvironmentId === environmentId
      ? params.cloudThreadId
      : "threadId" in params && params.environmentId === environmentId
        ? threads.find(
            (thread) =>
              thread.environmentId === environmentId &&
              thread.id === params.threadId &&
              thread.source.runDestination?.accountId === data?.accountId,
          )?.source.runDestination?.existingThreadId
        : undefined;
  const visibleRows = cloudOnlyRows.filter(
    (chat, index) => index < visibleCount || chat.id === routeChatId,
  );
  const visibleLocalRows = localRows.filter(
    (thread, index) =>
      index < visibleCount ||
      (routeChatId !== undefined &&
        thread.source.runDestination?.accountId === data?.accountId &&
        thread.source.runDestination?.existingThreadId === routeChatId) ||
      ("threadId" in params &&
        params.threadId === thread.id &&
        params.environmentId === environmentId),
  );
  const hiddenCount =
    cloudOnlyRows.length - visibleRows.length + localRows.length - visibleLocalRows.length;
  const localStatuses = localRows.map(
    (thread) =>
      localAutomaticState(
        thread,
        localTasks.some((task) => task.threadId === thread.id && task.enabled),
        localTasks.some((task) => task.threadId === thread.id),
        localCloudChat(thread),
      ).status,
  );
  const running =
    cloudOnlyRows.filter((chat) => chat.status === "active").length +
    localStatuses.filter((status) => status === "Running").length;
  const activityIncomplete =
    !data ||
    query.error ||
    data.hasMore ||
    cloudOnlyRows.some((chat) => chat.status === "unknown") ||
    localStatuses.includes("No status");
  const runningLabel = activityIncomplete
    ? running > 0
      ? `${running}+ running`
      : "No status"
    : `${running} running`;
  const runningDescription = activityIncomplete
    ? running > 0
      ? `At least ${running} running`
      : "Cloud activity couldn't be checked for every automatic chat."
    : runningLabel;
  const isUnopened = (chat: CloudChatSummary) =>
    !!environmentId &&
    !!data &&
    isUnopenedAutomaticChat(chat, environmentId, data.accountId, visits);
  const isLocalUnopened = (thread: ThreadShell) => {
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      visits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    );
    const destination = thread.source.runDestination;
    const cloudVisitedAt = destination?.existingThreadId
      ? visits[
          cloudChatVisitKey(
            thread.environmentId,
            destination.accountId,
            destination.existingThreadId,
          )
        ]
      : undefined;
    return (
      (lastVisitedAt === undefined &&
        (thread.lastVisitedAt !== undefined || cloudVisitedAt === undefined)) ||
      hasUnseenCompletion({ ...thread, lastVisitedAt })
    );
  };
  const unopenedLocalRows = localRows.filter(isLocalUnopened);
  const unopened = unopenedLocalRows.length + cloudOnlyRows.filter(isUnopened).length;
  const markAllRead = () => {
    if (!expanded || !environmentId) return;
    const visitedAt = new Date().toISOString();
    for (const thread of unopenedLocalRows) {
      if (readEnvironmentSupportsVisitedTracking(thread.environmentId)) {
        void visitThread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, visitedAt: thread.updatedAt },
        });
      } else {
        markThreadVisited(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          thread.updatedAt,
        );
      }
    }
    if (data) {
      for (const chat of rows.filter(isUnopened)) {
        markThreadVisited(cloudChatVisitKey(environmentId, data.accountId, chat.id), visitedAt);
      }
    }
  };
  const layoutKey = expanded
    ? `${query.error ?? ""}:${data !== null}:${visibleRows.map((chat) => chat.id).join(":")}:${visibleLocalRows.map((thread) => thread.id).join(":")}`
    : "collapsed";
  const layoutPass = { layoutKey, onLayoutChange };
  useLayoutEffect(() => {
    layoutPass.onLayoutChange();
  }, [layoutPass]);
  if (!environmentId) return null;
  return (
    <>
      <li className="mx-0.5 h-8 list-none" data-testid="sidebar-automatic-header">
        <CollapsibleSectionHeader
          expanded={expanded}
          tone={unopened > 0 ? "accent" : "muted"}
          onClick={onToggle}
          accessory={
            <span
              className="inline-flex items-center gap-1 text-xs tabular-nums"
              aria-live="polite"
            >
              <>
                {query.error ? (
                  <span>Couldn't refresh ·</span>
                ) : !data ? (
                  <span>Loading… ·</span>
                ) : null}
                {data?.hasMore ? <span>Recent ·</span> : null}
                {unopened > 0 && expanded ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={markAllRead}
                          aria-label="Mark all automatic chats as read"
                          className="group/mark-read pointer-events-auto -mx-1 grid cursor-pointer rounded-sm px-1 hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                        />
                      }
                    >
                      <span className="col-start-1 row-start-1 group-hover/mark-read:invisible group-focus-visible/mark-read:invisible">
                        {unopened} new
                      </span>
                      <CheckCheckIcon
                        aria-hidden
                        className="invisible col-start-1 row-start-1 size-4 self-center justify-self-center group-hover/mark-read:visible group-focus-visible/mark-read:visible"
                      />
                    </TooltipTrigger>
                    <TooltipPopup>Mark all as read</TooltipPopup>
                  </Tooltip>
                ) : (
                  <span>{unopened} new</span>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        aria-label={
                          activityIncomplete && running === 0
                            ? "Activity unavailable"
                            : runningDescription
                        }
                        className="pointer-events-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                      />
                    }
                  >
                    · {runningLabel}
                  </TooltipTrigger>
                  <TooltipPopup>{runningDescription}</TooltipPopup>
                </Tooltip>
              </>
            </span>
          }
        >
          Automatic
        </CollapsibleSectionHeader>
      </li>
      {expanded ? (
        <>
          {visibleLocalRows.map((thread) => (
            <LocalAutomaticRow
              key={thread.id}
              thread={thread}
              enabled={localTasks.some((task) => task.threadId === thread.id && task.enabled)}
              bound={localTasks.some((task) => task.threadId === thread.id)}
              cloudChat={localCloudChat(thread)}
              accountId={data?.accountId}
              unopened={isLocalUnopened(thread)}
              machine={machines.get(thread.environmentId) ?? "server"}
              onThreadOpen={onThreadOpen}
            />
          ))}
          {localQuery.error ? (
            <li
              role="alert"
              className="list-none px-2.5 py-2 text-xs text-sidebar-muted-foreground"
            >
              Local workflows couldn't refresh.
            </li>
          ) : null}
          {query.error ? (
            <li
              role="alert"
              className="list-none px-2.5 py-2 text-xs text-sidebar-muted-foreground"
            >
              {query.error}
            </li>
          ) : data ? (
            rows.length > 0 ? (
              visibleRows.map((chat) => (
                <AutomaticChatRow
                  key={chat.id}
                  chat={chat}
                  environmentId={environmentId}
                  accountId={data.accountId}
                  unopened={isUnopened(chat)}
                  onThreadOpen={onThreadOpen}
                  normalThreadId={
                    threads.find(
                      (thread) =>
                        thread.environmentId === environmentId &&
                        thread.source.runDestination?.accountId === data?.accountId &&
                        thread.source.runDestination?.existingThreadId === chat.id,
                    )?.id
                  }
                />
              ))
            ) : (
              <li className="list-none px-2.5 py-2 text-xs text-sidebar-muted-foreground">
                {localRows.length ? "No automatic Cloud chats yet." : "No automatic kickoffs yet."}
              </li>
            )
          ) : null}
          {hiddenCount > 0 ? (
            <li className="list-none">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + AUTOMATIC_PAGE_COUNT)}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <PlusIcon aria-hidden className="size-4 shrink-0" />
                Show more
              </button>
            </li>
          ) : null}
          {data?.hasMore && !query.error ? (
            <li className="list-none px-2.5 py-2 text-xs text-sidebar-muted-foreground">
              Counts and read actions cover automatic chats among the 100 most recent Cloud chats.
            </li>
          ) : null}
        </>
      ) : null}
    </>
  );
}
