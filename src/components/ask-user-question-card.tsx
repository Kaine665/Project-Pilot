'use client';

import { memo } from 'react';
import { CheckCircle2, Loader2, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import type { ChatToolCall } from '@/types';

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionItem {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionCardProps {
  toolCall: ChatToolCall;
}

/**
 * Specialized card for Claude Code's AskUserQuestion tool.
 *
 * In --dangerously-skip-permissions mode, AskUserQuestion is DENIED
 * by the CLI (is_error: true, output: "Answer questions?").
 * We detect this and show the question with clickable options so
 * the user can still answer by sending a chat message.
 */
export const AskUserQuestionCard = memo(function AskUserQuestionCard({ toolCall }: AskUserQuestionCardProps) {
  // Parse the input JSON
  let questions: QuestionItem[] = [];
  try {
    const input = JSON.parse(toolCall.input);
    questions = input.questions || [];
  } catch {
    return null;
  }

  if (questions.length === 0) return null;

  const isRunning = toolCall.status === 'running';
  const isCompleted = toolCall.status === 'completed';
  const isFailed = toolCall.status === 'failed';

  // In skip-permissions mode, AskUserQuestion is denied.
  // The output is "Answer questions?" and is_error=true → status='failed'.
  // We still show the question and let user answer via chat.
  const wasDenied = isFailed && toolCall.output?.includes('Answer questions');
  const canAnswer = isRunning || wasDenied;

  // Parse auto-response from output (for completed case)
  let autoResponse = '';
  if (isCompleted && toolCall.output) {
    try {
      const parsed = JSON.parse(toolCall.output);
      if (parsed?.answers) {
        autoResponse = Object.values(parsed.answers).join(', ');
      } else if (typeof parsed === 'string') {
        autoResponse = parsed;
      } else {
        autoResponse = toolCall.output.slice(0, 300);
      }
    } catch {
      autoResponse = toolCall.output.slice(0, 300);
    }
  }

  const handleOptionClick = (option: QuestionOption) => {
    window.dispatchEvent(
      new CustomEvent('ask-user-answer', {
        detail: { answer: option.label },
      }),
    );
  };

  return (
    <div className={`my-1.5 rounded-lg border ${
      wasDenied
        ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30'
        : 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/30'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : wasDenied ? (
          <ShieldAlert className="h-4 w-4 text-amber-500" />
        ) : (
          <MessageCircleQuestion className="h-4 w-4 text-indigo-500" />
        )}
        <span className={`text-xs font-medium ${
          wasDenied
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-indigo-700 dark:text-indigo-300'
        }`}>
          {isRunning
            ? 'AI 正在等待你的回答'
            : wasDenied
              ? 'AI 想问你一个问题'
              : 'AI 提问'}
        </span>
        {isCompleted && (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500" />
        )}
        {wasDenied && (
          <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            自动跳过
          </span>
        )}
      </div>

      {/* Questions */}
      <div className="space-y-3 px-3 pb-3">
        {questions.map((q, qi) => (
          <div key={qi}>
            {q.header && (
              <div className="mb-1 text-[10px] font-medium uppercase text-indigo-400">
                {q.header}
              </div>
            )}
            <p className="mb-2 text-sm text-zinc-800 dark:text-zinc-200">
              {q.question}
            </p>

            {/* Options */}
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  onClick={() => handleOptionClick(opt)}
                  disabled={!canAnswer}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    canAnswer
                      ? 'cursor-pointer border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-zinc-900 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50'
                      : 'cursor-default border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50'
                  }`}
                >
                  <div className="font-medium text-zinc-700 dark:text-zinc-300">{opt.label}</div>
                  {opt.description && (
                    <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">{opt.description}</div>
                  )}
                </button>
              ))}
            </div>

            {q.multiSelect && (
              <div className="mt-1 text-[10px] text-zinc-400">* 可多选</div>
            )}
          </div>
        ))}

        {/* Hint text */}
        {canAnswer && (
          <div className={`mt-1 text-[10px] ${wasDenied ? 'text-amber-500' : 'text-indigo-400'}`}>
            {wasDenied
              ? '权限系统已自动跳过此问题。点击选项或在输入框回答，AI 将收到你的回复。'
              : '点击选项回答，或在下方输入框自由输入'}
          </div>
        )}

        {/* Auto-response when completed normally */}
        {isCompleted && autoResponse && (
          <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
            <span className="font-medium">回复：</span>
            {autoResponse}
          </div>
        )}
      </div>
    </div>
  );
});
