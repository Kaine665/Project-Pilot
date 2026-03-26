import * as React from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui 风格分隔线（纯 Tailwind，无额外依赖） */
const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: 'horizontal' | 'vertical';
    decorative?: boolean;
  }
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <div
    ref={ref}
    role={decorative ? 'none' : 'separator'}
    aria-orientation={decorative ? undefined : orientation}
    aria-hidden={decorative}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';

export { Separator };
