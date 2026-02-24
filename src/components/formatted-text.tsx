import React from 'react';
import { PlanRenderer } from '@/components/plan-renderer';

/**
 * 轻量文本格式化组件
 * 支持：加粗、换行、列表，但不渲染大标题
 * 特殊处理：```json:plan 代码块会被渲染为友好的计划展示
 */

interface FormattedTextProps {
  text: string;
  className?: string;
}

export function FormattedText({ text, className = '' }: FormattedTextProps) {
  // 检测是否包含 json:plan 代码块
  const planMatch = text.match(/```json:plan\s*\n([\s\S]*?)```/);

  if (planMatch) {
    const planJson = planMatch[1].trim();
    const beforePlan = text.substring(0, planMatch.index);
    const afterPlan = text.substring(planMatch.index! + planMatch[0].length);

    return (
      <div className={className}>
        {beforePlan && <FormattedText text={beforePlan} className="" />}
        <div className="my-3">
          <PlanRenderer planJson={planJson} />
        </div>
        {afterPlan && <FormattedText text={afterPlan} className="" />}
      </div>
    );
  }

  const lines = text.split('\n');

  return (
    <div className={className}>
      {lines.map((line, lineIndex) => {
        // 空行
        if (!line.trim()) {
          return <div key={lineIndex} className="h-2" />;
        }

        // 无序列表 (- item)
        if (line.trim().startsWith('- ')) {
          const content = line.trim().substring(2);
          return (
            <div key={lineIndex} className="flex gap-2 text-sm">
              <span className="text-zinc-400 dark:text-zinc-500">•</span>
              <span className="flex-1">{formatInlineMarkdown(content)}</span>
            </div>
          );
        }

        // 有序列表 (1. item, 2. item)
        const orderedMatch = line.trim().match(/^(\d+)\.\s+(.+)$/);
        if (orderedMatch) {
          const [, number, content] = orderedMatch;
          return (
            <div key={lineIndex} className="flex gap-2 text-sm">
              <span className="text-zinc-400 dark:text-zinc-500 font-mono text-xs">{number}.</span>
              <span className="flex-1">{formatInlineMarkdown(content)}</span>
            </div>
          );
        }

        // 普通文本
        return (
          <p key={lineIndex} className="text-sm">
            {formatInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * 处理行内 markdown 格式（加粗、代码）
 */
function formatInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;

  // 匹配 **加粗** 和 `代码`
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 添加前面的普通文本
    if (match.index > currentIndex) {
      parts.push(text.substring(currentIndex, match.index));
    }

    // 添加格式化的部分
    if (match[2]) {
      // 加粗 **text**
      parts.push(
        <strong key={match.index} className="font-semibold text-zinc-900 dark:text-zinc-100">
          {match[2]}
        </strong>
      );
    } else if (match[4]) {
      // 代码 `text`
      parts.push(
        <code
          key={match.index}
          className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-xs font-mono"
        >
          {match[4]}
        </code>
      );
    }

    currentIndex = match.index + match[0].length;
  }

  // 添加剩余的普通文本
  if (currentIndex < text.length) {
    parts.push(text.substring(currentIndex));
  }

  return parts.length > 0 ? parts : text;
}
