import { createFileRoute } from "@tanstack/react-router";
import { CloudIcon, ExternalLinkIcon, WorkflowIcon } from "lucide-react";
import { EnvironmentId, type CloudChatListResult } from "@t3tools/contracts";
import { useState } from "react";
import ChatMarkdown from "../components/ChatMarkdown";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { Button } from "../components/ui/button";
import { cloudChats } from "../state/cloudChats";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../state/query";

export const Route = createFileRoute("/_chat/cloud/$cloudEnvironmentId/$cloudThreadId")({
  component: CloudChatView,
});

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
  threadId: cloudThreadId,
  list,
}: {
  environmentId: EnvironmentId;
  threadId: string;
  list: EnvironmentQueryView<typeof CloudChatListResult.Type>;
}) {
  const chat = list.error ? undefined : list.data?.chats.find((chat) => chat.id === cloudThreadId);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const history = useEnvironmentQuery(
    list.data && !list.error
      ? cloudChats.read({
          environmentId,
          input: {
            threadId: cloudThreadId,
            accountId: list.data.accountId,
            ...(cursor ? { cursor } : {}),
          },
        })
      : null,
  );
  const automatic = chat?.origin === "automatic";
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
            {automatic
              ? `Automatic kickoff · ${chat?.repository ?? "Codex Cloud"}`
              : chat?.origin === "user"
                ? "Started by you · Codex Cloud"
                : "Origin unconfirmed · Codex Cloud"}
            {chat ? ` · ${chat.status === "active" ? "Running" : chat.status}` : ""}
          </p>
        </div>
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
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          {automatic ? (
            <p className="mb-10 text-sm text-muted-foreground">
              {chat?.githubRunUrl ? "Started from GitHub." : "Started automatically."} Follow the
              result here without managing it in your chat list.
            </p>
          ) : null}
          {history.error || list.error ? (
            <div role="alert" className="mb-6 text-sm text-destructive">
              {history.error ?? list.error}
              <Button
                variant="ghost"
                onClick={() => {
                  list.refresh();
                  history.refresh();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {history.isPending && !history.data ? (
            <p className="text-sm text-muted-foreground">Loading conversation…</p>
          ) : null}
          {history.data?.messages.length === 0 && !history.error && !list.error ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : null}
          <div className="space-y-8">
            {(!list.error && !history.error ? history.data?.messages : undefined)?.map(
              (message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user" ? "ml-8 rounded-2xl bg-muted px-5 py-4" : "py-2"
                  }
                >
                  <p className="mb-3 text-xs font-medium text-muted-foreground">
                    {message.role === "user" ? (automatic ? "GitHub kickoff" : "You") : "Codex"}
                  </p>
                  {automatic &&
                  message.role === "user" &&
                  message.text.includes("Immutable trusted request") ? (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        View kickoff instructions
                      </summary>
                      <div className="mt-4">
                        <ChatMarkdown
                          text={message.text}
                          cwd={undefined}
                          environmentId={environmentId}
                        />
                      </div>
                    </details>
                  ) : (
                    <ChatMarkdown
                      text={message.text}
                      cwd={undefined}
                      environmentId={environmentId}
                    />
                  )}
                </article>
              ),
            )}
          </div>
          <div className="mt-6 flex gap-2">
            {cursors.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() => setCursors((previous) => previous.slice(0, -1))}
              >
                Previous messages
              </Button>
            ) : null}
            {history.data?.nextCursor && !history.error && !list.error ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setCursors((previous) => [...previous, history.data?.nextCursor ?? undefined])
                }
              >
                Next messages
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <footer className="mx-auto w-full max-w-3xl px-6 pb-6 pt-3">
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {automatic
            ? "Automatic kickoff. No inbox action required."
            : "Cloud chat preview. Replying from T3 is the next step."}
          <a
            className="mt-2 flex w-fit items-center gap-1.5 text-xs text-foreground underline underline-offset-4"
            href={`codex://threads/${cloudThreadId}?hostId=durable`}
          >
            Open in Codex
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        </div>
      </footer>
    </main>
  );
}
