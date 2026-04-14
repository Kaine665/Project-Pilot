import type { ReactNode, RefObject } from 'react';
import { AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX } from '@/lib/agents-workspace-ui-shared';

/** 正文区最大宽度（宽屏可读性，与常见文档栏一致） */
const CHAT_MAIN_MAX_WIDTH_PX = 1080;
/** 消息列表滚动区最小宽度；与视口取 min 以免过窄屏横向溢出（与 Agents 页 `AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX` 一致） */
const CHAT_SCROLL_MIN_WIDTH_CLASS = `min-w-[min(100%,${AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX}px)]`;

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
  artifactsDrawer: ReactNode;
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
  artifactsDrawer,
  folderExplorer,
  planPanel,
  actionPanel,
  sidebar,
}: AgentChatPanelViewProps) {
  if (!hasProject) {
    return (
      <div className="flex h-full min-h-0 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
          <div
            className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col"
            style={{ maxWidth: CHAT_MAIN_MAX_WIDTH_PX }}
          >
            {plainToolbar}

            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={onChatScroll}
                className={`pp-scrollbar-hover-chat h-full ${CHAT_SCROLL_MIN_WIDTH_CLASS} space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none] ${plainScrollClassName ?? 'p-4'} ${hasPendingQueue ? 'pb-44' : ''}`}
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
        </div>
        {configDrawer}
        {runtimeDrawer}
        {artifactsDrawer}
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
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
        <div
          className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col"
          style={{ maxWidth: CHAT_MAIN_MAX_WIDTH_PX }}
        >
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
            {projectHeader}

            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={onChatScroll}
                className={`pp-scrollbar-hover-chat h-full ${CHAT_SCROLL_MIN_WIDTH_CLASS} space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none] ${projectScrollClassName ?? 'p-3'} ${hasPendingQueue ? 'pb-44' : ''}`}
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
        </div>
      </div>
      {configDrawer}
      {runtimeDrawer}
      {artifactsDrawer}
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
