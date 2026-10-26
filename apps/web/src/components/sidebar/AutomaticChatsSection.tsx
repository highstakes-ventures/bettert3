import { Link, useParams } from "@tanstack/react-router";
import type { CloudChatSummary } from "@t3tools/contracts";
import {
  CheckCheckIcon,
  CircleHelpIcon,
  ClockIcon,
  CloudIcon,
  PlusIcon,
  WebhookIcon,
  WorkflowIcon,
} from "lucide-react";
import { useLayoutEffect, useState, type ComponentProps } from "react";
import * as DateTime from "effect/DateTime";
import { deriveSubagentElapsedMs } from "@t3tools/shared/orchestrationTiming";
import { cloudChatVisitKey, isUnopenedAutomaticChat } from "../../lib/cloudChatVisits";
import { cn } from "../../lib/utils";
import { deriveProjectIdentity } from "../../projectIdentity";
import { useThreadShells } from "../../state/entities";
import { cloudChats } from "../../state/cloudChats";
import { useEnvironmentMachines, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { ThreadShell } from "../../types";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectMonogram } from "../ProjectMonogram";
import { executionLocationLabel, ThreadExecutionIcon } from "../ThreadExecutionIcon";
import { AgentElapsed } from "../chat/AgentElapsed";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const AUTOMATIC_INITIAL_COUNT = 10;
const AUTOMATIC_PAGE_COUNT = 25;

type RunTiming = ComponentProps<typeof AgentElapsed>["agent"];

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
  const turn = chat.latestTurn;
  const running = chat.status === "active";
  return turn?.startedAt != null && (running || turn.completedAt != null)
    ? {
        status: running ? "running" : "completed",
        startedAt: new Date(turn.startedAt * 1000).toISOString(),
        completedAt:
          turn.completedAt != null ? new Date(turn.completedAt * 1000).toISOString() : null,
      }
    : null;
}

