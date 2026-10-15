import { useDroppable } from "@dnd-kit/core";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { threadSectionKey } from "@t3tools/client-runtime/state/thread-sections";
import type { ProjectSection, ProjectSectionChange } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ListTreeIcon,
  Rows3Icon,
  PlusIcon,
  TagIcon,
} from "lucide-react";
import { useState } from "react";

import { projectIconColorClassName, PROJECT_ICON_COLORS } from "../../projectIconColors";
import { projectEnvironment } from "../../state/projects";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useUiStateStore } from "../../uiStateStore";
import { cn, randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

function SectionDot({ section }: { section: ProjectSection | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current",
        section ? projectIconColorClassName(section.color) : "text-muted-foreground",
      )}
    />
  );
}

function useSectionChange(project: EnvironmentProject) {
  const update = useOrchestrationCommand(projectEnvironment.update, "Could not update category");
  return (sectionChange: ProjectSectionChange) =>
    update({
      environmentId: project.environmentId,
      input: { projectId: project.id, sectionChange },
    });
}

function SectionEditor({
  project,
  section,
  onClose,
  onSaved,
}: {
  project: EnvironmentProject;
  section?: ProjectSection;
  onClose: () => void;
  onSaved?: (sectionId: string) => void;
}) {
  const [name, setName] = useState(section?.name ?? "");
  const [color, setColor] = useState(section?.color ?? "blue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = useSectionChange(project);
  const canChange = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || saving || !canChange) return;
            setSaving(true);
            const sectionId = section?.id ?? randomUUID();
            void change({
              type: "upsert",
              section: { id: sectionId, name: name.trim(), color },
            }).then((result) => {
              setSaving(false);
              if (result._tag === "Success") {
                onSaved?.(sectionId);
                onClose();
              } else
                setError(
                  "Could not save this category. Check the name and connection, then try again.",
                );
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{section ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>Organize chats in {project.title}.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm">
                Name
                <Input
                  autoFocus
                  maxLength={64}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-sm">Color</legend>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_ICON_COLORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={color === option.value}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-white -outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                        option.swatchClassName,
                      )}
                      onClick={() => setColor(option.value)}
                    >
                      {color === option.value ? <CheckIcon className="size-3.5" /> : null}
                    </button>
                  ))}
                </div>
              </fieldset>
              {error ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !canChange}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function NewSectionItem({
  project,
  onCreate,
}: {
  project: EnvironmentProject;
  onCreate: () => void;
}) {
  const canChange = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  return (
    <MenuItem disabled={!canChange || project.sections === undefined} onClick={onCreate}>
      <PlusIcon />
      New category in {project.title}
    </MenuItem>
  );
}

export function SectionViewMenu({ projects }: { projects: readonly EnvironmentProject[] }) {
  const grouping = useUiStateStore((state) => state.sidebarThreadGrouping);
  const setGrouping = useUiStateStore((state) => state.setSidebarThreadGrouping);
  const filter = useUiStateStore((state) => state.sidebarSectionFilter);
  const setFilter = useUiStateStore((state) => state.setSidebarSectionFilter);
  const [editingProject, setEditingProject] = useState<EnvironmentProject | null>(null);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <SidebarHeaderIconButton
              label={`View: ${grouping === "section" ? "By category" : "Chats"}${filter ? ", filtered" : ""}`}
            />
          }
        >
          {grouping === "section" ? <ListTreeIcon /> : <Rows3Icon />}
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setGrouping("chats")}>
            <CheckIcon className={grouping === "chats" ? "opacity-100" : "opacity-0"} />
            Chats
          </MenuItem>
          <MenuItem onClick={() => setGrouping("section")}>
            <CheckIcon className={grouping === "section" ? "opacity-100" : "opacity-0"} />
            By category
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => setFilter(null)}>
            <CheckIcon className={filter === null ? "opacity-100" : "opacity-0"} />
            All categories
          </MenuItem>
          {projects.flatMap((project) =>
            (project.sections ?? []).map((section) => (
              <MenuItem
                key={threadSectionKey(project, section.id)}
                onClick={() => setFilter(threadSectionKey(project, section.id))}
              >
                <SectionDot section={section} />
                {section.name}
                <span className="ml-auto text-xs text-muted-foreground">{project.title}</span>
                {filter === threadSectionKey(project, section.id) ? <CheckIcon /> : null}
              </MenuItem>
            )),
          )}
          <MenuSeparator />
          {projects.map((project) => (
            <NewSectionItem
              key={`${project.environmentId}:${project.id}`}
              project={project}
              onCreate={() => setEditingProject(project)}
            />
          ))}
        </MenuPopup>
      </Menu>
      {editingProject ? (
        <SectionEditor project={editingProject} onClose={() => setEditingProject(null)} />
      ) : null}
    </>
  );
}

