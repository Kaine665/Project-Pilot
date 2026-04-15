const REPO = 'https://github.com/Kaine665/Project-Pilot';

const flywheel = [
  { name: 'Memory', desc: '项目记忆与沉淀，让理解可累积。' },
  { name: 'Loader', desc: '开聊前自动拼装上下文，少写背景说明。' },
  { name: 'Runtime', desc: 'Agent 带着完整上下文执行。' },
  { name: 'Distiller', desc: '聊完提炼决策与约定（路线图中）。' },
  { name: 'Dashboard', desc: '一屏看见全局与下一步（路线图中）。' },
] as const;

const dimensions = ['工程', '产品', '设计', '商业', '增长', '运营'] as const;

const reality = [
  '每个新会话都要重新交代项目背景与约束。',
  '工程、产品、运营混在一起，却分散在多个工具里。',
  '买越多 SaaS，越要在「学工具」和「切窗口」上花时间。',
] as const;

const ppAnswers = [
  'Loader 与 Resource：把项目、文档、技能自动带进对话前上下文。',
  '六维结构 + 任务：用固定大维度承接真实 Builder 节奏，而不是只盯代码。',
  '本地优先的数据与编排：上下文留在你的机器与习惯工作流里。',
] as const;

const paradigm = [
  {
    label: '聊天框思维',
    meta: 'Task-centered',
    points: ['一轮一轮从零解释', '能力边界由产品预设', '上下文靠你手动投喂'],
  },
  {
    label: '工作台思维',
    meta: 'Project-centered',
    points: ['项目理解跨会话延续', 'Agent + 任务 + 触发器一起跑', '资源注册表自动装载'],
  },
] as const;

const levels = [
  {
    id: '00',
    title: '从 Agent 对话开始',
    subtitle: '先从一个能访问本地项目空间的聊天界面用起来。',
    bullets: ['多模型运行时（如 Claude / Codex）', 'Guest、Butler 等内置与自定义 Agent'],
  },
  {
    id: '01',
    title: '上下文自己长出来',
    subtitle: 'ResourceRegistry 在会话前拼装项目、文档与技能。',
    bullets: ['提示词分段与项目级 Prompt', '文档与知识形态统一收纳'],
  },
  {
    id: '02',
    title: '把推进接进同一处',
    subtitle: '待办、定时与事件触发，让「聊完即忘」变成可跟进的状态。',
    bullets: ['任务与调度（成熟度见仓库路线图）', '桌面端 Electron 一体化开发体验'],
  },
  {
    id: '03',
    title: '记忆飞轮转起来',
    subtitle: 'Distiller 与 Dashboard 在路线图中，目标是一边做一边沉淀全局视图。',
    bullets: ['五模块：Memory → Loader → Runtime → Distiller → Dashboard', '为「聊完即资产」铺路'],
  },
] as const;

const stackPills = ['Claude Agent SDK', 'OpenAI Codex', 'MCP', 'Hono', 'Vite + React', 'Electron'] as const;

const faq = [
  {
    q: 'ProjectPilot 是通用 Agent 平台吗？',
    a: '不是。它面向「推进你自己的项目」：上下文、文档、任务与多 Agent 编排，而不是做一个与项目无关的聊天机器人市场。',
  },
  {
    q: '和 Cursor / Claude Code 是什么关系？',
    a: '互补。PP 侧重项目记忆、装载与工作台编排；具体写代码、改文件仍可在你喜欢的 IDE 与 CLI 里完成，由你接入的模型与工具执行。',
  },
  {
    q: '数据存在哪里？',
    a: '默认以本地磁盘为主（详见仓库 README 与 docs/data-storage）。适合希望上下文留在自己环境下的 Builder。',
  },
  {
    q: '开源协议与参与方式？',
    a: '源码在 GitHub 公开维护。欢迎提 Issue、PR 以及在 README 指引下本地运行体验。',
  },
] as const;

