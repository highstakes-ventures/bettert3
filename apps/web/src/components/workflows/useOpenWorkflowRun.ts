import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, WorkflowRun } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useRightPanelStore } from "~/rightPanelStore";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

export function useOpenWorkflowRun(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const unsettle = useOrchestrationCommand(threadEnvironment.unsettle, "reopen refinement chat");
  const latestOpen = useRef(0);
  useEffect(
    () => () => {
      latestOpen.current += 1;
    },
    [],
  );
  return async (run: WorkflowRun) => {
    const request = ++latestOpen.current;
    const threadId = run.threadId ?? run.implementationThreadId;
    if (!threadId) return false;
    if (run.phase === "review") {
      // Preparation can settle a chat before its first human message. Opening
      // refinement keeps it in the sidebar when the user moves to another ticket.
      const result = await unsettle({
        environmentId,
        input: { threadId, reason: "user" },
      });
      // Undo or another open can supersede this request while restoration runs.
      if (result._tag !== "Success" || request !== latestOpen.current) return false;
      useRightPanelStore
        .getState()
        .openTicket(scopeThreadRef(environmentId, threadId), run.id, run.projectId);
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
    });
    return true;
  };
}
