import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, EnvironmentId, type PaiWidgetReference } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { paiEnvironment } from "~/state/pai";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "~/components/ui/button";
import { forwardTodoKeydown } from "~/components/TodoCaptureDialog";

/** Mation owns this PAI widget and its workflow. T3 supplies its connection and chat router. */
export function PaiWidgetFrame(props: {
  environmentId: EnvironmentId;
  widget: PaiWidgetReference;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <EmailFrame
      key={`${props.environmentId}:${props.widget.reportId}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
function EmailFrame({
  environmentId,
  widget,
  onRetry,
}: {
  environmentId: EnvironmentId;
  widget: PaiWidgetReference;
  onRetry: () => void;
}) {
  const request = useAtomCommand(paiEnvironment.request, { reportFailure: false });
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const theme = useHtmlRenderTheme();
  const [page, setPage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    let active = true;
    void request({ environmentId, input: { type: "page" } }).then((result) => {
      if (!active) return;
      if (result._tag === "Success" && "html" in result.value) setPage(result.value.html);
      else setError(true);
    });
    return () => {
      active = false;
    };
  }, [environmentId, request]);
  useEffect(() => {
    const sendTheme = () =>
      frame.current?.contentWindow?.postMessage(
        { type: "pai:theme", variables: theme.variables },
        "*",
      );
    sendTheme();
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "mation:keydown") {
        forwardTodoKeydown(data);
        return;
      }
      if (data?.type === "pai:ready") {
        sendTheme();
        return;
      }
      if (data?.type === "pai:resize" && Number.isFinite(data.height)) {
        setHeight(Math.max(80, Math.min(4000, data.height)));
        return;
      }
      if (
        data?.type === "pai:open-thread" &&
        typeof data.threadId === "string" &&
        data.threadId.length > 0 &&
        data.threadId.length <= 512
      ) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(
              typeof data.environmentId === "string" &&
                data.environmentId.length > 0 &&
                data.environmentId.length <= 256
                ? EnvironmentId.make(data.environmentId)
                : environmentId,
              ThreadId.make(data.threadId),
            ),
          ),
        });
        return;
      }
      if (
        data?.type !== "pai:request" ||
        typeof data.id !== "string" ||
        data.id.length > 128 ||
        (data.method !== "GET" && data.method !== "POST") ||
        (data.body !== undefined && (typeof data.body !== "string" || data.body.length > 100000))
      )
        return;
      const source = frame.current!.contentWindow!;
      void request({
        environmentId,
        input: {
          type: "request",
          request: {
            reportId: widget.reportId,
            method: data.method,
            ...(data.body === undefined ? {} : { body: data.body }),
          },
        },
      }).then((result) => {
        if (frame.current?.contentWindow !== source) return;
        if (
          data.method === "POST" &&
          result._tag === "Success" &&
          "status" in result.value &&
          result.value.status >= 200 &&
          result.value.status < 300
        )
          window.dispatchEvent(new Event("t3:todos-changed"));
        source.postMessage(
          result._tag === "Success" && "status" in result.value
            ? { type: "pai:response", id: data.id, ...result.value }
            : { type: "pai:response", id: data.id, error: true },
          "*",
        );
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [environmentId, widget.reportId, request, navigate, theme.variables]);
  if (!page)
    return (
      <div role="status" className="py-4 text-muted-foreground text-sm">
        {error ? (
          <>
            <p>PAI email review could not be opened.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry email review
            </Button>
          </>
        ) : (
          "Opening email review..."
        )}
      </div>
    );
  return (
    <iframe
      name={`mation-email:${widget.reportId}`}
      ref={frame}
      title="PAI email review"
      srcDoc={page}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border-0"
      style={{ height }}
    />
  );
}
