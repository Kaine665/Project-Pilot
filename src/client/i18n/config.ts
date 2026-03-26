import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhMessages from '../../../messages/zh.json';
import enMessages from '../../../messages/en.json';

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zhMessages },
      en: { translation: enMessages },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    interpolation: {
      escapeValue: false,
      // Align with messages/*.json placeholders (`{name}`, `{count}`) — i18next default is `{{name}}`.
      prefix: '{',
      suffix: '}',
    },
    detection: {
      order: ['path', 'localStorage', 'navigator'],
      lookupFromPathIndex: 0,
    },
  });

export default i18next;
