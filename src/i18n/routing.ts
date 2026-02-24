import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['zh', 'en'],
  defaultLocale: 'zh',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];

export const { Link, usePathname, useRouter, redirect } = createNavigation(routing);
