import * as Schema from "effect/Schema";
import { useCallback, useRef } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

const ExpandedSidebarShelf = Schema.NullOr(
  Schema.Literals(["timer", "working", "snoozed", "settled", "automatic"]),
);
type SidebarShelf = Exclude<typeof ExpandedSidebarShelf.Type, null>;

export function useSidebarShelves(isMobile: boolean) {
  const [expandedShelf, setExpandedShelf] = useLocalStorage(
    "t3code:sidebar:expanded-shelf",
    null,
    ExpandedSidebarShelf,
  );
  const collapseOnLeave = useRef<SidebarShelf | null>(null);
  const toggleShelf = useCallback(
    (shelf: SidebarShelf) => {
      collapseOnLeave.current = null;
      setExpandedShelf((value) => (value === shelf ? null : shelf));
    },
    [setExpandedShelf],
  );
  const onThreadOpen = useCallback(() => {
    if (!isMobile) collapseOnLeave.current = expandedShelf;
  }, [expandedShelf, isMobile]);
  const onMouseLeave = useCallback(
    (event: { buttons: number }) => {
      if (isMobile || event.buttons !== 0 || collapseOnLeave.current === null) return;
      const shelf = collapseOnLeave.current;
      collapseOnLeave.current = null;
      setExpandedShelf((value) => (value === shelf ? null : value));
    },
    [isMobile, setExpandedShelf],
  );
  return { expandedShelf, toggleShelf, onThreadOpen, onMouseLeave };
}
