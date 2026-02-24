/**
 * AI 规划助手类型定义
 */

// ── 多会话 ──

export interface PlannerSession {
  id: string;                    // "planner-{timestamp}-{random}"
  projectKey: string;
  title: string;                 // AI 生成或 fallback
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  claudeSessionId?: string;      // 用于 --resume
  createdAt: string;
  updatedAt: string;
}

export interface PlannerSessionsData {
  sessions: PlannerSession[];
}

// ── Suggestions ──

export interface PlannerSuggestion {
  id: string;
  type: 'add_section' | 'add_item';
  description: string;
  target: {
    sectionId?: string;
    sectionName?: string;
    parentItemId?: string;
  };
  payload: {
    section?: { name: string; description?: string; items?: { content: string }[] };
    item?: { content: string };
  };
  applied?: boolean;
}

export const SUGGESTION_TYPE_LABELS: Record<PlannerSuggestion['type'], string> = {
  add_section: '新板块',
  add_item: '新条目',
};
