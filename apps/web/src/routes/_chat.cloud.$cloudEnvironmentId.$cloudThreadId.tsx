import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { cloudChatVisitKey } from "../lib/cloudChatVisits";
import { waitForThreadShell } from "../state/entities";
import { cloudChats } from "../state/cloudChats";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";

export const Route = createFileRoute("/_chat/cloud/$cloudEnvironmentId/$cloudThreadId")({
  component: CloudChatView,
});

function CloudChatView() {
  const { cloudEnvironmentId, cloudThreadId } = Route.useParams();
  const environmentId = EnvironmentId.make(cloudEnvironmentId);
  const list = useEnvironmentQuery(cloudChats.list({ environmentId, input: {} }));
  const permitted = useAtomValue(cloudChats.open.permissionAtom(environmentId));
  const open = useAtomCommand(cloudChats.open, { reportFailure: false });
  const navigate = useNavigate();
  const markVisited = useUiStateStore((state) => state.markThreadVisited);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const accountId = list.error ? undefined : list.data?.accountId;
  const requestKey = `${accountId}:${cloudThreadId}:${attempt}`;
  useEffect(() => {
    if (!accountId || !permitted) return;
    let cancelled = false;
    void open({ environmentId, input: { accountId, threadId: cloudThreadId } }).then(
      async (result) => {
        if (cancelled) return;
        if (
          result._tag !== "Success" ||
          !(await waitForThreadShell({ environmentId, threadId: result.value.threadId }))
        ) {
          if (cancelled) return;
          setError({
            key: requestKey,
            message: "Could not open this Cloud conversation. Try again.",
          });
          return;
        }
        if (cancelled) return;
        markVisited(
          cloudChatVisitKey(environmentId, accountId, cloudThreadId),
          new Date().toISOString(),
        );
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: result.value.threadId },
          replace: true,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accountId, permitted, cloudThreadId, environmentId, open, navigate, markVisited, requestKey]);
  const failure = list.error ?? (error?.key === requestKey ? error.message : null);
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background">
      {failure ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              list.refresh();
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {permitted
            ? "Opening Cloud conversation…"
            : "Operating permission is required to open this Cloud conversation."}
        </p>
      )}
    </main>
  );
}
