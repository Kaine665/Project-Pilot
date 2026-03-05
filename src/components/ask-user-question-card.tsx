'use client';

import { memo, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircleQuestion } from 'lucide-react';
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
 * the user can answer by sending a chat message in the next turn.
 *
 * The "answered" state tracks whether the user has already clicked
 * an option, so the UI transitions from "waiting" to "answered".
 */
export const AskUserQuestionCard = memo(function AskUserQuestionCard({ toolCall }: AskUserQuestionCardProps) {
  const [answered, setAnswered] = useState<string | null>(null);

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
  // We treat this the same as "running" — show the question and let user answer.
  const wasDenied = isFailed && toolCall.output?.includes('Answer questions');
  const canAnswer = (isRunning || wasDenied) && !answered;

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
    setAnswered(option.label);
    window.dispatchEvent(
      new CustomEvent('ask-user-answer', {
        detail: { answer: option.label },
      }),
    );
  };

  return (
    <div className="my-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {(isRunning || (wasDenied && !answered)) ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : answered ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <MessageCircleQuestion className="h-4 w-4 text-indigo-500" />
        )}
        <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
          {answered
            ? 'AI 提问'
            : (isRunning || wasDenied)
              ? 'AI 想问你一个问题'
              : 'AI 提问'}
        </span>
        {(isCompleted || answered) && (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500" />
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
                    answered === opt.label
                      ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/50'
                      : canAnswer
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
          <div className="mt-1 text-[10px] text-indigo-400">
            点击选项回答，或在下方输入框自由输入
          </div>
        )}

        {/* User answered locally (waiting for next turn) */}
        {answered && (
          <div className="mt-2 rounded border border-green-200 bg-green-50 px-2 py-1.5 text-[10px] text-green-600 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            <span className="font-medium">已选择：</span>
            {answered}
          </div>
        )}

        {/* Auto-response when completed normally */}
        {isCompleted && autoResponse && !answered && (
          <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
            <span className="font-medium">回复：</span>
            {autoResponse}
          </div>
        )}
      </div>
    </div>
  );
});
