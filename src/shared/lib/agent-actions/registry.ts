/**
 * AgentActionRegistry — global singleton for managing AI-triggered actions.
 *
 * Provides:
 * - register(action): register an AgentAction
 * - getAll(): list all registered actions
 * - processResponse(text, ctx): parse + execute + strip all actions in one pass
 * - generateLoader(action): create a ResourceLoader for the action's instructions
 */

import type { AgentAction, ActionContext } from './types';
import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResourceType, ResolvedResource } from '@/types/resource';

class AgentActionRegistry {
  private actions = new Map<string, AgentAction>();

  register(action: AgentAction): void {
    if (this.actions.has(action.id)) {
      console.warn(`[AgentActionRegistry] Overwriting action: ${action.id}`);
    }
    this.actions.set(action.id, action);
  }

  get(id: string): AgentAction | undefined {
    return this.actions.get(id);
  }

  getAll(): AgentAction[] {
    return [...this.actions.values()];
  }

  /**
   * Process AI response text: parse all tags, execute side-effects, return cleaned text.
   *
   * Execution order follows action priority (lower first).
   */
  async processResponse(text: string, ctx: ActionContext): Promise<string> {
    const sorted = this.getAll().sort((a, b) => a.priority - b.priority);

    for (const action of sorted) {
      const items = action.parse(text);
      for (const item of items) {
        try {
          await action.execute(item, ctx);
        } catch (err) {
          console.error(`[AgentActionRegistry] Failed to execute action ${action.id}:`, err);
        }
      }
    }

    // Strip all action tags from text
    let cleaned = text;
    for (const action of sorted) {
      cleaned = action.strip(cleaned);
    }
    return cleaned;
  }

  /**
   * Strip all action tags from text (without executing).
   * Used for cleaning contentBlocks text entries.
   */
  stripAll(text: string): string {
    let cleaned = text;
    for (const action of this.actions.values()) {
      cleaned = action.strip(cleaned);
    }
    return cleaned;
  }

  /**
   * Generate a ResourceLoader that injects the action's instructions into the prompt.
   * This bridges AgentAction → ResourceLoader for backward compatibility.
   */
  generateLoader(action: AgentAction): ResourceLoader {
    return {
      type: action.resourceType as ResourceType,
      async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
        return {
          ref,
          content: action.instructions,
          sectionTitle: action.sectionTitle,
          ok: true,
        };
      },
    };
  }

  /**
   * Generate ResourceLoaders for all registered actions.
   * Call this after all actions are registered, then register each loader
   * with the ResourceRegistry.
   */
  generateAllLoaders(): ResourceLoader[] {
    return this.getAll().map(a => this.generateLoader(a));
  }
}

// ── Singleton (HMR-safe) ──

const g = globalThis as unknown as { __agentActionRegistry?: AgentActionRegistry };
export const actionRegistry = g.__agentActionRegistry ?? new AgentActionRegistry();
if (process.env.NODE_ENV !== 'production') {
  g.__agentActionRegistry = actionRegistry;
}
