import type { SessionSourceType } from './agent-chat';

declare module '@/types' {
  interface ScheduleRunRecord {
    sessionId: string;
    sourceType: SessionSourceType;
  }
}

export {};
