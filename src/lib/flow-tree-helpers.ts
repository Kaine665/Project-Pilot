import type { TreeItem, Status } from '@/types/flow';

export function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// --- Recursive tree helpers ---

export function updateItemRecursive(
  items: TreeItem[],
  itemId: string,
  patch: Partial<Pick<TreeItem, 'content' | 'status' | 'description' | 'deferred' | 'context' | 'agentId'>>,
): TreeItem[] {
  return items.map(item => {
    if (item.id === itemId) return { ...item, ...patch };
    if (item.children?.length) {
      return { ...item, children: updateItemRecursive(item.children, itemId, patch) };
    }
    return item;
  });
}

export function deleteItemRecursive(items: TreeItem[], itemId: string): TreeItem[] {
  return items
    .filter(item => item.id !== itemId)
    .map(item =>
      item.children?.length
        ? { ...item, children: deleteItemRecursive(item.children, itemId) }
        : item,
    );
}

export function addChildItem(items: TreeItem[], parentId: string, child: TreeItem): TreeItem[] {
  return items.map(item => {
    if (item.id === parentId) {
      return { ...item, children: [...(item.children || []), child] };
    }
    if (item.children?.length) {
      return { ...item, children: addChildItem(item.children, parentId, child) };
    }
    return item;
  });
}

// Derive statuses bottom-up: parent status = derived from children
export function deriveStatuses(items: TreeItem[]): TreeItem[] {
  return items.map(item => {
    if (!item.children?.length) return item;
    const children = deriveStatuses(item.children);
    const statuses = children.map(c => c.status);
    let status: Status;
    if (statuses.every(s => s === 'done')) status = 'done';
    else if (statuses.some(s => s === 'done' || s === 'doing')) status = 'doing';
    else status = 'todo';
    return { ...item, children, status };
  });
}

// --- Reorder helpers ---

export function reorderArray<T>(arr: T[], oldIndex: number, newIndex: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(oldIndex, 1);
  result.splice(newIndex, 0, moved);
  return result;
}

export function reorderChildItems(
  items: TreeItem[],
  parentId: string,
  oldIndex: number,
  newIndex: number,
): TreeItem[] {
  return items.map(item => {
    if (item.id === parentId) {
      const children = reorderArray(item.children || [], oldIndex, newIndex);
      return { ...item, children };
    }
    if (item.children?.length) {
      return { ...item, children: reorderChildItems(item.children, parentId, oldIndex, newIndex) };
    }
    return item;
  });
}

// --- New helpers for move/reorder ---

/** Remove an item from the tree and return it along with the modified tree. */
export function extractItemRecursive(
  items: TreeItem[],
  itemId: string,
): { remaining: TreeItem[]; extracted: TreeItem | null } {
  let extracted: TreeItem | null = null;
  const remaining = items
    .filter(item => {
      if (item.id === itemId) {
        extracted = item;
        return false;
      }
      return true;
    })
    .map(item => {
      if (extracted) return item; // already found
      if (item.children?.length) {
        const result = extractItemRecursive(item.children, itemId);
        if (result.extracted) {
          extracted = result.extracted;
          return { ...item, children: result.remaining };
        }
      }
      return item;
    });
  return { remaining, extracted };
}

/** Find the index of an item by ID within a flat array. */
export function findItemIndex(items: TreeItem[], itemId: string): number {
  return items.findIndex(item => item.id === itemId);
}
