import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ListTodoIcon } from "lucide-react";
import { useState } from "react";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { readFreshThreadSnapshot } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { requestTodoCapture } from "../TodoCaptureDialog";
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
  const [busy, setBusy] = useState(false);
  async function convert() {
    if (busy || !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope))
      return;
    setBusy(true);
    try {
      const snapshot = await loadSnapshot({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }).catch(() => null);
      if (!snapshot || snapshot._tag !== "Success") {
        toastManager.add({
          type: "error",
          title: "Could not load the conversation",
          description: "Reconnect and try again.",
        });
        return;
      }
      requestTodoCapture({
        threadRef,
        title: snapshot.value.thread.title,
        context: chatTodoNote(snapshot.value.thread.title, snapshot.value.messages),
      });
    } finally {
      setBusy(false);
    }
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
      <TooltipPopup side="bottom">
        {busy ? "Loading conversation..." : "Convert chat to todo"}
      </TooltipPopup>
    </Tooltip>
  );
}
