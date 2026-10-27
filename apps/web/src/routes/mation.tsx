import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAtomCommand } from "../state/use-atom-command";
import { useEffect, useRef, useState } from "react";
import { MationFrontendRequest } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { usePrimaryEnvironmentId } from "../state/environments";
import { mationEnvironment } from "../state/mation";

export const Route = createFileRoute("/mation")({
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
function MationPage() {
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(mationEnvironment.request);
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<{ environmentId: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!environmentId) return;
    let active = true;
    void request({ environmentId, input: { type: "page" } }).then((result) => {
      if (!active) return;
      if (result._tag === "Success" && "html" in result.value)
        setPage({ environmentId, html: result.value.html });
      else setError("Mation could not be opened. Check this environment's Mation connection.");
    });
    return () => {
      active = false;
    };
  }, [environmentId, request]);
  useEffect(() => {
    if (!environmentId) return;
    const receive = (event: MessageEvent) => {
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
  }, [environmentId, request]);
  if (!environmentId || !page || page.environmentId !== environmentId)
    return (
      <div className="p-6 text-muted-foreground" role="status">
        {error ?? "Opening Mation..."}
      </div>
    );
  return (
    <iframe
      ref={frame}
      title="Mation automations"
      srcDoc={page.html}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      className="h-full min-h-0 w-full flex-1 border-0"
    />
  );
}
