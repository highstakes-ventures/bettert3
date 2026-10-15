import { useAtom } from "@effect/atom-react";
import { Link, useParams } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  WorkflowIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
import type { CloudChatSummary } from "@t3tools/contracts";
import { cloudChats, cloudChatPeriodAtom } from "../../state/cloudChats";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "../../lib/utils";

function CloudChatRow({ chat, environmentId }: { chat: CloudChatSummary; environmentId: string }) {
  const params = useParams({ strict: false });
  const active = "cloudThreadId" in params && params.cloudThreadId === chat.id;
  const age = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    chat.createdAt * 1000,
  );
  return (
    <li className="list-none">
      <Link
        to="/cloud/$cloudEnvironmentId/$cloudThreadId"
        params={{ cloudEnvironmentId: environmentId, cloudThreadId: chat.id }}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={cn(
          "group flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active && "bg-sidebar-row-active",
        )}
      >
        {chat.origin === "automatic" ? (
          <WorkflowIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        ) : (
          <CloudIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{chat.title}</span>
          {chat.origin === "automatic" ? (
            <span className="block truncate text-xs text-sidebar-muted-foreground">
              {chat.repository ?? "Automatic kickoff"}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
          {chat.status === "active" ? "Running" : age}
        </span>
      </Link>
    </li>
  );
}

export function CloudChatsSection({ automatic = false }: { automatic?: boolean }) {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId ? cloudChats.list({ environmentId, input: {} }) : null,
  );
  const [period, setPeriod] = useAtom(cloudChatPeriodAtom);
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [startedAt] = useState(Date.now);
  const cutoff = period === "week" ? (query.dataUpdatedAt || startedAt) / 1000 - 7 * 86400 : 0;
  const rows = (query.error ? [] : (query.data?.chats ?? [])).filter(
    (chat) =>
      chat.createdAt >= cutoff &&
      (automatic ? chat.origin === "automatic" : chat.origin === "user"),
  );
  const unknown = (query.error ? [] : (query.data?.chats ?? [])).filter(
    (chat) => chat.createdAt >= cutoff && chat.origin === "unknown",
  );
  const running = rows.filter((chat) => chat.status === "active").length;
  if (!environmentId) return null;
  return (
    <section
      aria-label={automatic ? "Automatic cloud kickoffs" : "Your cloud chats"}
      className={cn(automatic && "mt-4 border-t border-sidebar-border pt-2")}
    >
      {automatic ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex h-9 w-full cursor-pointer items-center gap-2 px-2.5 text-xs font-medium text-sidebar-muted-foreground hover:text-sidebar-foreground"
        >
          {expanded ? (
            <ChevronDownIcon aria-hidden className="size-3" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3" />
          )}
          <span>Automatic</span>
          {query.isSuccess ? <span className="tabular-nums">{rows.length}</span> : null}
          {running > 0 ? <span className="ml-auto text-success">{running} running</span> : null}
        </button>
      ) : (
        <div className="flex h-8 items-center justify-between gap-2 px-2.5 text-xs text-sidebar-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CloudIcon aria-hidden className="size-3" />
            Cloud
          </span>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="cloud-chat-period">
              Cloud chat creation date
            </label>
            <select
              id="cloud-chat-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value === "all" ? "all" : "week")}
              className="cursor-pointer bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <option value="week">Last 7 days</option>
              <option value="all">All recent</option>
            </select>
            <button
              type="button"
              aria-label="Refresh cloud chats"
              onClick={query.refresh}
              className="rounded p-1 hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <RefreshCwIcon aria-hidden className="size-3" />
            </button>
          </div>
        </div>
      )}
      {!automatic && query.isPending && !query.data ? (
        <p className="px-2.5 py-2 text-xs text-sidebar-muted-foreground">Loading cloud chats…</p>
      ) : null}
      {!automatic && query.error ? (
        <p role="alert" className="px-2.5 py-2 text-xs text-destructive">
          {query.error}
        </p>
      ) : null}
      {!automatic || expanded ? (
        <>
          <ul>
            {(showAll ? rows : rows.slice(0, automatic ? 4 : 6)).map((chat) => (
              <CloudChatRow key={chat.id} chat={chat} environmentId={environmentId} />
            ))}
          </ul>
          {rows.length > (automatic ? 4 : 6) ? (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="px-2.5 py-2 text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground"
            >
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          ) : null}
          {automatic && rows.length === 0 && query.data && !query.error ? (
            <p className="px-2.5 py-2 text-xs text-sidebar-muted-foreground">
              No automatic kickoffs in this period.
            </p>
          ) : null}
          {automatic && unknown.length > 0 ? (
            <details className="mt-2 text-xs text-sidebar-muted-foreground">
              <summary className="cursor-pointer px-2.5 py-2">
                Unknown origin · {unknown.length}
              </summary>
              <ul>
                {unknown.map((chat) => (
                  <CloudChatRow key={chat.id} chat={chat} environmentId={environmentId} />
                ))}
              </ul>
            </details>
          ) : null}
          {automatic && query.data?.hasMore && !query.error ? (
            <p className="px-2.5 py-2 text-xs text-sidebar-muted-foreground">
              Showing the 100 most recent cloud chats.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
