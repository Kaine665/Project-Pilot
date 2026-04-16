import { useEffect, useMemo, useState } from 'react';

const REPO = 'https://github.com/Kaine665/Project-Pilot';
const DOCS = `${REPO}/blob/main/docs/design/product-direction-and-dashboard.md`;
const RELEASES_LATEST = `${REPO}/releases/latest`;

type Locale = 'zh' | 'en';

const COPY: Record<
  Locale,
  {
    langBtn: string;
    heroTitle: string;
    heroLead: string;
    downloadMac: string;
    downloadWin: string;
    painTitle: string;
    painBody: string;
    painRows: [string, string];
    benefits: { title: string; body: string }[];
    positionTitle: string;
    positionLead: string;
    orbitLabel: string;
    bandTitle: string;
    slash1h: string;
    slash1p: string;
    slash2h: string;
    slash2p: string;
    quoteLabel: string;
    quoteText: string;
    faqLabel: string;
    faq: { q: string; a: string }[];
    finalTitle: string;
    finalDocs: string;
    footerMeta: string;
  }
> = {
  zh: {
    langBtn: '语言',
    heroTitle: 'ProjectPilot',
    heroLead:
      '让 AI 对你的项目越来越懂，而不是每次聊起来都像第一次见面。Builder 专属的项目上下文与推进中心。',
    downloadMac: '下载 macOS',
    downloadWin: '下载 Windows',
    painTitle: '上下文散落。',
    painBody:
      '对话一关，背景、决定、约定便散落在时间线中。你花费在解释「我们要做什么」上的时间，往往多过真正的构建。',
    painRows: ['每次新会话都要重新交代项目背景', '产品、设计、工程上下文分散在多处'],
    benefits: [
      {
        title: '更省事 —\n不重复讲故事',
        body: 'Loader 与 Resource 自动将文档、代码与技能装载，告别每次开聊前的「背景说明」长篇大论。',
      },
      {
        title: '更一致 —\n对齐决策与约定',
        body: 'AI 知道你们定了什么、在做什么。让理解在多个会话间持续积累，而不是原地踏步。',
      },
      {
        title: '更清楚 —\n全维度的推进感',
        body: '不仅是写代码。工程、产品、设计、增长，一屏看清全局进展与下一步路线图。',
      },
    ],
    positionTitle: '互补，而非二选一',
    positionLead: 'AI 像帮手，ProjectPilot 则是帮帮手记住项目的「工作空间」。',
    orbitLabel: '执行层 Execution AI',
    bandTitle: 'Builder 的克制与边界',
    slash1h: '不替代你的现有工具',
    slash1p: '写代码仍在 IDE，管理文档仍在 Notion。PP 负责连接它们，而非吞没它们。',
    slash2h: '不是又一个通用聊天框',
    slash2p: '我们不做机器人广场。我们专注「推进你手头那件事」的上下文。',
    quoteLabel: '核心价值观',
    quoteText: '“个人与项目的上下文，值得留在自己掌控的环境里。我们选择开源与本地优先。”',
    faqLabel: '常见问题 FAQ',
    faq: [
      {
        q: '和 Cursor / Claude Code 有什么区别？',
        a: '互补关系。它们侧重执行，PP 侧重记忆与跨会话的上下文装载。你可以用 PP 准备好上下文，然后在 IDE 中执行。',
      },
      {
        q: '数据存在哪里？',
        a: '默认以本地磁盘为主。适合希望上下文留在自己环境下的独立 Builder。',
      },
      {
        q: '是否支持团队协作？',
        a: '目前聚焦于单人或小团队的高密度推进。通过 Git 同步配置是推荐的协作方式。',
      },
      {
        q: '开源协议？',
        a: '在 GitHub 公开维护。欢迎审计、分叉或提交 PR，共同完善 Builder 工作流。',
      },
    ],
    finalTitle: '准备好开始沉淀了吗？',
    finalDocs: '阅读设计文档',
    footerMeta: 'Open source workbench · Built for builders',
  },
  en: {
    langBtn: 'Language',
    heroTitle: 'ProjectPilot',
    heroLead:
      'Help AI understand your project over time—not from scratch every chat. A project context and progress hub for builders.',
    downloadMac: 'Download for macOS',
    downloadWin: 'Download for Windows',
    painTitle: 'Context Scattering.',
    painBody:
      'When the chat ends, background, decisions, and agreements drift across timelines. You often spend more time re-explaining than building.',
    painRows: [
      'Every new session needs the project context explained again',
      'Product, design, and engineering context live in different tools',
    ],
    benefits: [
      {
        title: 'Less repetition —\nstop retelling the story',
        body: 'Loader and Resource pull docs, code, and skills in automatically—fewer long “here is our background” preambles.',
      },
      {
        title: 'More consistency —\nalign decisions',
        body: 'The model knows what you decided and what is in flight—understanding compounds across sessions.',
      },
      {
        title: 'Clearer progress —\nacross dimensions',
        body: 'Not only code—engineering, product, design, and growth in one place to see what is next.',
      },
    ],
    positionTitle: 'Complementary, not either-or',
    positionLead: 'AI tools execute; ProjectPilot is the workspace that helps them remember the project.',
    orbitLabel: 'Execution layer · Execution AI',
    bandTitle: 'Restraint and boundaries',
    slash1h: 'We do not replace your existing tools',
    slash1p: 'You still code in your IDE and write docs where you like—PP connects them instead of swallowing them.',
    slash2h: 'Not another generic chat box',
    slash2p: 'No bot marketplace—focus on context for the project you are actually pushing forward.',
    quoteLabel: 'Core values',
    quoteText:
      '“Project context deserves to live in an environment you control. We choose open source and local-first.”',
    faqLabel: 'FAQ',
    faq: [
      {
        q: 'How is this different from Cursor / Claude Code?',
        a: 'They focus on execution; PP focuses on memory and cross-session context loading. Prepare context in PP, then execute in your IDE.',
      },
      {
        q: 'Where does data live?',
        a: 'Primarily on local disk—suited to builders who want context to stay in their own environment.',
      },
      {
        q: 'Team collaboration?',
        a: 'Optimized for solo builders and small teams today; syncing configuration via Git is the recommended path.',
      },
      {
        q: 'License?',
        a: 'Maintained in public on GitHub—audits, forks, and PRs welcome.',
      },
    ],
    finalTitle: 'Ready to start compounding?',
    finalDocs: 'Read the product design doc',
    footerMeta: 'Open source workbench · Built for builders',
  },
};

