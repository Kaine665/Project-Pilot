'use client';

import { memo, useState, useCallback } from 'react';
import { CheckCircle2, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
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
 * Supports multiple questions — each question has independent option
 * selection. For a single question, clicking an option submits immediately.
 * For multiple questions, a "Submit" button appears after all questions
 * have been answered.
 *
 * Answer format (sent as next-turn message):
 * - Single question: "option label"
 * - Multiple questions: "Q1: option1\nQ2: option2"
 */
export const AskUserQuestionCard = memo(function AskUserQuestionCard({ toolCall }: AskUserQuestionCardProps) {
  // Per-question selections: { questionIndex → selected option label }
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Parse the input JSON
  let questions: QuestionItem[] = [];
  try {
    const input = JSON.parse(toolCall.input);
    questions = Array.isArray(input.questions) ? input.questions : [];
  } catch {
    return null;
  }

  if (questions.length === 0) return null;

  const isRunning = toolCall.status === 'running';
  const isCompleted = toolCall.status === 'completed';
  const isFailed = toolCall.status === 'failed';

  const wasDenied = isFailed && toolCall.output?.includes('Answer questions');
  const isAnswerable = (isRunning || wasDenied) && !submitted;
  const isSingleQuestion = questions.length === 1;
  const allAnswered = questions.every((_, i) => selections[i] !== undefined);

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

  const dispatchAnswer = useCallback((answer: string) => {
    window.dispatchEvent(
      new CustomEvent('ask-user-answer', {
        detail: { answer },
      }),
    );
  }, []);

  const handleOptionClick = useCallback((questionIndex: number, option: QuestionOption) => {
    if (!isAnswerable) return;

    if (isSingleQuestion) {
      // Single question → submit immediately
      setSelections({ 0: option.label });
      setSubmitted(true);
      dispatchAnswer(option.label);
    } else {
      // Multiple questions → just select, wait for submit button
      setSelections(prev => ({ ...prev, [questionIndex]: option.label }));
    }
  }, [isAnswerable, isSingleQuestion, dispatchAnswer]);

  const handleSubmit = useCallback(() => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);

    // Format: "Q1 header: answer\nQ2 header: answer"
    const parts = questions.map((q, i) => {
      const label = q.header || q.question.slice(0, 30);
      return `${label}: ${selections[i]}`;
    });
    dispatchAnswer(parts.join('\n'));
  }, [allAnswered, submitted, questions, selections, dispatchAnswer]);

  return (
    <div className="my-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {(isAnswerable && !allAnswered) ? (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
        ) : (submitted || isCompleted) ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <MessageCircleQuestion className="h-4 w-4 text-indigo-500" />
        )}
        <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
          {submitted
            ? 'AI 提问'
            : isAnswerable
              ? 'AI 想问你一个问题'
              : 'AI 提问'}
        </span>
        {(isCompleted || submitted) && (
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
                  onClick={() => handleOptionClick(qi, opt)}
                  disabled={!isAnswerable}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    selections[qi] === opt.label
                      ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/50'
                      : isAnswerable
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

        {/* Submit button for multi-question */}
        {!isSingleQuestion && isAnswerable && (
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              allAnswered
                ? 'cursor-pointer bg-indigo-500 text-white hover:bg-indigo-600'
                : 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
            }`}
          >
            <Send className="h-3 w-3" />
            {allAnswered ? '提交回答' : `还有 ${questions.length - Object.keys(selections).length} 个问题未回答`}
          </button>
        )}

        {/* Hint text */}
        {isAnswerable && isSingleQuestion && (
          <div className="mt-1 text-[10px] text-indigo-400">
            点击选项回答，或在下方输入框自由输入
          </div>
        )}

        {/* Submitted summary */}
        {submitted && (
          <div className="mt-2 rounded border border-green-200 bg-green-50 px-2 py-1.5 text-[10px] text-green-600 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            <span className="font-medium">已回答：</span>
            {isSingleQuestion
              ? selections[0]
              : questions.map((q, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {q.header || q.question.slice(0, 15)}: {selections[i]}
                  </span>
                ))
            }
          </div>
        )}

        {/* Auto-response when completed normally */}
        {isCompleted && autoResponse && !submitted && (
          <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
            <span className="font-medium">回复：</span>
            {autoResponse}
          </div>
        )}
      </div>
    </div>
  );
});
