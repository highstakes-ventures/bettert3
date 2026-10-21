import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  WorkflowDecisionInput,
  WorkflowDetail,
  WorkflowRun,
} from "@t3tools/contracts";
import { orderRefinementQueue } from "@t3tools/workflows/tickets";
import { RefinementPanel } from "@t3tools/workflows/tickets/panel";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useRightPanelStore } from "~/rightPanelStore";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import ChatMarkdown from "../ChatMarkdown";

export function WorkflowTicketPanel(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
  cwd: string | undefined;
}) {
  const live = useEnvironmentQuery(
    serverEnvironment.workflowLive({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  const run = live.data?.runs.find((entry) => entry.id === props.runId);
  const detail = useEnvironmentQuery(
    serverEnvironment.workflowDetail({
      environmentId: props.environmentId,
      input: { runId: props.runId, ...(run ? { revision: run.updatedAt } : {}) },
    }),
  );
  const connection = useEnvironmentQuery(
    serverEnvironment.workflowConnection({ environmentId: props.environmentId, input: {} }),
  );
  if (!detail.data)
    return (
      <div role="status" className="p-5 text-sm text-muted-foreground">
        {detail.error ?? "Loading ticket…"}
        <Button variant="ghost" size="xs" onClick={detail.refresh}>
          Refresh
        </Button>
      </div>
    );
  return (
    <Ticket
      key={`${detail.data.ticket?.id}:${detail.data.ticket?.updatedAt}`}
      {...props}
      detail={detail.data}
      projects={connection.data?.projects ?? []}
      queue={live.data?.runs ?? []}
      refresh={detail.refresh}
    />
  );
}
function Ticket({
  environmentId,
  projectId,
  detail,
  projects,
  queue,
  cwd,
  refresh,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  detail: WorkflowDetail;
  projects: ReadonlyArray<{ id: string; name: string; teamIds: ReadonlyArray<string> }>;
  queue: ReadonlyArray<WorkflowRun>;
  cwd: string | undefined;
  refresh: () => void;
}) {
  const [target, setTarget] = useState(detail.ticket?.project?.id ?? "");
  const [busy, setBusy] = useState(false);
  const canDecide = useAtomValue(serverEnvironment.decideWorkflow.permissionAtom(environmentId));
  const decide = useAtomCommand(serverEnvironment.decideWorkflow);
  const navigate = useNavigate();
  async function submit(decision: WorkflowDecisionInput["decision"]) {
    if (busy || !canDecide || !detail.ticket) return;
    setBusy(true);
    const result = await decide({
      environmentId,
      input: {
        runId: detail.run.id,
        decision,
        expectedUpdatedAt: detail.ticket.updatedAt,
        targetProjectId: target || null,
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      refresh();
      return;
    }
    if (
      (result.value.phase === "review" && decision !== "delay") ||
      result.value.phase === "approving" ||
      result.value.phase === "rejecting"
    ) {
      refresh();
      return;
    }
    const nextQueue =
      decision === "delay"
        ? orderRefinementQueue(
            queue.map((run) => (run.id === result.value.id ? result.value : run)),
            Date.parse(result.value.updatedAt),
          )
        : queue;
    if (decision === "delay" && detail.run.threadId)
      useRightPanelStore
        .getState()
        .closeSurface(
          scopeThreadRef(environmentId, detail.run.threadId),
          `ticket:${detail.run.id}`,
        );
    const next = nextQueue.find(
      (run) => run.phase === "review" && run.id !== detail.run.id && run.threadId !== null,
    );
    if (next?.threadId) {
      useRightPanelStore
        .getState()
        .openTicket(scopeThreadRef(environmentId, next.threadId), next.id, projectId);
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: next.threadId },
      });
    } else refresh();
  }
  return (
    <RefinementPanel
      detail={detail}
      renderMarkdown={(text) => (
        <ChatMarkdown
          text={text}
          cwd={cwd}
          environmentId={environmentId}
          {...(detail.run.threadId
            ? { threadRef: scopeThreadRef(environmentId, detail.run.threadId) }
            : {})}
        />
      )}
      refreshControl={
        <Button variant="ghost" size="xs" onClick={refresh}>
          Refresh
        </Button>
      }
      projectControl={
        <Select
          value={target}
          onValueChange={(value) => setTarget(value ?? "")}
          disabled={busy || detail.run.phase !== "review" || !canDecide}
        >
          <SelectTrigger size="sm" aria-label="Target project">
            <SelectValue>
              {(value: string) =>
                projects.find((project) => project.id === value)?.name ?? "No project"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">No project</SelectItem>
            {projects
              .filter((project) => project.teamIds.includes(detail.ticket?.teamId ?? ""))
              .map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
          </SelectPopup>
        </Select>
      }
      actions={
        detail.run.phase === "review" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canDecide}
              onClick={() => void submit("reject")}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canDecide}
              onClick={() => void submit("delay")}
            >
              Delay
            </Button>
            <Button
              size="sm"
              disabled={busy || !canDecide || detail.questions.length > 0}
              onClick={() => void submit("approve")}
            >
              {busy ? "Saving…" : "Approve"}
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {detail.run.phase === "rejected"
              ? "Canceled"
              : detail.run.phase === "approved"
                ? "Waiting to implement"
                : detail.run.phase}
          </span>
        )
      }
    />
  );
}
