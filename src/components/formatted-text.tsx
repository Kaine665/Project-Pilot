import React, { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PlanRenderer } from '@/components/plan-renderer';

/**
 * Markdown 文本格式化组件
 * 使用 react-markdown 渲染完整的 GitHub Flavored Markdown
 * 特殊处理：```json:plan 代码块会被渲染为友好的计划展示
 */

// Extract plain text from React children (for copy button)
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractText((node as any).props.children);
  }
  return '';
}

// Code block with copy button
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = extractText(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [children]);

  return (
    <div className="relative my-2">
      <button
        onClick={handleCopy}
        className={`absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
          copied
            ? 'bg-green-600 text-white'
            : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
        }`}
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="overflow-x-auto rounded-md bg-zinc-900 dark:bg-zinc-950 p-3 pr-14 text-xs text-zinc-100">
        {children}
      </pre>
    </div>
  );
}

interface FormattedTextProps {
  text: string;
  className?: string;
}

export const FormattedText = memo(function FormattedText({ text, className = '' }: FormattedTextProps) {
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

  return (
    <div className={`${className} formatted-markdown`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings — render as bold text, not huge headers (chat context)
          h1: ({ children }) => (
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-3 mb-1">
              {children}
            </p>
          ),
          h2: ({ children }) => (
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-3 mb-1">
              {children}
            </p>
          ),
          h3: ({ children }) => (
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-2 mb-1">
              {children}
            </p>
          ),
          h4: ({ children }) => (
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-2 mb-1">
              {children}
            </p>
          ),
          // Paragraph
          p: ({ children }) => (
            <p className="text-sm leading-relaxed mb-1.5 last:mb-0">{children}</p>
          ),
          // Bold
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              {children}
            </strong>
          ),
          // Inline code
          code: ({ className: codeClassName, children, ...props }) => {
            // Multi-line code block (rendered by <pre><code>)
            const isBlock = codeClassName?.startsWith('language-');
            if (isBlock) {
              return (
                <code className={`${codeClassName ?? ''} text-xs`} {...props}>
                  {children}
                </code>
              );
            }
            // Inline code
            return (
              <code className="rounded bg-zinc-200/70 dark:bg-zinc-700 px-1 py-0.5 text-xs font-mono text-zinc-800 dark:text-zinc-200">
                {children}
              </code>
            );
          },
          // Code block wrapper with copy button
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          // Unordered list
          ul: ({ children }) => (
            <ul className="my-1 space-y-0.5 pl-4 text-sm list-disc marker:text-zinc-400 dark:marker:text-zinc-500">
              {children}
            </ul>
          ),
          // Ordered list
          ol: ({ children }) => (
            <ol className="my-1 space-y-0.5 pl-4 text-sm list-decimal marker:text-zinc-400 dark:marker:text-zinc-500">
              {children}
            </ol>
          ),
          // List item
          li: ({ children }) => (
            <li className="text-sm leading-relaxed">{children}</li>
          ),
          // Table
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-zinc-100 dark:bg-zinc-800">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left font-semibold text-zinc-700 dark:text-zinc-300">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-zinc-600 dark:text-zinc-400">
              {children}
            </td>
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {children}
            </a>
          ),
          // Horizontal rule
          hr: () => (
            <hr className="my-2 border-zinc-200 dark:border-zinc-700" />
          ),
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 text-sm text-zinc-500 dark:text-zinc-400 italic">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
