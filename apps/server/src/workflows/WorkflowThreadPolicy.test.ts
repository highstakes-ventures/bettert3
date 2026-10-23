import { expect, it } from "@effect/vitest";
import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as WorkflowThreadPolicy from "./WorkflowThreadPolicy.ts";

it.effect("restricts nested research and forks, and refuses missing or cyclic ancestry", () =>
  Effect.gen(function* () {
    const root = { ...liveThreadShell(ThreadId.make("refinement")), ticketWorkflowId: "ticket" };
    const child = {
      ...liveThreadShell(ThreadId.make("child")),
      lineage: {
        rootThreadId: root.id,
        parentThreadId: root.id,
        relationshipToParent: "subagent" as const,
      },
    };
    const fork = {
      ...liveThreadShell(ThreadId.make("fork")),
      lineage: {
        rootThreadId: root.id,
        parentThreadId: child.id,
        relationshipToParent: "fork" as const,
      },
    };
    const shells = new Map<ThreadId, OrchestrationV2ThreadShell>(
      [root, child, fork].map((s) => [s.id, s]),
    );
    const read = (id: ThreadId) => Effect.succeed(shells.get(id) ?? null);
    expect(yield* WorkflowThreadPolicy.resolve(fork, read)).toBe(true);
    shells.delete(root.id);
    expect((yield* WorkflowThreadPolicy.resolve(fork, read).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
    shells.set(root.id, {
      ...root,
      ticketWorkflowId: undefined,
      lineage: { ...root.lineage, parentThreadId: fork.id },
    });
    expect((yield* WorkflowThreadPolicy.resolve(fork, read).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
  }),
);
