import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { ListTodoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { shortcutLabelForCommand } from "../../keybindings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { mationEnvironment } from "../../state/mation";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Kbd } from "../ui/kbd";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const decodeList = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      items: Schema.Array(Schema.Struct({ completedAt: Schema.NullOr(Schema.String) })),
    }),
  ),
);

export function TodoSidebarButton({ onClick }: { onClick: () => void }) {
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(mationEnvironment.request, { reportFailure: false });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [value, setValue] = useState<{ environmentId: string; count: number } | null>(null);
  const count = value?.environmentId === environmentId ? value.count : null;
  const shortcut = shortcutLabelForCommand(keybindings, "todo.capture");

  useEffect(() => {
    if (!environmentId) return;
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      sequence = sequence + 1;
      const serial = sequence;
      const result = await request({
        environmentId,
        input: {
          type: "request",
          request: { path: "todos", method: "GET" },
        },
      });
      if (
        !active ||
        serial !== sequence ||
        result._tag !== "Success" ||
        !("status" in result.value) ||
        result.value.status !== 200
      )
        return;
      const list = decodeList(result.value.body);
      if (list._tag === "Some")
        setValue({
          environmentId,
          count: list.value.items.filter((item) => item.completedAt === null).length,
        });
    };
    const visibleRefresh = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    const timer = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener("t3:todos-changed", visibleRefresh);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("t3:todos-changed", visibleRefresh);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [environmentId, request]);

  return (
    <SidebarMenuItem className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              size="icon"
              aria-label={count === null ? "Personal todos" : `Personal todos, ${count} open`}
              onClick={onClick}
            />
          }
        >
          <ListTodoIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">
          <div>Personal todos</div>
          {shortcut && (
            <div className="mt-1 flex items-center gap-2 text-muted-foreground">
              Add a todo <Kbd>{shortcut}</Kbd>
            </div>
          )}
        </TooltipPopup>
      </Tooltip>
      {count !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sidebar-control-surface px-0.5 text-3xs font-medium text-sidebar-foreground tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </SidebarMenuItem>
  );
}
