import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import { ProjectProvider } from '@/components/project-context';

export const metadata: Metadata = {
  title: 'ProjectPilot',
  description: 'AI-powered project management and execution pilot',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <ThemeProvider>
      <NextIntlClientProvider messages={messages} locale={locale}>
        <ProjectProvider>
          {children}
        </ProjectProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
