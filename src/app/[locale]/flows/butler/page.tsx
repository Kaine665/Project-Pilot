'use client';

import { useState, useEffect } from 'react';
import { AgentChatPanel } from '@/components/agent-chat-panel';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import type { Agent } from '@/types';
import { useProject } from '@/components/project-context';

export default function ButlerPage() {
  const { activeKey } = useProject();
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const agents: Agent[] = data.agents ?? [];
        const butler = agents.find(a => a.id === BUTLER_AGENT_ID && !a.archived);
        if (butler) setButlerAgent(butler);
      } catch { /* ignore */ }
    })();
  }, []);

  if (!butlerAgent) return null;

  return (
    <div className="flex h-full w-full">
      <AgentChatPanel agent={butlerAgent} variant="full" projectKey={activeKey} />
    </div>
  );
}
