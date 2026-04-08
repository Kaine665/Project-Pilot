import '@fontsource-variable/inter';
import { i18nInitPromise } from './i18n/config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../app/globals.css';

void i18nInitPromise.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// 便于在控制台排查：未挂载前若 init 失败可见
void i18nInitPromise.catch((e) => {
  console.error('[i18n] init failed', e);
});
