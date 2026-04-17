import { useEffect, useState } from 'react';

/**
 * 订阅 matchMedia，用于响应式布局（SSR 默认 false，与 Tailwind mobile-first 一致）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