const BENEFIT_ICONS = [IconBattery, IconBranch, IconLayout] as const;

function IconGithub({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function IconApple({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.47 2.35-1.46 3.08C14.34 5.83 13.17 5.3 13 3.5" />
    </svg>
  );
}

function IconWindows({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 5.5 11 4.2v7.3H3V5.5zm8-.3 10-1.5v9H11V5.2zM3 13.3h8v7.3l-8-1.2v-6.1zm9 0h10v9l-10-1.4v-7.6z" />
    </svg>
  );
}

function IconLayers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
    </svg>
  );
}

function IconBox({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBattery({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="1" y="6" width="18" height="12" rx="2" />
      <path d="M23 13v-2" />
    </svg>
  );
}

function IconBranch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLayout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconSlash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </svg>
  );
}

function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>('zh');
  const t = useMemo(() => COPY[locale], [locale]);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  return (
    <div className="ppm">
      <div className="ppm-texture" aria-hidden />

      <header className="ppm-nav">
        <div className="ppm-layout-inner ppm-nav-inner">
          <a className="ppm-brand" href="#top">
            <span className="ppm-logo" aria-hidden>
              <IconLayers className="ppm-logo-svg" />
            </span>
            <span className="ppm-brand-text">ProjectPilot</span>
          </a>
          <div className="ppm-nav-end">
            <button
              type="button"
              className="ppm-nav-lang-btn"
              aria-label={locale === 'zh' ? '切换为英文界面' : 'Switch to Chinese interface'}
              onClick={() => setLocale((prev) => (prev === 'zh' ? 'en' : 'zh'))}
            >
              {t.langBtn}
            </button>
            <a className="ppm-nav-gh" href={REPO} target="_blank" rel="noreferrer">
              <IconGithub className="ppm-nav-gh-icon" />
              GitHub
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="ppm-hero">
          <div className="ppm-layout-inner">
            <h1 className="ppm-hero-title">{t.heroTitle}</h1>
            <p className="ppm-hero-lead">{t.heroLead}</p>
            <div className="ppm-hero-actions">
              <a
                className="ppm-dl-btn"
                href={RELEASES_LATEST}
                target="_blank"
                rel="noreferrer"
                aria-label={`${t.downloadMac} — GitHub Releases`}
              >
                <IconApple className="ppm-dl-icon" />
                {t.downloadMac}
              </a>
              <a
                className="ppm-dl-btn"
                href={RELEASES_LATEST}
                target="_blank"
                rel="noreferrer"
                aria-label={`${t.downloadWin} — GitHub Releases`}
              >
                <IconWindows className="ppm-dl-icon" />
                {t.downloadWin}
              </a>
            </div>
          </div>
        </section>

        <section id="pain" className="ppm-section">
          <div className="ppm-layout-inner">
            <div className="ppm-pain-grid">
            <div>
              <h2 className="ppm-h2">{t.painTitle}</h2>
              <p className="ppm-muted-lg">{t.painBody}</p>
              <ul className="ppm-pain-list">
                {t.painRows.map((row) => (
                  <li key={row} className="ppm-pain-row">
                    <IconAlert className="ppm-pain-icon" />
                    <span>{row}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ppm-visual">
              <div className="ppm-visual-inner">
                <div className="ppm-visual-chaos ppm-visual-chaos-a" />
                <div className="ppm-visual-chaos ppm-visual-chaos-b" />
                <div className="ppm-visual-core">
                  <span className="ppm-visual-core-icon">
                    <IconBox className="ppm-visual-box" />
                  </span>
                  <span className="ppm-visual-core-title">Project Memory</span>
                  <div className="ppm-visual-bars">
                    <span className="ppm-visual-bar">
                      <span className="ppm-visual-bar-fill" style={{ width: '66%' }} />
                    </span>
                    <span className="ppm-visual-bar">
                      <span className="ppm-visual-bar-fill" style={{ width: '50%' }} />
                    </span>
                  </div>
                </div>
                <svg className="ppm-visual-lines" viewBox="0 0 100 100" aria-hidden>
                  <path d="M20,20 L50,50" fill="none" stroke="currentColor" strokeWidth="0.35" />
                  <path d="M80,20 L50,50" fill="none" stroke="currentColor" strokeWidth="0.35" />
                  <path d="M20,80 L50,50" fill="none" stroke="currentColor" strokeWidth="0.35" />
                  <path d="M80,80 L50,50" fill="none" stroke="currentColor" strokeWidth="0.35" />
                </svg>
              </div>
            </div>
            </div>
          </div>
        </section>

        <section id="benefits" className="ppm-section">
          <div className="ppm-layout-inner">
            <div className="ppm-benefits-card">
            <div className="ppm-benefits-grid">
              {t.benefits.map((b, i) => {
                const Icon = BENEFIT_ICONS[i];
                return (
                  <div key={b.title} className="ppm-benefit">
                    <span className="ppm-benefit-icon-wrap">
                      <Icon className="ppm-benefit-icon" />
                    </span>
                    <h3 className="ppm-benefit-title">{b.title}</h3>
                    <p className="ppm-benefit-body">{b.body}</p>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </section>

        <section id="position" className="ppm-section ppm-center">
          <div className="ppm-layout-inner">
            <h2 className="ppm-h2">{t.positionTitle}</h2>
            <p className="ppm-muted-lg">{t.positionLead}</p>
            <div className="ppm-orbit-wrap">
              <div className="ppm-orbit-label mono">{t.orbitLabel}</div>
              <div className="ppm-orbit">
                <span className="ppm-orbit-tag ppm-orbit-tag-a">Claude / IDE</span>
                <span className="ppm-orbit-tag ppm-orbit-tag-b">CLI Tools</span>
                <span className="ppm-orbit-tag ppm-orbit-tag-c">Agents</span>
                <div className="ppm-orbit-core">
                  <IconTarget className="ppm-orbit-core-icon" />
                  <h4 className="ppm-orbit-core-title">Project Memory</h4>
                  <p className="ppm-orbit-core-meta mono">Loader · Distiller · Dashboard</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="ppm-band">
          <div className="ppm-layout-inner">
            <div className="ppm-band-grid">
              <div>
                <h2 className="ppm-h2">{t.bandTitle}</h2>
                <ul className="ppm-slash-list">
                  <li>
                    <IconSlash className="ppm-slash-icon" />
                    <div>
                      <h4 className="ppm-slash-h">{t.slash1h}</h4>
                      <p className="ppm-slash-p">{t.slash1p}</p>
                    </div>
                  </li>
                  <li>
                    <IconSlash className="ppm-slash-icon" />
                    <div>
                      <h4 className="ppm-slash-h">{t.slash2h}</h4>
                      <p className="ppm-slash-p">{t.slash2p}</p>
                    </div>
                  </li>
                </ul>
              </div>
              <blockquote className="ppm-quote-card">
                <p className="mono ppm-quote-label">{t.quoteLabel}</p>
                <p className="ppm-quote-text">{t.quoteText}</p>
                <div className="ppm-quote-foot">
                  <span className="ppm-quote-avatar" aria-hidden />
                  <span className="ppm-quote-team">ProjectPilot</span>
                </div>
              </blockquote>
            </div>
          </div>
        </section>

        <section id="faq" className="ppm-section">
          <div className="ppm-layout-inner">
            <h2 className="ppm-faq-label mono">{t.faqLabel}</h2>
            <div className="ppm-faq-grid">
              {t.faq.map((item) => (
                <div key={item.q}>
                  <h4 className="ppm-faq-q">{item.q}</h4>
                  <p className="ppm-faq-a">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="ppm-final-cta" aria-labelledby="final-cta">
          <div className="ppm-layout-inner">
            <h2 id="final-cta" className="ppm-final-title">
              {t.finalTitle}
            </h2>
            <div className="ppm-final-actions">
              <a className="ppm-btn ppm-btn-on-dark" href={REPO} target="_blank" rel="noreferrer">
                GitHub Repository
              </a>
              <a className="ppm-link-on-dark" href={DOCS} target="_blank" rel="noreferrer">
                {t.finalDocs}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="ppm-footer">
        <div className="ppm-layout-inner ppm-footer-inner">
          <div className="ppm-footer-brand">
            <span className="ppm-footer-mark mono" aria-hidden>
              PP
            </span>
            <span className="ppm-footer-name">ProjectPilot</span>
          </div>
          <p className="ppm-footer-meta mono">{t.footerMeta}</p>
          <a className="ppm-footer-gh" href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub">
            <IconGithub className="ppm-footer-gh-icon" />
          </a>
        </div>
      </footer>
    </div>
  );
}
