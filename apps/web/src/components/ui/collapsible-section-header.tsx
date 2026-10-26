import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils";

const tones = {
  muted: { label: "text-sidebar-muted-foreground/60", line: "bg-sidebar-border/60" },
  info: { label: "text-blue-600 dark:text-blue-400", line: "bg-blue-500/20 dark:bg-blue-400/15" },
  emphasized: { label: "text-sidebar-foreground/80", line: "bg-sidebar-foreground/25" },
  accent: { label: "text-primary", line: "bg-primary/50" },
} as const;

export function CollapsibleSectionHeader({
  children,
  expanded,
  tone = "muted",
  variant = "default",
  accessory,
  ...buttonProps
}: Omit<ComponentProps<"button">, "className" | "style" | "aria-expanded"> & {
  expanded: boolean;
  tone?: keyof typeof tones;
  variant?: "default" | "panel";
  accessory?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex h-8 w-full items-center gap-2 rounded-md text-left text-xs font-medium",
        variant === "panel" ? "ps-2 pe-2.5" : "px-2",
        tones[tone].label,
      )}
    >
      <button
        {...buttonProps}
        type="button"
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/70"
      >
        <span className="shrink-0">{children}</span>
        <span aria-hidden className={cn("h-px min-w-2 flex-1", tones[tone].line)} />
      </button>
      {accessory ? (
        <span className="pointer-events-none relative inline-flex shrink-0 items-center gap-2">
          {accessory}
        </span>
      ) : null}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "pointer-events-none relative size-3 shrink-0 transition-transform",
          !expanded && "rotate-180",
        )}
      />
    </div>
  );
}

export function SectionHeaderStatus({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-3xs leading-none text-destructive-foreground">{children}</span>
  );
}
