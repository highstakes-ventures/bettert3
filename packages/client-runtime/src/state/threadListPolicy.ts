import { isAutomaticThread } from "@t3tools/shared/threadAttention";

type ListThread = {
  readonly environmentId: string;
  readonly id: string;
  readonly source?: Parameters<typeof isAutomaticThread>[0];
};

export function threadListVisibility(
  thread: ListThread,
  context: {
    readonly automaticEnvironmentId: string | null;
    readonly todoThreadKeys?: ReadonlySet<string> | undefined;
  },
): "keep" | "hide" | "default" {
  if (context.todoThreadKeys?.has(`${thread.environmentId}:${thread.id}`)) return "keep";
  if (
    thread.source?.backgroundWorkflowId !== undefined ||
    (thread.environmentId === context.automaticEnvironmentId &&
      isAutomaticThread(thread.source ?? {}))
  )
    return "hide";
  return "default";
}

export function threadListPlacement(
  thread: Pick<ListThread, "environmentId" | "id">,
  context: {
    readonly timerThreadKeys?: ReadonlySet<string> | undefined;
    readonly todoThreadKeys?: ReadonlySet<string> | undefined;
  },
) {
  const key = `${thread.environmentId}:${thread.id}`;
  const hasOpenTodo = context.todoThreadKeys?.has(key) === true;
  return { hasOpenTodo, hasTimer: hasOpenTodo || context.timerThreadKeys?.has(key) === true };
}