function AutomaticRunDuration({ elapsed }: { elapsed: RunTiming | null }) {
  if (!elapsed || elapsed.startedAt === null || deriveSubagentElapsedMs(elapsed, 0) === null)
    return null;
  const durationLabel = elapsed.status === "running" ? "Current run duration" : "Last run duration";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={durationLabel}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-secondary-label"
          />
        }
      >
        <ClockIcon aria-hidden className="size-3" />
        <AgentElapsed agent={elapsed} compact />
      </TooltipTrigger>
      <TooltipPopup>
        {durationLabel} · Started {new Date(elapsed.startedAt).toLocaleString()}
        {elapsed.completedAt ? ` · Finished ${new Date(elapsed.completedAt).toLocaleString()}` : ""}
      </TooltipPopup>
    </Tooltip>
  );
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
  const running = ["preparing", "starting", "running", "waiting"].includes(
    source.activityRunStatus ?? source.status ?? thread.runtime?.status ?? "",
  );
  const startedAt = running
    ? (source.activityRunStartedAt ?? source.latestRunStartedAt)
    : source.latestRunStartedAt;
  // Imported run timestamps may contain ordering fallbacks. The Cloud summary
  // preserves the actual timing, including unknown values. T3-created runs own theirs.
  const importedRun = source.latestRunId?.startsWith(`cloud-run:${thread.id}:`) === true;
  const elapsed: RunTiming | null =
    !hasNativeRun || importedRun
      ? cloudChat
        ? cloudRunTiming(cloudChat)
        : null
      : startedAt == null
        ? null
        : {
            status: running ? "running" : "completed",
            startedAt: DateTime.formatIso(startedAt),
            completedAt:
              !running && source.latestRunCompletedAt != null
                ? DateTime.formatIso(source.latestRunCompletedAt)
                : null,
          };
  // Cloud history proves execution there when an import has no attached native runtime yet.
  const importedCloud =
    !hasNativeRun && source.executionDestination === undefined && cloudChat !== undefined;
  const location = importedCloud
    ? "Codex Cloud"
    : executionLocationLabel(source.executionDestination);
  return (
    <li className="list-none">
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
        className={cn(
          "group/sidebar-row flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <AutomaticOriginIcon
          origin={
            source.automationOrigin !== undefined
              ? source.automationOrigin
              : source.runDestination?.origin === "automatic"
                ? "external"
                : undefined
          }
        />
        <span className={cn("min-w-0 flex-1 truncate", unopened && "font-medium")}>
          {thread.title}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={location}
                className="inline-flex shrink-0 items-center text-secondary-label"
              />
            }
          >
            {importedCloud ? (
              <CloudIcon aria-hidden className="size-3.5" />
            ) : (
              <ThreadExecutionIcon
                destination={source.executionDestination}
                machine={machine}
                aria-hidden
                className="size-3.5"
              />
            )}
          </TooltipTrigger>
          <TooltipPopup>{location}</TooltipPopup>
        </Tooltip>
        <AutomaticRunDuration elapsed={elapsed} />
        {unopened ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className="shrink-0 text-xs text-secondary-label">{status}</span>
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
  const identity = repositoryName ? deriveProjectIdentity(repositoryName) : null;
  const updatedAt = new Date(chat.updatedAt * 1000).toISOString();
  const relativeTime = formatRelativeTimeLabel(updatedAt);
  const timeLabel = relativeTime === "just now" ? "now" : relativeTime.replace(/ ago$/, "");
  return (
    <li className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]">
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
        className={cn(
          "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          !unopened && !running && "[&:not(:hover):not(:focus-within)_*]:text-secondary-label/70",
          active
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : unopened
              ? "text-sidebar-foreground hover:bg-sidebar-row-hover"
              : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <span className="flex shrink-0 items-center opacity-40 grayscale transition-opacity group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0">
          {identity ? (
            <ProjectMonogram text={identity.monogram} color={identity.color} />
          ) : (
            <CloudIcon aria-hidden className="size-4" />
          )}
        </span>
        {repositoryName ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex min-w-0 max-w-24 shrink items-center gap-1 text-xs text-secondary-label" />
              }
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">{repositoryName}</span>
            </TooltipTrigger>
            <TooltipPopup>{chat.repository}</TooltipPopup>
          </Tooltip>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
            unopened && "font-medium",
          )}
        >
          {chat.title}
        </span>
        <AutomaticOriginIcon origin="external" />
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label="Codex Cloud"
                className="inline-flex shrink-0 items-center text-secondary-label"
              />
            }
          >
            <CloudIcon aria-hidden className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>Codex Cloud</TooltipPopup>
        </Tooltip>
        <AutomaticRunDuration elapsed={elapsed} />
        {unopened ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className="ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end text-xs tabular-nums text-secondary-label">
          {running ? (
            "Running"
          ) : (
            <Tooltip>
              <TooltipTrigger render={<time dateTime={updatedAt} />}>{timeLabel}</TooltipTrigger>
              <TooltipPopup>{new Date(updatedAt).toLocaleString()}</TooltipPopup>
            </Tooltip>
          )}
        </span>
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
  const localTasks = localQuery.data?.tasks ?? [];
  const localRows = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.archivedAt === null &&
        thread.source.ticketWorkflowId === undefined &&
        (thread.source.automationOrigin !== undefined ||
          thread.source.backgroundWorkflowId !== undefined ||
          thread.source.runDestination?.origin === "automatic" ||
          thread.source.scheduledTaskId !== undefined ||
          localTasks.some((task) => task.threadId === thread.id)),
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
  const running = rows.filter((chat) => chat.status === "active").length;
  const activityIncomplete = data?.hasMore || rows.some((chat) => chat.status === "unknown");
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
  const unopened = rows.filter(isUnopened).length;
  const markAllRead = () => {
    if (!expanded || !environmentId || !data || query.error) return;
    const visitedAt = new Date().toISOString();
    for (const chat of rows.filter(isUnopened)) {
      markThreadVisited(cloudChatVisitKey(environmentId, data.accountId, chat.id), visitedAt);
    }
  };
  const layoutKey = expanded
    ? `${query.error ?? ""}:${data !== null}:${visibleRows.map((chat) => chat.id).join(":")}:${visibleLocalRows.map((thread) => thread.id).join(":")}`
    : "collapsed";
  useLayoutEffect(() => {
    void layoutKey;
    onLayoutChange();
  }, [layoutKey, onLayoutChange]);
  if (!environmentId) return null;
  return (
    <>
      <li className="mx-0.5 h-8 list-none" data-testid="sidebar-automatic-header">
        <CollapsibleSectionHeader
          expanded={expanded}
          tone={unopened > 0 && !query.error ? "accent" : "muted"}
          onClick={onToggle}
          accessory={
            <span
              className="inline-flex items-center gap-1 text-xs tabular-nums"
              aria-live="polite"
            >
              {query.error ? (
                "Couldn't refresh"
              ) : data ? (
                <>
                  <span>Cloud ·</span>
                  {data.hasMore ? <span>Recent ·</span> : null}
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
              ) : (
                "Loading…"
              )}
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
              cloudChat={
                thread.source.runDestination?.accountId === data?.accountId
                  ? rows.find((chat) => chat.id === thread.source.runDestination?.existingThreadId)
                  : undefined
              }
              accountId={data?.accountId}
              unopened={
                thread.source.runDestination?.accountId === data?.accountId &&
                rows.some(
                  (chat) =>
                    chat.id === thread.source.runDestination?.existingThreadId && isUnopened(chat),
                )
              }
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
