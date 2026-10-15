import { createFileRoute } from "@tanstack/react-router";
import { CloudIcon, ExternalLinkIcon, RefreshCwIcon, WorkflowIcon } from "lucide-react";
import { EnvironmentId, MessageId, type CloudChatListResult } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { MessagesTimeline } from "../components/chat/MessagesTimeline";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { cloudChatVisitKey } from "../lib/cloudChatVisits";
import type { TimelineEntry } from "../session-logic";
import { cloudChats } from "../state/cloudChats";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../state/query";
import { useUiStateStore } from "../uiStateStore";

export const Route = createFileRoute("/_chat/cloud/$cloudEnvironmentId/$cloudThreadId")({
  component: CloudChatView,
});

const noAction = () => {};

function CloudChatView() {
  const { cloudEnvironmentId, cloudThreadId } = Route.useParams();
  const environmentId = EnvironmentId.make(cloudEnvironmentId);
  const list = useEnvironmentQuery(cloudChats.list({ environmentId, input: {} }));
  return (
    <CloudChatHistory
      key={`${cloudEnvironmentId}:${cloudThreadId}:${list.data?.accountId}`}
      environmentId={environmentId}
      threadId={cloudThreadId}
      list={list}
    />
  );
}

function CloudChatHistory({
  environmentId,
  threadId,
  list,
}: {
  environmentId: EnvironmentId;
  threadId: string;
  list: EnvironmentQueryView<typeof CloudChatListResult.Type>;
}) {
  const chat = list.error ? undefined : list.data?.chats.find((chat) => chat.id === threadId);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const query = (cursor?: string) =>
    list.data && !list.error
      ? cloudChats.read({
          environmentId,
          input: { threadId, accountId: list.data.accountId, ...(cursor ? { cursor } : {}) },
        })
      : null;
  const history = useEnvironmentQuery(query(cursor));
  const liveHistory = useEnvironmentQuery(cursor ? query() : null);
  const latestHistory = cursor ? liveHistory : history;
  const accountId = list.error ? undefined : list.data?.accountId;
  const visitKey = accountId ? cloudChatVisitKey(environmentId, accountId, threadId) : undefined;
  const visitedAt = useUiStateStore((state) =>
    visitKey ? state.threadLastVisitedAtById[visitKey] : undefined,
  );
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  useEffect(() => {
    if (!visitKey || visitedAt || !history.isSuccess || history.data?.threadId !== threadId) {
      return;
    }
    markThreadVisited(visitKey, new Date().toISOString());
  }, [history.data?.threadId, history.isSuccess, markThreadVisited, threadId, visitKey, visitedAt]);
  const latestTurn = latestHistory.data?.latestTurn;
  const refreshError = list.error ?? history.error ?? liveHistory.error;
  const isWorking =
    !list.error &&
    !latestHistory.error &&
    (latestTurn ? latestTurn.status === "inProgress" : chat?.status === "active");
  const activeTurnStartedAt =
    latestTurn?.startedAt != null ? new Date(latestTurn.startedAt * 1000).toISOString() : null;
  const listRef = useRef<LegendListRef>(null);
  const { resolvedTheme } = useTheme();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const timelineEntries = useMemo<ReadonlyArray<TimelineEntry>>(
    () =>
      (list.error || history.error ? [] : (history.data?.messages ?? [])).map((message) => {
        const createdAt = new Date(
          (message.createdAt ?? chat?.createdAt ?? 0) * 1000,
        ).toISOString();
        return {
          id: message.id,
          kind: "message",
          createdAt,
          message: {
            id: MessageId.make(message.id),
            role: message.role,
            text: message.text,
            runId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        };
      }),
    [chat?.createdAt, history.data, history.error, list.error],
  );
  const automatic = chat?.origin === "automatic";
  const refresh = () => {
    list.refresh();
    history.refresh();
    if (cursor) liveHistory.refresh();
  };
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        {automatic ? (
          <WorkflowIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <CloudIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{chat?.title ?? "Cloud chat"}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {chat?.repository ?? "Codex"} · Remote
          </p>
        </div>
        {isWorking ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="sm" />
            Working
          </span>
        ) : null}
        {chat?.githubRunUrl ? (
          <a
            href={chat.githubRunUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            GitHub run
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Refresh conversation" onClick={refresh}>
          <RefreshCwIcon aria-hidden className="size-4" />
        </Button>
      </WorkspacePageHeader>
      {refreshError ? (
        <div role="alert" className="px-6 py-3 text-sm text-destructive">
          {refreshError}
          <Button variant="ghost" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      {history.isPending && !history.data ? (
        <p className="px-6 py-3 text-sm text-muted-foreground">Loading conversation…</p>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessagesTimeline
          isWorking={!cursor && isWorking}
          runlessWorkActive={!cursor && isWorking}
          activeTurnInProgress={!cursor && isWorking}
          activeTurnStartedAt={activeTurnStartedAt}
          listRef={listRef}
          timelineEntries={timelineEntries}
          latestRun={null}
          turnDiffSummaries={[]}
          routeThreadKey={`cloud/${environmentId}/${threadId}`}
          onOpenTurnDiff={noAction}
          onOpenThread={noAction}
          onForkFromRun={async () => {}}
          onRollbackCheckpoint={noAction}
          supportsConversationRollback={false}
          onRevertToTurnCount={noAction}
          isRevertingCheckpoint={false}
          onImageExpand={noAction}
          activeThreadEnvironmentId={environmentId}
          markdownCwd={undefined}
          resolvedTheme={resolvedTheme}
          timestampFormat={timestampFormat}
          workspaceRoot={undefined}
          providerStatuses={[]}
          runs={[]}
          anchorMessageId={null}
          onAnchorReady={noAction}
          onAnchorSizeChanged={noAction}
          contentInsetEndAdjustment={0}
          onIsAtEndChange={noAction}
          liveFollowEnabled={true}
          onManualNavigation={noAction}
          hideEmptyPlaceholder={history.isPending || !!history.error || !!list.error}
        />
      </div>
      {cursors.length > 1 || history.data?.nextCursor ? (
        <div className="flex justify-center gap-2 px-6 py-2">
          {history.data?.nextCursor ? (
            <Button
              variant="ghost"
              onClick={() =>
                setCursors((previous) => [...previous, history.data?.nextCursor ?? undefined])
              }
            >
              Older messages
            </Button>
          ) : null}
          {cursors.length > 1 ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setCursors((previous) => previous.slice(0, -1))}
              >
                Newer messages
              </Button>
              <Button variant="ghost" onClick={() => setCursors([undefined])}>
                Latest messages
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
