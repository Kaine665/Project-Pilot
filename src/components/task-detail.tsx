'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { ChatPanel } from '@/components/chat-panel';
import { ArtifactPanel } from '@/components/artifact-panel';
import { ConversationTabs } from '@/components/conversation-tabs';
import type { ChatPanelHandle } from '@/components/chat-panel';
import type { Task, TaskUnderstanding, TaskResult, AIPlan, SessionPhase, ConversationMeta } from '@/types';
import { isLegacyFlowContext } from '@/types/flow-context';
import { cn } from '@/lib/utils';

interface TaskDetailProps {
  taskId: string;
  artifactOpen?: boolean;
}

export function TaskDetail({ taskId, artifactOpen = true }: TaskDetailProps) {
  const t = useTranslations('tasks');
  const tArtifacts = useTranslations('artifacts');
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const chatRef = useRef<ChatPanelHandle>(null);
  const fetchCounterRef = useRef(0);

  // Artifact panel state
  const [understanding, setUnderstanding] = useState<TaskUnderstanding | null>(null);
  const [latestPlan, setLatestPlan] = useState<AIPlan | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);

  // Conversation history
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [conversationList, setConversationList] = useState<ConversationMeta[]>([]);

  // Phase tracking
  const [phase, setPhase] = useState<SessionPhase | undefined>(undefined);

  // Git
  const [gitLoading, setGitLoading] = useState(false);

  const fetchTask = useCallback(async (showLoading = false) => {
    if (!taskId) return;
    const requestId = ++fetchCounterRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(`/api/tasks/${taskId}`);
      // Ignore stale responses — a newer fetch or saveTask has superseded this one
      if (res.ok && fetchCounterRef.current === requestId) {
        const data = await res.json();
        setTask(data);
        setPhase(data.phase ?? 'understanding');
      }
    } catch (err) {
      console.error('Failed to fetch task:', err);
    } finally {
      if (fetchCounterRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [taskId]);

  // Fetch task artifacts (understanding, plan, result) from backend
  const fetchArtifacts = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/task-artifacts?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.understanding) setUnderstanding(data.understanding);
        if (data.plan) setLatestPlan(data.plan);
        if (data.result) setResult(data.result);
      }
    } catch (err) {
      console.error('Failed to fetch artifacts:', err);
    }
  }, [taskId]);

  // Fetch conversation list for this task
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const fetchConversations = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/ai-chat/conversations?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        const convs = data.conversations ?? [];
        setConversationList(convs);
        // 默认选中活跃对话（仅当当前选中无效时）
        const currentId = conversationIdRef.current;
        if (!currentId || !convs.some((c: ConversationMeta) => c.conversationId === currentId)) {
          setConversationId(data.activeConversationId ?? convs[0]?.conversationId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [taskId]);

  useEffect(() => {
    // Reset state when switching tasks
    setPhase(undefined);
    setUnderstanding(null);
    setLatestPlan(null);
    setResult(null);
    setConversationId(undefined);
    setConversationList([]);
    fetchTask(true);
    fetchArtifacts();
    fetchConversations();
  }, [fetchTask, fetchArtifacts, fetchConversations]);

  // Re-fetch task when status changes (e.g. backend auto todo→doing)
  useEffect(() => {
    const handler = () => fetchTask();
    window.addEventListener('task-updated', handler);
    return () => window.removeEventListener('task-updated', handler);
  }, [fetchTask]);

  const saveTask = async (updates: Partial<Task>) => {
    if (!taskId) return;
    // Optimistic update — apply changes immediately so UI doesn't flicker
    setTask((prev) => prev ? { ...prev, ...updates } : prev);
    // Invalidate any in-flight fetchTask so stale responses don't overwrite optimistic state
    fetchCounterRef.current++;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data); // Sync with server response
        window.dispatchEvent(new CustomEvent('task-updated'));
      } else {
        // Revert on failure
        fetchTask();
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  // Create a new conversation for this task
  const handleNewConversation = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await fetch('/api/ai-chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversationId(data.conversationId);
        fetchConversations();
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }, [taskId, fetchConversations]);

  // Refresh conversation list after a message exchange completes
  const handleStreamDone = useCallback(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Archive (soft delete) a conversation
  const handleArchiveConversation = useCallback(async (convId: string) => {
    if (!taskId) return;
    try {
      await fetch('/api/ai-chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, conversationId: convId, action: 'archive' }),
      });
      // If archived the current conversation, switch to another
      if (convId === conversationId) {
        const remaining = conversationList.filter((c) => !c.archived && c.conversationId !== convId);
        setConversationId(remaining[0]?.conversationId);
      }
      fetchConversations();
    } catch (err) {
      console.error('Failed to archive conversation:', err);
    }
  }, [taskId, conversationId, conversationList, fetchConversations]);

  // Restore a conversation from trash
  const handleRestoreConversation = useCallback(async (convId: string) => {
    if (!taskId) return;
    try {
      await fetch('/api/ai-chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, conversationId: convId, action: 'restore' }),
      });
      fetchConversations();
    } catch (err) {
      console.error('Failed to restore conversation:', err);
    }
  }, [taskId, fetchConversations]);

  // Rename a conversation
  const handleRenameConversation = useCallback(async (convId: string, newTitle: string) => {
    if (!taskId) return;
    try {
      await fetch('/api/ai-chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, conversationId: convId, action: 'rename', title: newTitle }),
      });
      fetchConversations();
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  }, [taskId, fetchConversations]);

  // Permanently delete a conversation
  const handlePermanentDeleteConversation = useCallback(async (convId: string) => {
    if (!taskId) return;
    try {
      await fetch(`/api/ai-chat/conversations?taskId=${taskId}&conversationId=${convId}`, {
        method: 'DELETE',
      });
      fetchConversations();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, [taskId, fetchConversations]);

  // Branch conversation from a specific message
  const handleBranchConversation = useCallback(async (messageId: string) => {
    if (!taskId || !conversationId) return;
    try {
      const res = await fetch('/api/ai-chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          action: 'branch',
          sourceConversationId: conversationId,
          branchFromMessageId: messageId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversationId(data.conversationId);
        fetchConversations();
      }
    } catch (err) {
      console.error('Failed to branch conversation:', err);
    }
  }, [taskId, conversationId, fetchConversations]);

  // Send message from artifact panel actions (e.g. "重新规划")
  const handleSendMessage = useCallback((text: string) => {
    chatRef.current?.sendMessage(text);
  }, []);

  // Clear all artifacts (called when user clicks delete in chat panel)
  const handleClearAll = useCallback(async () => {
    if (!taskId) return;
    try {
      // Clear artifacts from backend
      await fetch(`/api/task-artifacts?taskId=${taskId}`, { method: 'DELETE' });
      // Clear local state
      setUnderstanding(null);
      setLatestPlan(null);
      setResult(null);
      setPhase(undefined);
    } catch (err) {
      console.error('Failed to clear artifacts:', err);
    }
  }, [taskId]);

  // Git merge
  const handleMerge = async () => {
    if (!taskId || !task?.gitBranch || gitLoading) return;
    if (!confirm(tArtifacts('confirmMerge', { branch: task.gitBranch }))) return;
    setGitLoading(true);
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'merge' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(tArtifacts('mergeFailedWithError', { error: data.error }));
        return;
      }
      alert(data.message);
      fetchTask();
    } catch (err) {
      console.error('Failed to merge:', err);
      alert(tArtifacts('mergeFailed'));
    } finally {
      setGitLoading(false);
    }
  };

  // Git discard branch
  const handleDiscardBranch = async () => {
    if (!taskId || !task?.gitBranch || gitLoading) return;
    if (!confirm(tArtifacts('confirmDiscard', { branch: task.gitBranch }))) return;
    setGitLoading(true);
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'discard' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(tArtifacts('discardFailedWithError', { error: data.error }));
        return;
      }
      fetchTask();
    } catch (err) {
      console.error('Failed to discard branch:', err);
      alert(tArtifacts('discardFailed'));
    } finally {
      setGitLoading(false);
    }
  };

  // SSE callbacks: update side panel in real-time
  const handlePlanExtracted = useCallback(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const handleUnderstandingExtracted = useCallback((u: TaskUnderstanding) => {
    setUnderstanding(u);
  }, []);

  const handleResultExtracted = useCallback((r: TaskResult) => {
    setResult(r);
  }, []);

  const handlePhaseChanged = useCallback((newPhase: SessionPhase) => {
    setPhase(newPhase);
  }, []);

  const handleBranchMerged = useCallback(() => {
    fetchTask();
    window.dispatchEvent(new CustomEvent('task-updated'));
  }, [fetchTask]);

  // Determine left panel content
  let leftContent: React.ReactNode;
  if (loading) {
    leftContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">{t('loading')}</p>
      </div>
    );
  } else if (!task) {
    leftContent = (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">{t('notFound')}</p>
      </div>
    );
  } else {
    leftContent = (
      <div className="flex h-full flex-col">
        <ConversationTabs
          conversations={conversationList}
          activeId={conversationId}
          onSelect={setConversationId}
          onNew={handleNewConversation}
          onArchive={handleArchiveConversation}
          onRestore={handleRestoreConversation}
          onPermanentDelete={handlePermanentDeleteConversation}
          onRename={handleRenameConversation}
        />
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            ref={chatRef}
            taskId={task.id}
            taskTitle={task.title}
            conversationId={conversationId}
            isFirstConversation={conversationList.length === 0}
            phase={phase}
            onPlanExtracted={handlePlanExtracted}
            onUnderstandingExtracted={handleUnderstandingExtracted}
            onResultExtracted={handleResultExtracted}
            onPhaseChanged={handlePhaseChanged}
            onBranchMerged={handleBranchMerged}
            onClearAll={handleClearAll}
            onStreamDone={handleStreamDone}
            onBranch={handleBranchConversation}
          />
        </div>
      </div>
    );
  }

  // Determine right panel content
  let rightContent: React.ReactNode;
  if (!task) {
    rightContent = null;
  } else {
    rightContent = (
      <ArtifactPanel
        task={task}
        onSaveTask={saveTask}
        understanding={understanding}
        plan={latestPlan}
        result={result}
        gitBranch={task.gitBranch}
        onSendMessage={handleSendMessage}
        onMerge={handleMerge}
        onDiscardBranch={handleDiscardBranch}
        mergeLoading={gitLoading}
      />
    );
  }

  const router = useRouter();

  // Source breadcrumb: show when task originated from a flow
  const flowCtx = task?.flowContext;

  const segmentClass = 'truncate rounded px-1 -mx-0.5 hover:bg-amber-100 hover:text-amber-800 dark:hover:bg-amber-900/30 dark:hover:text-amber-300 transition-colors cursor-pointer';

  let sourceBreadcrumb: React.ReactNode = null;
  if (flowCtx) {
    const baseUrl = `/flows?project=${flowCtx.projectKey}`;

    // Build breadcrumb segments with progressively specific URLs
    const segments: Array<{ label: string; url: string }> = [];
    segments.push({ label: flowCtx.projectName, url: baseUrl });

    if (isLegacyFlowContext(flowCtx)) {
      // Legacy format: project → flow → node → task
      const sectionUrl = `${baseUrl}&sectionId=${flowCtx.flowId}`;
      segments.push({ label: flowCtx.flowName, url: sectionUrl });
      segments.push({ label: flowCtx.nodeName, url: `${sectionUrl}&itemId=${flowCtx.nodeId}` });
      segments.push({ label: flowCtx.taskContent, url: `${sectionUrl}&itemId=${flowCtx.flowTaskId}` });
    } else {
      // New format: project → section → ancestors → task
      const sectionUrl = `${baseUrl}&sectionId=${flowCtx.sectionId}`;
      segments.push({ label: flowCtx.sectionName, url: sectionUrl });
      for (const ancestor of flowCtx.ancestors) {
        segments.push({ label: ancestor.content, url: `${sectionUrl}&itemId=${ancestor.id}` });
      }
      segments.push({ label: flowCtx.taskContent, url: `${sectionUrl}&itemId=${flowCtx.flowTaskId}` });
    }

    const highlightUrl = segments[segments.length - 1].url;

    sourceBreadcrumb = (
      <div className="flex w-full items-center gap-1 border-b border-zinc-100 bg-zinc-50/80 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
        <ArrowLeft
          className="h-3 w-3 shrink-0 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={() => router.push(highlightUrl)}
        />
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />}
            <span
              className={i === segments.length - 1 ? `${segmentClass} font-medium text-zinc-600 dark:text-zinc-400` : segmentClass}
              onClick={() => router.push(seg.url)}
            >
              {seg.label}
            </span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left: Chat Panel / Empty state */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {sourceBreadcrumb}
        <div className="flex-1 overflow-hidden">{leftContent}</div>
      </div>

      {/* Right: Artifact Side Panel */}
      <div
        className={cn(
          'shrink-0 overflow-hidden border-l border-zinc-200 bg-zinc-50 transition-[width] duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950',
          artifactOpen ? 'w-72' : 'w-0 border-l-0',
        )}
      >
        <div className="h-full w-72">{rightContent}</div>
      </div>
    </div>
  );
}
