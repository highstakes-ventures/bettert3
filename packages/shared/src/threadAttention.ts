import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";

type ThreadAttentionSource = Partial<
  Pick<
    OrchestrationV2ThreadShell,
    | "createdBy"
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
export function isAutomaticThread(thread: ThreadAttentionSource): boolean {
  return (
    !threadNeedsUserAttention(thread) &&
    thread.ticketWorkflowId === undefined &&
    // Older servers infer a null origin when a timer fires in an existing chat.
    ((thread.automationOrigin !== undefined &&
      (thread.automationOrigin !== null || thread.createdBy !== "user")) ||
      thread.backgroundWorkflowId !== undefined ||
      thread.runDestination?.origin === "automatic")
  );
}
