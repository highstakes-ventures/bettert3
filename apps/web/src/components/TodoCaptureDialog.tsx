import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "~/lib/utils";
import { resolveShortcutCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { mationEnvironment } from "~/state/mation";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";

export function requestTodoCapture() {
  window.dispatchEvent(new Event("t3:todo-capture"));
}

// Called only after a host frame verifies the message's source. Resolve against live T3 bindings.
export function forwardTodoKeydown(data: Record<string, unknown>) {
  if (
    typeof data.key !== "string" ||
    data.key.length > 64 ||
    typeof data.code !== "string" ||
    data.code.length > 64
  )
    return;
  window.dispatchEvent(
    new KeyboardEvent("t3:todo-keydown", {
      key: data.key,
      code: data.code,
      metaKey: data.metaKey === true,
      ctrlKey: data.ctrlKey === true,
      altKey: data.altKey === true,
      shiftKey: data.shiftKey === true,
      repeat: data.repeat === true,
      isComposing: data.isComposing === true,
      cancelable: true,
    }),
  );
}

export function TodoCaptureDialog() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(mationEnvironment.request, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    const keydown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229)
        return;
      const terminalFocus =
        event.target instanceof Element &&
        event.target.closest(".t3-ghostty-input, [data-thread-terminal-drawer]") !== null;
      if (
        resolveShortcutCommand(event, keybindings, {
          context: { terminalFocus, terminalOpen: terminalFocus },
        }) !== "todo.capture"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      show();
    };
    window.addEventListener("keydown", keydown, { capture: true });
    window.addEventListener("t3:todo-keydown", keydown);
    window.addEventListener("t3:todo-capture", show);
    return () => {
      window.removeEventListener("keydown", keydown, { capture: true });
      window.removeEventListener("t3:todo-keydown", keydown);
      window.removeEventListener("t3:todo-capture", show);
    };
  }, [keybindings]);
  async function save() {
    if (!environmentId || !note.trim() || busy) return;
    const id = submissionId ?? randomUUID();
    setSubmissionId(id);
    setBusy(true);
    setError(null);
    const result = await request({
      environmentId,
      input: {
        type: "request",
        request: {
          path: "todos",
          method: "POST",
          body: JSON.stringify({ note: note.trim(), submissionId: id }),
        },
      },
    }).catch(() => null);
    setBusy(false);
    if (!result || result._tag !== "Success" || !("status" in result.value)) {
      setError("Mation did not confirm the save. Retry the same note.");
      return;
    }
    if (result.value.status < 200 || result.value.status >= 300) {
      if (result.value.status < 500 && result.value.status !== 409) setSubmissionId(null);
      setError("The todo could not be saved. Check the Mation connection, then retry.");
      return;
    }
    window.dispatchEvent(new Event("t3:todos-changed"));
    setNote("");
    setSubmissionId(null);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogPopup initialFocus={field}>
        <DialogHeader>
          <DialogTitle>Add a personal todo</DialogTitle>
          <DialogDescription>
            Save a note. An agent will give it a short scope and a return date.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-2 text-sm">
            What do you want to remember?
            <Textarea
              ref={field}
              value={note}
              maxLength={5000}
              disabled={busy || submissionId !== null}
              onChange={(event) => {
                setNote(event.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </label>
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <div className="sm:mr-auto">
            <Button
              variant="ghost"
              disabled={busy}
              render={
                <Link
                  to="/mation"
                  search={{ view: "todos" }}
                  onClick={(event) => {
                    if (busy) {
                      event.preventDefault();
                      return;
                    }
                    setOpen(false);
                  }}
                />
              }
            >
              View todos
            </Button>
          </div>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !note.trim() || !environmentId}>
            {busy ? "Saving…" : submissionId ? "Retry save" : "Add todo"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
