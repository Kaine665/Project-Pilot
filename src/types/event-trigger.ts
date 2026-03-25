export type EventTriggerSource = 'github_polling';

export type EventTriggerEvent =
  | 'pull_request.opened'
  | 'pull_request.synchronized';

export type EventTriggerActionType = 'start_agent';

export interface EventTriggerFilters {
  baseBranch?: string;
  headBranch?: string;
  author?: string;
  label?: string;
}

export interface GitHubPollingSourceConfig {
  owner: string;
  repo: string;
  pollIntervalSec: number;
  tokenEnvVar?: string;
}

export interface EventTriggerActionStartAgent {
  type: 'start_agent';
  agentId: string;
  prompt?: string;
}

export type EventTriggerAction = EventTriggerActionStartAgent;

export interface EventTrigger {
  id: string;
  name: string;
  enabled: boolean;
  projectKey?: string;
  source: EventTriggerSource;
  event: EventTriggerEvent;
  sourceConfig: GitHubPollingSourceConfig;
  filters?: EventTriggerFilters;
  action: EventTriggerAction;
  createdAt: string;
  updatedAt: string;
}

export interface EventTriggersData {
  triggers: EventTrigger[];
}

export interface EventTriggerPullSnapshot {
  id: number;
  number: number;
  title: string;
  url: string;
  author?: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  updatedAt: string;
  labels: string[];
}

export interface EventTriggerStateEntry {
  initializedAt?: string;
  lastPolledAt?: string;
  pulls: EventTriggerPullSnapshot[];
}

export interface EventTriggerStatesData {
  states: Record<string, EventTriggerStateEntry>;
}

export interface EventTriggerRunRecord {
  id: string;
  triggerId: string;
  source: EventTriggerSource;
  event: EventTriggerEvent;
  dedupeKey: string;
  startedAt: string;
  status: 'matched' | 'failed';
  sessionId?: string;
  error?: string;
  summary: string;
  projectKey?: string;
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
}

export interface EventTriggerRunsData {
  runs: EventTriggerRunRecord[];
}
