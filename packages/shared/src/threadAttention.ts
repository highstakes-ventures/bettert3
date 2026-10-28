import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";

type ThreadAttentionSource = Partial<
  Pick<
    OrchestrationV2ThreadShell,
    | "automationOrigin"
    | "backgroundWorkflowId"
    | "ticketWorkflowId"
    | "scheduledTaskId"
    | "runDestination"
    | "pendingRuntimeRequest"
    | "hasEmailReview"
  >
>;

export function threadNeedsUserAttention(thread: ThreadAttentionSource): boolean {
  return (
    thread.hasEmailReview === true ||
    (thread.pendingRuntimeRequest != null && thread.pendingRuntimeRequest.kind !== "auth_refresh")
  );
}

/** Inbox visibility does not stop or settle the underlying automation. */
export function isAutomaticThread(
  thread: ThreadAttentionSource,
  boundToScheduledTask = false,
): boolean {
  return (
    !threadNeedsUserAttention(thread) &&
    thread.ticketWorkflowId === undefined &&
    (thread.automationOrigin !== undefined ||
      thread.backgroundWorkflowId !== undefined ||
      thread.scheduledTaskId !== undefined ||
      thread.runDestination?.origin === "automatic" ||
      boundToScheduledTask)
  );
}
