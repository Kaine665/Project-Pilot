'use client';

import { useState, useCallback } from 'react';
import { FolderKanban, Network, GripVertical, ChevronRight } from 'lucide-react';
import type { ProjectEntry } from '@/components/project-context';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { loadLocalFlowData, saveLocalFlowData } from '@/lib/flow-local-ephemeral';

interface SortableProjectTreeProps {
  projects: ProjectEntry[];
  activeKey: string | null;
  sections: { id: string; name: string }[];
  setSections: React.Dispatch<React.SetStateAction<{ id: string; name: string }[]>>;
  setActiveKey: (key: string) => void;
  fetchProjects: () => Promise<unknown>;
  setHighlightSectionId: (id: string | null) => void;
}

export function SortableProjectTree({
  projects,
  activeKey,
  sections,
  setSections,
  setActiveKey,
  fetchProjects,
  setHighlightSectionId,
}: SortableProjectTreeProps) {
  const [projectDragging, setProjectDragging] = useState(false);

  const projectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleProjectDragEnd = useCallback(async (event: DragEndEvent) => {
    setProjectDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex(p => p.key === active.id);
    const newIndex = projects.findIndex(p => p.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...projects];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    try {
      await fetch('/api/data/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: reordered.map(p => p.key) }),
      });
      await fetchProjects();
    } catch { /* ignore */ }
  }, [projects, fetchProjects]);

  const handleSectionDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeKey) return;
    const oldIndex = sections.findIndex(s => s.id === active.id);
    const newIndex = sections.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...sections];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setSections(reordered);

    try {
      const data = loadLocalFlowData(activeKey);
      const fullSections = [...(data.sections ?? [])];
      const [movedFull] = fullSections.splice(oldIndex, 1);
      fullSections.splice(newIndex, 0, movedFull);
      saveLocalFlowData(activeKey, { ...data, sections: fullSections });
    } catch { /* ignore */ }
  }, [sections, activeKey, setSections]);

  return (
    <DndContext sensors={projectSensors} collisionDetection={closestCenter} onDragStart={() => setProjectDragging(true)} onDragEnd={handleProjectDragEnd}>
      <SortableContext items={projects.map(p => p.key)} strategy={verticalListSortingStrategy}>
        {projects.map(p => (
          <SortableProjectItem
            key={p.key}
            project={p}
            isActive={p.key === activeKey}
            onSelect={setActiveKey}
            sections={p.key === activeKey ? sections : []}
            sectionSensors={sectionSensors}
            onSectionDragEnd={handleSectionDragEnd}
            onHighlightSection={setHighlightSectionId}
            hideSections={projectDragging}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableProjectItem({
  project,
  isActive,
  onSelect,
  sections,
  sectionSensors,
  onSectionDragEnd,
  onHighlightSection,
  hideSections,
}: {
  project: ProjectEntry;
  isActive: boolean;
  onSelect: (key: string) => void;
  sections: { id: string; name: string }[];
  sectionSensors: ReturnType<typeof useSensors>;
  onSectionDragEnd: (event: DragEndEvent) => void;
  onHighlightSection: (id: string | null) => void;
  hideSections: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.key });
  const yOnlyTransform = transform ? { ...transform, x: 0 } : null;
  const style = {
    transform: CSS.Transform.toString(yOnlyTransform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasSections = isActive && sections.length > 0;
  const expanded = hasSections && !collapsed && !hideSections;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isActive) {
      onSelect(project.key);
      setCollapsed(false);
    } else {
      setCollapsed(prev => !prev);
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`group flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-base cursor-pointer transition-colors ${
          isActive
            ? 'text-zinc-900 font-medium dark:text-zinc-100'
            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'
        }`}
      >
        <button
          className="shrink-0 p-0 bg-transparent border-none cursor-pointer"
          onClick={handleChevronClick}
        >
          <ChevronRight className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex flex-1 items-center gap-1 min-w-0" onClick={() => { onSelect(project.key); setCollapsed(false); }}>
          <FolderKanban className="h-4 w-4 shrink-0" />
          <span className="truncate">{project.name}</span>
        </div>
        <button
          className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}
          {...listeners}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <DndContext sensors={sectionSensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map(s => (
              <SortableSectionItem key={s.id} section={s} onHighlight={onHighlightSection} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableSectionItem({
  section,
  onHighlight,
}: {
  section: { id: string; name: string };
  onHighlight: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = () => {
    onHighlight(section.id);
    window.dispatchEvent(new CustomEvent('pp:highlight-section', { detail: section.id }));
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={handleClick}
      className="group flex w-full items-center gap-1 rounded-md pl-6 pr-1 py-1.5 text-sm cursor-pointer text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
    >
      <Network className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{section.name || '未命名'}</span>
      <button
        className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