export function ThreadSectionPicker({
  project,
  section,
  onChange,
}: {
  project: EnvironmentProject;
  section: ProjectSection | null;
  onChange: (sectionId: string | null) => void;
}) {
  const canChange = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const [creating, setCreating] = useState(false);
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              disabled={!canChange || project.sections === undefined}
              aria-label={`Category: ${section?.name ?? "Uncategorized"}`}
              className="flex h-5 max-w-24 items-center gap-1 rounded px-1 text-3xs text-muted-foreground hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          {section ? (
            <SectionDot section={section} />
          ) : (
            <TagIcon aria-hidden className="size-2.5" />
          )}
          {section ? <span className="truncate">{section.name}</span> : null}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem onClick={() => onChange(null)}>
            Uncategorized{section === null ? <CheckIcon /> : null}
          </MenuItem>
          {(project.sections ?? []).map((candidate) => (
            <MenuItem key={candidate.id} onClick={() => onChange(candidate.id)}>
              <SectionDot section={candidate} />
              {candidate.name}
              {section?.id === candidate.id ? <CheckIcon /> : null}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            New category
          </MenuItem>
        </MenuPopup>
      </Menu>
      {creating ? (
        <SectionEditor project={project} onSaved={onChange} onClose={() => setCreating(false)} />
      ) : null}
    </span>
  );
}

export function ThreadSectionHeading({
  project,
  section,
  count,
  showProject,
  onNewThread,
  dropEnabled = false,
  expandForDrop = false,
}: {
  project: EnvironmentProject;
  section: ProjectSection | null;
  count: number;
  showProject: boolean;
  onNewThread: () => void;
  dropEnabled?: boolean;
  expandForDrop?: boolean;
}) {
  const key = threadSectionKey(project, section?.id ?? null);
  const { setNodeRef } = useDroppable({
    id: `category:${key}`,
    disabled: !dropEnabled,
  });
  const collapsed =
    useUiStateStore((state) => state.collapsedThreadSections.includes(key)) && !expandForDrop;
  const toggle = useUiStateStore((state) => state.toggleThreadSection);
  const [editing, setEditing] = useState(false);
  const change = useSectionChange(project);
  const sections = project.sections ?? [];
  const index = sections.findIndex((candidate) => candidate.id === section?.id);
  const move = (offset: number) => {
    const ids = sections.map((candidate) => candidate.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void change({ type: "reorder", sectionIds: ids });
  };
  const canChange = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  return (
    <>
      <li
        ref={setNodeRef}
        data-category-key={key}
        className={cn(
          "group/category relative mt-3 flex min-w-0 items-center gap-1 rounded px-2 text-xs",
          section ? projectIconColorClassName(section.color) : "text-sidebar-muted-foreground",
        )}
      >
        {expandForDrop ? (
          <span
            aria-hidden
            data-category-drop-indicator
            className="pointer-events-none absolute inset-x-2 -bottom-px z-10 h-0.5 rounded-full bg-current"
          />
        ) : null}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Category ${section?.name ?? "Uncategorized"} in ${project.title}`}
          aria-expanded={!collapsed}
          onClick={() => toggle(key)}
        >
          <span className="max-w-1/2 truncate font-medium">{section?.name ?? "Uncategorized"}</span>
          {showProject ? (
            <span className="truncate text-3xs opacity-60">{project.title}</span>
          ) : null}
          <span aria-hidden className="h-px min-w-3 flex-1 bg-current opacity-25" />
          <span className="text-3xs tabular-nums text-sidebar-muted-foreground">{count}</span>
          {collapsed ? (
            <ChevronRightIcon className="size-3" />
          ) : (
            <ChevronDownIcon className="size-3" />
          )}
        </button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          disabled={!canChange || project.sections === undefined}
          aria-label={`New chat in ${section?.name ?? "Uncategorized"}`}
          onClick={onNewThread}
        >
          <PlusIcon />
        </Button>
        {section ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  disabled={!canChange || project.sections === undefined}
                  aria-label={`Manage ${section.name}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem disabled={!canChange} onClick={() => setEditing(true)}>
                Edit category
              </MenuItem>
              <MenuItem disabled={!canChange || index <= 0} onClick={() => move(-1)}>
                Move up
              </MenuItem>
              <MenuItem
                disabled={!canChange || index === sections.length - 1}
                onClick={() => move(1)}
              >
                Move down
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={!canChange}
                onClick={() => {
                  void change({ type: "delete", sectionId: section.id });
                }}
              >
                Delete category. Keep chats
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </li>
      {editing && section ? (
        <SectionEditor project={project} section={section} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}
