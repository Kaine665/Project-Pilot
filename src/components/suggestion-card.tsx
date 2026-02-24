'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { PlannerSuggestion } from '@/types/planner';
import { SUGGESTION_TYPE_LABELS } from '@/types/planner';
import type { FlowData, Section, TreeItem } from '@/types/flow';

interface SuggestionCardProps {
  suggestion: PlannerSuggestion;
  projectKey: string;
  onApplied: (id: string) => void;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function addItemRecursive(
  items: TreeItem[],
  parentId: string,
  child: TreeItem,
): TreeItem[] {
  return items.map(item => {
    if (item.id === parentId) {
      return { ...item, children: [...(item.children || []), child] };
    }
    if (item.children?.length) {
      return { ...item, children: addItemRecursive(item.children, parentId, child) };
    }
    return item;
  });
}

export function applyMutation(data: FlowData, suggestion: PlannerSuggestion): FlowData {
  switch (suggestion.type) {
    case 'add_section': {
      const p = suggestion.payload.section;
      if (!p) return data;
      const newSection: Section = {
        id: genId(),
        name: p.name,
        description: p.description,
        items: (p.items ?? []).map(i => ({
          id: genId(),
          content: i.content,
          status: 'todo' as const,
        })),
      };
      return { ...data, sections: [...data.sections, newSection] };
    }

    case 'add_item': {
      const p = suggestion.payload.item;
      if (!p) return data;
      const newItem: TreeItem = {
        id: genId(),
        content: p.content,
        status: 'todo' as const,
      };
      const targetSectionId = suggestion.target.sectionId;
      const parentItemId = suggestion.target.parentItemId;
      if (!targetSectionId) return data;
      return {
        ...data,
        sections: data.sections.map(s => {
          if (s.id !== targetSectionId) return s;
          const items = parentItemId
            ? addItemRecursive(s.items, parentItemId, newItem)
            : [...s.items, newItem];
          return { ...s, items };
        }),
      };
    }

    default:
      return data;
  }
}

export function SuggestionCard({ suggestion, projectKey, onApplied }: SuggestionCardProps) {
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (suggestion.applied || applying) return;
    setApplying(true);

    try {
      // Fetch current flow data
      const res = await fetch(`/api/data?project=${projectKey}`);
      if (!res.ok) throw new Error('Failed to load flow data');
      const flowData: FlowData = await res.json();

      // Apply mutation
      const newData = applyMutation(flowData, suggestion);

      // Save back
      const saveRes = await fetch(`/api/data?project=${projectKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      });

      if (saveRes.ok) {
        onApplied(suggestion.id);
      }
    } catch (err) {
      console.error('Failed to apply suggestion:', err);
    } finally {
      setApplying(false);
    }
  };

  const typeLabel = SUGGESTION_TYPE_LABELS[suggestion.type] ?? suggestion.type;

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 dark:border-blue-800/50 dark:bg-blue-900/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {typeLabel}
          </span>
          <p className="mt-1 text-xs leading-relaxed">{suggestion.description}</p>
          {suggestion.target.sectionName && (
            <p className="mt-0.5 text-[10px] text-zinc-400">
              {suggestion.target.sectionName}
            </p>
          )}
        </div>
        <button
          onClick={handleApply}
          disabled={suggestion.applied || applying}
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            suggestion.applied
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : applying
              ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
              : 'bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500'
          }`}
        >
          {suggestion.applied ? (
            <span className="flex items-center gap-1"><Check className="h-3 w-3" />已应用</span>
          ) : applying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            '应用'
          )}
        </button>
      </div>
    </div>
  );
}
