import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";
import { useRef, useState } from "react";
import { mationEnvironment } from "../../state/mation";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { readFreshThreadSnapshot } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { chatTodoNote } from "./chatTodoNote";

export function ConvertChatToTodoButton({
  threadRef,
  compact = false,
}: {
  threadRef: ScopedThreadRef;
  compact?: boolean;
}) {
  const loadSnapshot = useAtomCommand(readFreshThreadSnapshot, { reportFailure: false });
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const request = useAtomCommand(mationEnvironment.request, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: string } | null>(null);
  async function convert() {
    if (busy || !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope))
      return;
    setBusy(true);
    const key = `${threadRef.environmentId}:${threadRef.threadId}`;
    let body = pending.current?.key === key ? pending.current.body : null;
    if (body === null) {
      const snapshot = await loadSnapshot({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }).catch(() => null);
      if (!snapshot || snapshot._tag !== "Success") {
        setBusy(false);
        toastManager.add({
          type: "error",
          title: "Could not load the conversation",
          description: "Reconnect and try again.",
        });
        return;
      }
      body = JSON.stringify({
        note: chatTodoNote(snapshot.value.thread.title, snapshot.value.messages),
        submissionId: randomUUID(),
        sourceChat: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
      });
    }
    pending.current = { key, body };
    const result = await request({
      environmentId: threadRef.environmentId,
      input: {
        type: "request",
        request: {
          path: "todos",
          method: "POST",
          body,
        },
      },
    }).catch(() => null);
    setBusy(false);
    if (
      !result ||
      result._tag !== "Success" ||
      !("status" in result.value) ||
      result.value.status < 200 ||
      result.value.status >= 300
    ) {
      toastManager.add({
        type: "error",
        title: "Could not convert chat to todo",
        description: "Mation did not confirm the save. Try again to save the same todo.",
      });
      return;
    }
    pending.current = null;
    window.dispatchEvent(new Event("t3:todos-changed"));
    toastManager.add({
      type: "success",
      title: "Todo saved",
      description: "The conversation is kept in Waiting while its todo is open.",
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size={compact ? "icon-micro" : "icon"}
            aria-label="Convert chat to todo"
            disabled={busy || !canOperate}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void convert();
            }}
          />
        }
      >
        <ListTodoIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{busy ? "Saving todo..." : "Convert chat to todo"}</TooltipPopup>
    </Tooltip>
  );
}
