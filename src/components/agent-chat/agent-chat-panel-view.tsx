import type { ReactNode, RefObject } from 'react';

type AgentChatPanelViewProps = {
  hasProject: boolean;
  isFull: boolean;
  projectKey?: string | null;
  selectProjectHint: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onChatScroll: () => void;
  hasPendingQueue: boolean;
  plainScrollClassName?: string;
  projectScrollClassName?: string;
  plainToolbar: ReactNode;
  showPlainEmptyState: boolean;
  plainEmptyState: ReactNode;
  plainMessageList: ReactNode;
  plainInput: ReactNode;
  projectHeader: ReactNode;
  projectTaskBanner: ReactNode;
  showProjectEmptyState: boolean;
  projectEmptyState: ReactNode;
  projectMessageList: ReactNode;
  projectInput: ReactNode;
  timeline?: ReactNode;
  queueOverlay: ReactNode;
  notificationBanners: ReactNode;
  dialogs: ReactNode;
  configDrawer: ReactNode;
  runtimeDrawer: ReactNode;
  folderExplorer: ReactNode;
  planPanel: ReactNode;
  actionPanel: ReactNode;
  sidebar: ReactNode;
};

export function AgentChatPanelView({
  hasProject,
  isFull,
  projectKey,
  selectProjectHint,
  scrollRef,
  onChatScroll,
  hasPendingQueue,
  plainScrollClassName,
  projectScrollClassName,
  plainToolbar,
  showPlainEmptyState,
  plainEmptyState,
  plainMessageList,
  plainInput,
  projectHeader,
  projectTaskBanner,
  showProjectEmptyState,
  projectEmptyState,
  projectMessageList,
  projectInput,
  timeline,
  queueOverlay,
  notificationBanners,
  dialogs,
  configDrawer,
  runtimeDrawer,
  folderExplorer,
  planPanel,
  actionPanel,
  sidebar,
}: AgentChatPanelViewProps) {
  if (!hasProject) {
    return (
      <div className="flex h-full">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {plainToolbar}

          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onChatScroll}
              className={`h-full space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none] ${plainScrollClassName ?? 'p-4'} ${hasPendingQueue ? 'pb-44' : ''}`}
            >
              {showPlainEmptyState ? plainEmptyState : plainMessageList}
            </div>

            {timeline ?? null}
            {hasPendingQueue ? queueOverlay : null}
          </div>

          {notificationBanners}
          {plainInput}
          {dialogs}
        </div>
        {configDrawer}
        {runtimeDrawer}
        {folderExplorer}
        {planPanel}
        {actionPanel}
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <p className="text-xs text-zinc-400">{selectProjectHint}</p>
      </div>
    );
  }

  const chatArea = (
    <div className="flex h-full">
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {projectHeader}

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onChatScroll}
            className={`h-full space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none] ${projectScrollClassName ?? 'p-3'} ${hasPendingQueue ? 'pb-44' : ''}`}
          >
            {projectTaskBanner}
            {showProjectEmptyState ? projectEmptyState : projectMessageList}
          </div>

          {timeline ?? null}
          {hasPendingQueue ? queueOverlay : null}
        </div>

        {projectInput}
        {notificationBanners}
        {dialogs}
      </div>
      {configDrawer}
      {runtimeDrawer}
      {planPanel}
      {actionPanel}
    </div>
  );

  if (isFull) {
    return (
      <div className="flex h-full w-full">
        {sidebar}
        <div className="min-w-0 flex-1">{chatArea}</div>
      </div>
    );
  }

  return chatArea;
}