export default function App() {
  return (
    <div className="pps">
      <div className="pps-bg" aria-hidden />
      <header className="pps-nav">
        <a className="pps-brand" href="#top">
          <span className="pps-logo" aria-hidden />
          <span>ProjectPilot</span>
        </a>
        <nav className="pps-nav-links" aria-label="页面内导航">
          <a href="#compare">痛点</a>
          <a href="#paradigm">范式</a>
          <a href="#levels">如何开始</a>
          <a href="#flywheel">飞轮</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="pps-btn pps-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      <main id="top">
        <section className="pps-hero">
          <p className="pps-tagline">本地优先的 Builder 工作台 · 开源</p>
          <h1 className="pps-title">
            <span className="pps-title-line">全维度的</span>{' '}
            <span className="pps-gradient">项目 AI 工作台</span>
          </h1>
          <p className="pps-lead">
            让 AI 对你的项目越来越懂，而不是每次从零开始。把工程、产品、设计、商业、增长与运营的上下文，接进同一套记忆与执行飞轮。
          </p>
          <div className="pps-hero-actions">
            <a className="pps-btn pps-btn-primary" href={REPO} target="_blank" rel="noreferrer">
              在 GitHub 上查看
            </a>
            <a className="pps-btn pps-btn-secondary" href={`${REPO}#readme`} target="_blank" rel="noreferrer">
              阅读 README
            </a>
          </div>
          <p className="pps-trust">适合独立 Builder、小团队创始人与「一人公司」式节奏的多线程推进。</p>
        </section>

        <section id="compare" className="pps-section pps-section--alt">
          <h2 className="pps-h2">为什么 Builder 需要的不是又一个「纯聊天」</h2>
          <p className="pps-sub">你的现实里角色很多，工具很碎；PP 想接住的是「项目」本身，而不是单条对话。</p>
          <div className="pps-compare">
            <div className="pps-compare-col pps-compare-col--muted">
              <h3 className="pps-compare-heading">常见痛点</h3>
              <ul>
                {reality.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="pps-compare-col pps-compare-col--accent">
              <h3 className="pps-compare-heading">ProjectPilot</h3>
              <ul>
                {ppAnswers.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="paradigm" className="pps-section">
          <h2 className="pps-h2">从「任务工具」到「项目伙伴」</h2>
          <p className="pps-sub mono">参考「以任务为中心」与「以用户与项目为中心」的对照思路，重新理解工作台该长什么样。</p>
          <div className="pps-paradigm">
            {paradigm.map((col) => (
              <div key={col.label} className="pps-paradigm-card">
                <p className="pps-paradigm-meta mono">{col.meta}</p>
                <h3>{col.label}</h3>
                <ul>
                  {col.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="levels" className="pps-section pps-section--alt">
          <h2 className="pps-h2">如何真正开始用起来</h2>
          <p className="pps-sub">像搭积木一样从简单界面起步，再按需要展开模块——与「先聊天、再长工作空间」的节奏一致。</p>
          <div className="pps-levels">
            {levels.map((L) => (
              <article key={L.id} className="pps-level">
                <div className="pps-level-head">
                  <span className="pps-level-id mono">{L.id}</span>
                  <div>
                    <h3>{L.title}</h3>
                    <p className="pps-level-sub">{L.subtitle}</p>
                  </div>
                </div>
                <ul>
                  {L.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="pps-section">
          <h2 className="pps-h2">与你已有的 AI 能力接在一起</h2>
          <p className="pps-sub">不锁死单一厂商；由你配置密钥与运行时（具体以仓库实现为准）。</p>
          <div className="pps-pills" role="list">
            {stackPills.map((name) => (
              <span key={name} className="pps-pill mono" role="listitem">
                {name}
              </span>
            ))}
          </div>
        </section>

        <section id="flywheel" className="pps-section pps-section--alt">
          <h2 className="pps-h2">五模块飞轮</h2>
          <p className="pps-sub mono">Memory → Loader → Runtime → Distiller → Dashboard</p>
          <ol className="pps-flywheel">
            {flywheel.map((m, i) => (
              <li key={m.name} className="pps-fly-item">
                <span className="pps-fly-index mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{m.name}</strong>
                  <p>{m.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="dimensions" className="pps-section">
          <h2 className="pps-h2">六维项目结构</h2>
          <p className="pps-sub">大维度固定、小板块可演进；任务与知识可跨维度关联。</p>
          <ul className="pps-dim-grid">
            {dimensions.map((d) => (
              <li key={d} className="pps-dim">
                {d}
              </li>
            ))}
          </ul>
        </section>

        <section className="pps-quote pps-section--alt">
          <blockquote>
            <p>
              个人与项目的上下文值得留在自己掌控的环境里。ProjectPilot 选择开源，方便你审计、分叉与把它接进自己的工作流。
            </p>
          </blockquote>
          <a className="pps-btn pps-btn-outline pps-quote-btn" href={REPO} target="_blank" rel="noreferrer">
            Star on GitHub
          </a>
        </section>

        <section id="faq" className="pps-section">
          <h2 className="pps-h2">常见问题</h2>
          <div className="pps-faq">
            {faq.map((item) => (
              <details key={item.q} className="pps-faq-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="pps-cta-band" aria-labelledby="cta-title">
          <h2 id="cta-title" className="pps-cta-title">
            准备把项目上下文接进同一工作台了吗？
          </h2>
          <p className="pps-cta-lead">克隆仓库、按 README 启动 Vite + Hono 或 Electron 开发模式，即可本地体验。</p>
          <div className="pps-hero-actions">
            <a className="pps-btn pps-btn-primary" href={REPO} target="_blank" rel="noreferrer">
              打开 GitHub 仓库
            </a>
            <a className="pps-btn pps-btn-secondary" href={`${REPO}/blob/main/docs/design/product-direction-and-dashboard.md`} target="_blank" rel="noreferrer">
              阅读产品设计文档
            </a>
          </div>
        </section>
      </main>

      <footer className="pps-footer">
        <p>
          <span className="mono">ProjectPilot</span> — 开源项目，欢迎 Issue 与 PR。
        </p>
        <a href={REPO} target="_blank" rel="noreferrer">
          {REPO}
        </a>
      </footer>
    </div>
  );
}
