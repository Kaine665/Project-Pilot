import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
        'placeholder:text-zinc-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-zinc-700 dark:placeholder:text-zinc-500',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
