import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const refinementOnlyMessage =
  "This is a ticket refinement chat. Repository changes and implementation launches are disabled. Update the ticket, then use Approve to start its separate implementation chat.";

export class WorkflowThreadPolicyError extends Schema.TaggedError<WorkflowThreadPolicyError>()(
  "WorkflowThreadPolicyError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return "Could not resolve the thread's workflow restriction.";
  }
}

/** The original ticket chat stays restricted after approval, as do its descendants. */
export const resolve = <E, R>(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "lineage" | "ticketWorkflowId">,
  readThread: (id: ThreadId) => Effect.Effect<OrchestrationV2ThreadShell | null, E, R>,
) =>
  Effect.gen(function* () {
    const visited = new Set<ThreadId>();
    let current = thread;
    while (true) {
      if (visited.has(current.id)) {
        return yield* new WorkflowThreadPolicyError({ threadId: current.id });
      }
      visited.add(current.id);
      if (current.ticketWorkflowId !== undefined) return true;
      const parentId = current.lineage.parentThreadId;
      if (parentId === null) return false;
      const parent = yield* readThread(parentId);
      if (parent === null) return yield* new WorkflowThreadPolicyError({ threadId: parentId });
      current = parent;
    }
  });
