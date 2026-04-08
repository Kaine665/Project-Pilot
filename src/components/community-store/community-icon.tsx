'use client';

import {
  BookOpen,
  Bot,
  Database,
  Globe,
  LayoutGrid,
  Rocket,
  Search,
  Shield,
  Terminal,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  bot: Bot,
  database: Database,
  globe: Globe,
  'layout-grid': LayoutGrid,
  rocket: Rocket,
  search: Search,
  shield: Shield,
  terminal: Terminal,
  users: Users,
  wrench: Wrench,
};

export function CommunityIcon({
  name,
  className,
  size = 'md',
}: {
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const I = (name && ICON_MAP[name]) || Bot;
  const sz = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-5 w-5' : 'h-10 w-10';
  return <I className={cn(sz, 'shrink-0 text-zinc-600 dark:text-zinc-300', className)} aria-hidden />;
}
