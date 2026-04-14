/**
 * Distiller v0 — 从会话提炼结构化知识 + 待办（类型层）。
 */

export interface DistillerInput {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export type KnowledgeKind = 'fact' | 'decision' | 'rule' | 'lesson' | 'memo';

export interface ExtractedKnowledge {
  title: string;
  content: string;
  type: KnowledgeKind;
}

export interface ExtractedTodo {
  title: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface DistillerOutput {
  knowledge: ExtractedKnowledge[];
  todos: ExtractedTodo[];
}
