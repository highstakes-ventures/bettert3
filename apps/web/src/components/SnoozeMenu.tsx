import { useMemo, type ComponentProps, type ReactNode } from "react";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { matchesKeybindingShortcut, parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { formatShortcutLabel } from "../keybindings";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { resolveSnoozePresets, type SnoozePreset } from "./Sidebar.snooze";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut } from "./ui/menu";

export function SnoozeMenu({
  open,
  onOpenChange,
  onSnooze,
  timestampFormat,
  anchor,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  timestampFormat: TimestampFormat;
  anchor?: ComponentProps<typeof MenuPopup>["anchor"];
  children?: ReactNode;
}) {
  // Resolve relative times each time the menu opens.
  const presets = useMemo(
    () => (open ? resolveSnoozePresets(new Date(), timestampFormat) : []),
    [open, timestampFormat],
  );
  const choices = presets.map((preset, index) => ({
    preset,
    shortcut: parseKeybindingShortcut(`mod+${index + 1}`)!,
  }));
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      {children}
      <MenuPopup
        side="bottom"
        align="end"
        anchor={anchor}
        finalFocus
        data-snooze-menu={open ? "" : undefined}
        onKeyDownCapture={(event) => {
          const choice = choices.find(({ shortcut }) =>
            matchesKeybindingShortcut(event, shortcut, navigator.platform),
          );
          if (!choice) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          onOpenChange(false);
          onSnooze(choice.preset);
        }}
      >
        {choices.map(({ preset, shortcut }) => (
          <MenuItem
            key={preset.id}
            onClick={(event) => {
              event.stopPropagation();
              onOpenChange(false);
              onSnooze(preset);
            }}
          >
            {preset.label}
            <MenuShortcut>
              {preset.whenLabel} {formatShortcutLabel(shortcut)}
            </MenuShortcut>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          onClick={async (event) => {
            event.stopPropagation();
            onOpenChange(false);
            const choice = await requestCustomSnooze();
            if (choice) onSnooze(choice);
          }}
        >
          Custom…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
