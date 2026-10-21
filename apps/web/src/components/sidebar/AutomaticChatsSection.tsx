import { Link, useParams } from "@tanstack/react-router";
import type { CloudChatSummary } from "@t3tools/contracts";
import { CheckCheckIcon, CloudIcon, PlusIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { cloudChatVisitKey, isUnopenedAutomaticChat } from "../../lib/cloudChatVisits";
import { cn } from "../../lib/utils";
import { deriveProjectIdentity } from "../../projectIdentity";
import { useThreadShells } from "../../state/entities";
import { cloudChats } from "../../state/cloudChats";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectMonogram } from "../ProjectMonogram";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const AUTOMATIC_INITIAL_COUNT = 10;
const AUTOMATIC_PAGE_COUNT = 25;

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
  const params = useParams({ strict: false });
  const threads = useThreadShells();
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const query = useEnvironmentQuery(
    environmentId ? cloudChats.list({ environmentId, input: {} }) : null,
  );
  const data = query.data;
  const rows = (query.error ? [] : (data?.chats ?? []))
    .filter((chat) => chat.origin === "automatic")
    .toSorted(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") || b.updatedAt - a.updatedAt,
    );
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
  const visibleRows = rows.filter((chat, index) => index < visibleCount || chat.id === routeChatId);
  const hiddenCount = rows.length - visibleRows.length;
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
    ? `${query.error ?? ""}:${data !== null}:${visibleRows.map((chat) => chat.id).join(":")}`
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
                No automatic kickoffs yet.
              </li>
            )
          ) : null}
          {!query.error && hiddenCount > 0 ? (
            <li className="list-none">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + AUTOMATIC_PAGE_COUNT)}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <PlusIcon aria-hidden className="size-4 shrink-0" />
                Show {Math.min(hiddenCount, AUTOMATIC_PAGE_COUNT)} more
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
