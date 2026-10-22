import type { EnvironmentId, ProjectId, WorkflowRun } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";

export function WorkflowActivity({
  environmentId,
  projectId,
  onOpenRun,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  onOpenRun: (run: WorkflowRun) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activity = useEnvironmentQuery(
    expanded
      ? serverEnvironment.workflowLive({
          environmentId,
          input: { projectId, includeDelayed: true },
        })
      : null,
  );
  return (
    <details
      className="border-t pt-2 text-xs"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground">Workflow activity</summary>
      {expanded && (
        <div className="mt-2 max-h-48 space-y-2 overflow-x-hidden overflow-y-auto">
          {activity.error ? <p role="alert">{activity.error}</p> : null}
          {!activity.data && !activity.error ? (
            <p role="status">Loading workflow activity…</p>
          ) : activity.data?.runs.length === 0 ? (
            <p>No workflow activity yet.</p>
          ) : (
            activity.data?.runs
              .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((run) => (
                <div key={run.id}>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="max-w-full"
                    disabled={!run.threadId && !run.implementationThreadId}
                    onClick={() => onOpenRun(run)}
                  >
                    <span className="truncate">{run.title}</span>
                  </Button>
                  <p className="text-muted-foreground">
                    {run.error ?? run.phase}
                    {run.phase === "review" && run.delayedAt
                      ? ` · Delayed on ${new Date(run.delayedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
              ))
          )}
        </div>
      )}
    </details>
  );
}
