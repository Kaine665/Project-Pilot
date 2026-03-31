/**
 * Compatibility shim: next-intl's useTranslations → react-i18next's useTranslation.
 * Existing code calls:
 *   const t = useTranslations('nav');
 *   t('projects');  // → next-intl looks up messages.nav.projects
 *
 * This shim replicates that by prepending the namespace to the key:
 *   t('nav.projects') in i18next
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type TranslateFunction = (key: string, values?: Record<string, unknown>) => string;

/** Current app locale (`zh` | `en`), aligned with next-intl's useLocale. */
export function useLocale(): 'zh' | 'en' {
  const { i18n } = useTranslation();
  const code = (i18n.resolvedLanguage ?? i18n.language ?? 'zh')
    .toLowerCase()
    .split('-')[0];
  return code === 'en' ? 'en' : 'zh';
}

export function useTranslations(namespace?: string): TranslateFunction {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!namespace) return t as TranslateFunction;
    return (key: string, values?: Record<string, unknown>) =>
      t(`${namespace}.${key}`, values as Record<string, string>) as string;
  }, [namespace, t]);
}
