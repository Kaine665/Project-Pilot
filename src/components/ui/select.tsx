import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  placeholder?: string;
  onChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, onChange, value, ...props }, ref) => (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        'flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-900 shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100',
        className,
      )}
      {...props}
    >
      {placeholder && (
        <option value="" disabled className="bg-white text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          {opt.label}
        </option>
      ))}
    </select>
  ),
);
Select.displayName = 'Select';

export { Select };
