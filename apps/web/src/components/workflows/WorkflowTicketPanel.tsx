import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  WorkflowDecisionInput,
  WorkflowDetail,
  WorkflowRun,
} from "@t3tools/contracts";
import { RefinementPanel } from "@t3tools/workflows/tickets/panel";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { threadEnvironment } from "~/state/threads";
import { useRightPanelStore } from "~/rightPanelStore";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import ChatMarkdown from "../ChatMarkdown";
import {
  refinementQueueWithPendingDecisions,
  stageWorkflowDecision,
  hasPendingWorkflowDecision,
  useWorkflowDecisions,
} from "./workflowActions";

export function WorkflowTicketPanel(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
  cwd: string | undefined;
}) {
  const live = useEnvironmentQuery(
    serverEnvironment.workflowLive({
      environmentId: props.environmentId,
      input: { projectId: props.projectId, includeAllProjects: true },
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
      intakeProjectId={live.data?.configuration?.intakeProjectId}
      queue={live.data?.runs ?? []}
      refresh={detail.refresh}
    />
  );
}
function Ticket({
  environmentId,
  detail,
  projects,
  intakeProjectId,
  queue,
  cwd,
  refresh,
}: {
  environmentId: EnvironmentId;
  detail: WorkflowDetail;
  projects: ReadonlyArray<{ id: string; name: string; teamIds: ReadonlyArray<string> }>;
  intakeProjectId: string | null | undefined;
  queue: ReadonlyArray<WorkflowRun>;
  cwd: string | undefined;
  refresh: () => void;
}) {
  const [target, setTarget] = useState(detail.ticket?.project?.id ?? "");
  const deliveryProjects = projects.filter(
    (project) =>
      project.id !== intakeProjectId && project.teamIds.includes(detail.ticket?.teamId ?? ""),
  );
  const selectedTarget =
    intakeProjectId === undefined
      ? undefined
      : deliveryProjects.find((project) => project.id === target);
  const busy = useWorkflowDecisions((state) =>
    hasPendingWorkflowDecision(environmentId, detail.run, state.decisions),
  );
  const canDecide = useAtomValue(serverEnvironment.decideWorkflow.permissionAtom(environmentId));
  const decide = useAtomCommand(serverEnvironment.decideWorkflow);
  const settle = useOrchestrationCommand(threadEnvironment.settle, "settle rejected ticket chat");
  const navigate = useNavigate();
  async function submit(decision: WorkflowDecisionInput["decision"]) {
    if (busy || !canDecide || !detail.ticket || (decision === "approve" && !selectedTarget)) return;
    const ticket = detail.ticket;
    const staged = stageWorkflowDecision({
      environmentId,
      run: detail.run,
      decision,
      commit: async () => {
        const result = await decide({
          environmentId,
          input: {
            runId: detail.run.id,
            decision,
            expectedUpdatedAt: ticket.updatedAt,
            targetProjectId: selectedTarget?.id ?? null,
          },
        });
        if (
          decision === "reject" &&
          result._tag === "Success" &&
          result.value.phase === "rejected" &&
          detail.run.threadId
        ) {
          await settle({ environmentId, input: { threadId: detail.run.threadId } });
        }
        return result;
      },
      restore: async () => {
        refresh();
        if (!detail.run.threadId) return;
        useRightPanelStore
          .getState()
          .openTicket(
            scopeThreadRef(environmentId, detail.run.threadId),
            detail.run.id,
            detail.run.projectId,
          );
        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: detail.run.threadId },
        });
      },
    });
    if (!staged) return;
    const nextQueue = refinementQueueWithPendingDecisions(environmentId, queue);
    if (detail.run.threadId)
      useRightPanelStore
        .getState()
        .closeSurface(
          scopeThreadRef(environmentId, detail.run.threadId),
          `ticket:${detail.run.id}`,
        );
    const next = nextQueue.find((run) => run.threadId !== null);
    if (next?.threadId) {
      useRightPanelStore
        .getState()
        .openTicket(scopeThreadRef(environmentId, next.threadId), next.id, next.projectId);
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: next.threadId },
      });
    } else refresh();
  }
  return (
    <RefinementPanel
      detail={
        detail.run.phase === "review" && !selectedTarget
          ? {
              ...detail,
              questions: ["Choose a delivery project before approval.", ...detail.questions],
            }
          : detail
      }
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
          value={selectedTarget?.id ?? ""}
          onValueChange={(value) => setTarget(value ?? "")}
          disabled={
            busy || detail.run.phase !== "review" || !canDecide || intakeProjectId === undefined
          }
        >
          <SelectTrigger size="sm" aria-label="Target project">
            <SelectValue>
              {(value: string) =>
                deliveryProjects.find((project) => project.id === value)?.name ??
                "Choose delivery project"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Choose delivery project</SelectItem>
            {deliveryProjects.map((project) => (
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
              disabled={busy || !canDecide || !selectedTarget || detail.questions.length > 0}
              onClick={() => void submit("approve")}
            >
              {busy ? "Pending…" : "Approve"}
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
