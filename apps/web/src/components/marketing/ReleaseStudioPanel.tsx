import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useRightPanelStore } from "~/rightPanelStore";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef, useState } from "react";
import { ReleaseStudio } from "@highstakes/marketing/studio";
import type { HumanCommand } from "@highstakes/marketing/contracts";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { marketingEnvironment } from "~/state/marketing";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

type PanelProps = { environmentId: EnvironmentId; threadId: ThreadId };

export function ReleaseStudioPanel(props: PanelProps) {
  return (
    <ReleaseStudioPanelContent
      key={scopedThreadKey(scopeThreadRef(props.environmentId, props.threadId))}
      {...props}
    />
  );
}

const studioButton = (label: string, onClick: () => void, disabled: boolean) => (
  <Button
    key={label}
    variant={label.startsWith("Approve") ? "default" : "outline"}
    size="sm"
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </Button>
);

function ReleaseStudioPanelContent({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const request = useAtomCommand(marketingEnvironment.request, { reportFailure: false });
  const query = marketingEnvironment.read({ environmentId, input: { threadId } });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const value = AsyncResult.getOrElse(result, () => null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const error =
    mutationError ??
    (result._tag === "Failure"
      ? "Studio could not load this draft. Refresh before retrying."
      : null);
  async function act(command: HumanCommand) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const reply = await request({ environmentId, input: { threadId, command } });
      setMutationError(
        reply._tag === "Success"
          ? null
          : "Studio could not complete the request. Refresh before retrying.",
      );
      refresh();
    } catch {
      setMutationError("Studio could not complete the request. Refresh before retrying.");
    }
    mutationInFlight.current = false;
    setBusy(false);
  }
  if (!value)
    return (
      <div className="space-y-3 p-5 text-sm text-muted-foreground" role="status">
        <p>{error ?? "Opening release Studio..."}</p>
        {error && (
          <Button variant="ghost" size="sm" onClick={refresh}>
            Retry
          </Button>
        )}
      </div>
    );
  return (
    <ReleaseStudio
      value={value}
      busy={busy}
      error={error}
      act={(command) => void act(command)}
      button={studioButton}
    />
  );
}

export function ReleaseStudioAutoOpen({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- offers the external panel store a Studio tab when a release conversation mounts
  useEffect(() => {
    if (!threadId.startsWith("marketing-release:")) return;
    const ref = scopeThreadRef(environmentId, threadId),
      store = useRightPanelStore.getState();
    store.openProactive(
      ref,
      { id: "marketing", kind: "marketing" },
      store.getUserActionRevision(ref),
      true,
    );
  }, [environmentId, threadId]);
  return null;
}
