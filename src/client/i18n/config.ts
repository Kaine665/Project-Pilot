import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhMessages from './messages/zh.json';
import enMessages from './messages/en.json';

/** 等 init（含语言检测）完成后再 render，避免首屏 t() 未就绪而回显整串键名。 */
export const i18nInitPromise = Promise.resolve(
  i18next.use(LanguageDetector).use(initReactI18next).init({
    defaultNS: 'translation',
    ns: ['translation'],
    // 与 messages/*.json 的嵌套结构一致；部分环境下默认可能为 false，导致整段键无法解析
    keySeparator: '.',
    nsSeparator: ':',
    resources: {
      zh: { translation: zhMessages },
      en: { translation: enMessages },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    interpolation: {
      escapeValue: false,
      prefix: '{',
      suffix: '}',
    },
    // SPA 路由为 /workspace/*，路径首段不是 zh/en；勿用 path 检测。并归一化 localStorage 里可能存在的脏值（如 workspace）。
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      convertDetectedLanguage: (lng) => {
        const code = (lng || '').toLowerCase().split('-')[0];
        if (code === 'en') return 'en';
        return 'zh';
      },
    },
    react: {
      useSuspense: false,
    },
  }),
);

export default i18next;
