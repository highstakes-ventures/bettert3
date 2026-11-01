import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAtomCommand } from "../state/use-atom-command";
import { useEffect, useRef, useState } from "react";
import { EnvironmentId, MationFrontendRequest } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { usePrimaryEnvironmentId } from "../state/environments";
import { mationEnvironment } from "../state/mation";
import { forwardTodoKeydown } from "../components/TodoCaptureDialog";

export const Route = createFileRoute("/mation")({
  validateSearch: (search: Record<string, unknown>): { view?: "todos" } =>
    search.view === "todos" ? { view: "todos" } : {},
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  component: MationPage,
});
const decodeRequest = Schema.decodeUnknownOption(MationFrontendRequest);
const decodeTodoPage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ html: Schema.String })),
);
function MationPage() {
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(mationEnvironment.request);
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<{
    environmentId: string;
    view?: "todos" | undefined;
    html: string;
  } | null>(null);
  const [error, setError] = useState<{
    environmentId: string;
    view?: "todos" | undefined;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!environmentId) return;
    let active = true;
    const input =
      view === "todos"
        ? { type: "request" as const, request: { path: "todos/page", method: "GET" as const } }
        : { type: "page" as const };
    void request({ environmentId, input }).then((result) => {
      if (!active) return;
      if (result._tag === "Success") {
        if ("html" in result.value) {
          setPage({ environmentId, view, html: result.value.html });
          return;
        }
        if (result.value.status === 200) {
          const decoded = decodeTodoPage(result.value.body);
          if (decoded._tag === "Some") {
            setPage({ environmentId, view, html: decoded.value.html });
            return;
          }
        }
      }
      setError({
        environmentId,
        view,
        message: `${view === "todos" ? "Personal todos" : "Mation"} could not be opened. Check this environment's Mation connection.`,
      });
    });
    return () => {
      active = false;
    };
  }, [environmentId, request, view]);
  useEffect(() => {
    if (!environmentId) return;
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === "mation:keydown") {
        forwardTodoKeydown(event.data);
        return;
      }
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === "mation:open-draft" &&
        typeof event.data.prompt === "string" &&
        event.data.prompt.length > 0 &&
        event.data.prompt.length <= 8000
      ) {
        void navigate({ to: "/new", search: { prompt: event.data.prompt } });
        return;
      }
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === "mation:open-thread" &&
        typeof event.data.threadId === "string" &&
        event.data.threadId.length > 0 &&
        event.data.threadId.length <= 512
      ) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId:
              typeof event.data.environmentId === "string" &&
              event.data.environmentId.length > 0 &&
              event.data.environmentId.length <= 256
                ? EnvironmentId.make(event.data.environmentId)
                : environmentId,
            threadId: event.data.threadId,
          },
        });
        return;
      }
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "mation:request" ||
        typeof event.data.id !== "string"
      )
        return;
      const source = event.source as Window;
      const id = event.data.id;
      const input = decodeRequest(event.data);
      if (input._tag === "None") return;
      void request({ environmentId, input: { type: "request", request: input.value } }).then(
        (result) => {
          if (frame.current?.contentWindow !== source) return;
          if (
            (input.value.path.startsWith("todos") ||
              input.value.path.startsWith("email/reports/")) &&
            input.value.method !== "GET" &&
            result._tag === "Success" &&
            "status" in result.value &&
            result.value.status >= 200 &&
            result.value.status < 300
          )
            window.dispatchEvent(new Event("t3:todos-changed"));
          source.postMessage(
            result._tag === "Success" && "status" in result.value
              ? { type: "mation:response", id, ...result.value }
              : { type: "mation:response", id, error: true },
            "*",
          );
        },
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [environmentId, request, navigate]);
  if (!environmentId || !page || page.environmentId !== environmentId || page.view !== view)
    return (
      <div className="p-6 text-muted-foreground" role="status">
        {error?.environmentId === environmentId && error.view === view
          ? error.message
          : view === "todos"
            ? "Opening personal todos..."
            : "Opening Mation..."}
      </div>
    );
  return (
    <iframe
      ref={frame}
      title={view === "todos" ? "Personal todos" : "Mation automations"}
      srcDoc={page.html}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      className="h-full min-h-0 w-full flex-1 border-0"
    />
  );
}
