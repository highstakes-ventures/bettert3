import { requestTodoCapture } from "../TodoCaptureDialog";
import { useAtomValue } from "@effect/atom-react";
import { ListTodoIcon } from "lucide-react";
import { shortcutLabelForCommand } from "../../keybindings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { todoList } from "../../state/todos";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd } from "../ui/kbd";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function TodoSidebarButton({ onClick }: { onClick: () => void }) {
  const environmentId = usePrimaryEnvironmentId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const list = useEnvironmentQuery(environmentId ? todoList({ environmentId, input: {} }) : null);
  const count = list.data
    ? list.data.items.filter((item) => item.completedAt === null).length
    : null;
  const shortcut = shortcutLabelForCommand(keybindings, "todo.capture");

  return (
    <SidebarMenuItem className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              size="icon"
              aria-label={
                count === null ? "Add a personal todo" : `Add a personal todo, ${count} open`
              }
              onClick={() => {
                onClick();
                requestTodoCapture();
              }}
            />
          }
        >
          <ListTodoIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">
          <div>Add a personal todo</div>
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
