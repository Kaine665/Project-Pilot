'use client';

/**
 * dnd-kit sortable list — lazily loaded by miller-columns.tsx via next/dynamic.
 * Keeps all @dnd-kit imports out of the main bundle.
 */

import { memo, useMemo, useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';

// --- SortableItem (wraps any child with drag handle) ---

const SortableItem = memo(function SortableItem({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  }), [transform, transition, isDragging]);

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-stretch">
      <button
        className="flex items-center px-0.5 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover/col:opacity-100 transition-opacity shrink-0"
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
});

// --- DndSortableList ---

export interface DndSortableListProps {
  /** Ordered list of unique item IDs */
  itemIds: string[];
  /** Called when an item is dropped at a new position */
  onReorder: (oldIndex: number, newIndex: number) => void;
  /** Render function for each item */
  children: (id: string) => ReactNode;
}

export default function DndSortableList({ itemIds, onReorder, children }: DndSortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id as string);
      const newIndex = itemIds.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(oldIndex, newIndex);
      }
    }
  }, [itemIds, onReorder]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {itemIds.map(id => (
          <SortableItem key={id} id={id}>
            {children(id)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}
