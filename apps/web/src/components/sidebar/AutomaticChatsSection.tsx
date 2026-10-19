import { Link, useParams } from "@tanstack/react-router";
import type { CloudChatSummary } from "@t3tools/contracts";
import { CheckCheckIcon, WorkflowIcon } from "lucide-react";
import { useLayoutEffect } from "react";
import { cloudChatVisitKey, isUnopenedAutomaticChat } from "../../lib/cloudChatVisits";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { cloudChats } from "../../state/cloudChats";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useUiStateStore } from "../../uiStateStore";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function AutomaticChatRow({
  chat,
  environmentId,
  accountId,
  unopened,
  normalThreadId,
}: {
  chat: CloudChatSummary;
  environmentId: string;
  accountId: string;
  unopened: boolean;
  normalThreadId: string | undefined;
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
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    chat.updatedAt * 1000,
  );
  return (
    <li className="list-none">
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
        onClick={() => {
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
          "group/sidebar-row flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : unopened
              ? "text-sidebar-foreground hover:bg-sidebar-row-hover"
              : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <WorkflowIcon aria-hidden className="size-4 shrink-0 opacity-40" />
        <span className={cn("min-w-0 flex-1 truncate", unopened && "font-medium")}>
          {chat.title}
        </span>
        {unopened ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className="shrink-0 text-xs tabular-nums text-secondary-label">
          {running ? "Running" : date}
        </span>
      </Link>
    </li>
  );
}

export function AutomaticChatsSection({
  expanded,
  onToggle,
  onLayoutChange,
}: {
  expanded: boolean;
  onToggle: () => void;
  onLayoutChange: () => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
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
  const running = rows.filter((chat) => chat.status === "active").length;
  const activityUnavailable = rows.some((chat) => chat.status === "unknown");
  const runningLabel = activityUnavailable ? "No status" : `${running} running`;
  const runningDescription = activityUnavailable
    ? "Cloud activity couldn't be checked for every automatic chat."
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
    ? `${query.error ?? ""}:${data !== null}:${rows.map((chat) => chat.id).join(":")}`
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
                  {!data.hasMore ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            tabIndex={0}
                            aria-label={activityUnavailable ? "Activity unavailable" : runningLabel}
                            className="pointer-events-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                          />
                        }
                      >
                        · {runningLabel}
                      </TooltipTrigger>
                      <TooltipPopup>{runningDescription}</TooltipPopup>
                    </Tooltip>
                  ) : null}
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
              rows.map((chat) => (
                <AutomaticChatRow
                  key={chat.id}
                  chat={chat}
                  environmentId={environmentId}
                  accountId={data.accountId}
                  unopened={isUnopened(chat)}
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
