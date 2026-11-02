import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquareTextIcon } from "lucide-react";
import { randomUUID } from "~/lib/utils";
import { resolveShortcutCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { todoEnvironment } from "~/state/todo";
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
import { prepareTodoCaptureNote } from "./TodoCaptureDialog.logic";

interface TodoCaptureSource {
  threadRef: ScopedThreadRef;
  title: string;
  context: string;
}

interface CaptureDraft {
  source?: TodoCaptureSource;
  note: string;
  submissionId: string | null;
  error: string | null;
}

function emptyDraft(source?: TodoCaptureSource): CaptureDraft {
  return { ...(source ? { source } : {}), note: "", submissionId: null, error: null };
}

export function requestTodoCapture(source?: TodoCaptureSource) {
  window.dispatchEvent(new CustomEvent("t3:todo-capture", { detail: source }));
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
  const request = useAtomCommand(todoEnvironment.request, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, CaptureDraft>>({ "": emptyDraft() });
  const { source, note, submissionId, error } = drafts[draftKey] ?? emptyDraft();
  const targetEnvironmentId = source?.threadRef.environmentId ?? environmentId;
  const canSave = Boolean(note.trim() || source);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  function updateDraft(change: Partial<CaptureDraft>) {
    setDrafts((current) => ({
      ...current,
      [draftKey]: { ...(current[draftKey] ?? emptyDraft()), ...change },
    }));
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the todo capture event and shortcut listeners
  useEffect(() => {
    const show = (event?: Event) => {
      if (busy || open) return;
      const source =
        event instanceof CustomEvent ? (event.detail as TodoCaptureSource | undefined) : undefined;
      const key = source ? JSON.stringify(source.threadRef) : "";
      setDrafts((current) => {
        const draft = current[key];
        if (draft?.submissionId || (draft && !source)) return current;
        return {
          ...current,
          [key]: draft && source ? { ...draft, source } : emptyDraft(source),
        };
      });
      setDraftKey(key);
      setOpen(true);
    };
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
  }, [keybindings, busy, open]);
  async function save() {
    if (!targetEnvironmentId || !canSave || busy) return;
    const prepared = prepareTodoCaptureNote(note, source?.context);
    if (prepared.note === null) {
      updateDraft({ error: prepared.error });
      return;
    }
    const id = submissionId ?? randomUUID();
    updateDraft({ submissionId: id, error: null });
    setBusy(true);
    const result = await request({
      environmentId: targetEnvironmentId,
      input: {
        type: "request",
        request: {
          path: "todos",
          method: "POST",
          body: JSON.stringify({
            note: prepared.note,
            submissionId: id,
            ...(source ? { sourceChat: source.threadRef } : {}),
          }),
        },
      },
    }).catch(() => null);
    setBusy(false);
    if (!result || result._tag !== "Success" || !("status" in result.value)) {
      updateDraft({ error: "Todo did not confirm the save. Retry the same note." });
      return;
    }
    if (result.value.status < 200 || result.value.status >= 300) {
      updateDraft({
        ...(result.value.status < 500 && result.value.status !== 409 ? { submissionId: null } : {}),
        error: "The todo could not be saved. Check the Todo connection, then retry.",
      });
      return;
    }
    window.dispatchEvent(new Event("t3:todos-changed"));
    setDrafts((current) => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
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
          {source && (
            <section
              aria-label="Linked conversation"
              className="flex items-start gap-3 border-b border-border pb-4"
            >
              <MessageSquareTextIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 space-y-1">
                <h2 className="text-sm leading-snug font-medium wrap-anywhere">{source.title}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Conversation linked to this todo
                </p>
              </div>
            </section>
          )}
          <label className="block space-y-2 text-sm">
            What do you want to remember?
            <Textarea
              ref={field}
              value={note}
              maxLength={5000}
              placeholder={source ? "Add a next step or a reminder, if you'd like…" : undefined}
              disabled={busy || submissionId !== null}
              onChange={(event) => {
                updateDraft({ note: event.currentTarget.value, error: null });
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
                  to="/todo"
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
          <Button onClick={() => void save()} disabled={busy || !canSave || !targetEnvironmentId}>
            {busy ? "Saving…" : submissionId ? "Retry save" : "Add todo"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
