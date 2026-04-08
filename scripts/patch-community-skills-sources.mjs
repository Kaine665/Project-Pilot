/**
 * 为 community-skills-seed.json 各条写入 sourceNote / sourceNoteEn / sourceUrl（可选）。
 * 运行：node scripts/patch-community-skills-sources.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "src", "data", "community-skills-seed.json");

const BASE_ZH =
  "内容由 **ProjectPilot 仓库** 内置（`src/data/community-skills-seed.json`）。下列 Skill 正文由本项目编写，**非**从链接站点自动抓取全文；链接仅供查阅规范或产品文档。";
const BASE_EN =
  "Bundled in the **ProjectPilot** repo (`src/data/community-skills-seed.json`). The SKILL body is authored here and is **not** auto-scraped from the linked sites; URLs point to specs or product docs only.";

const EXTRA = {
  "pp-skill-commit": {
    zh: `${BASE_ZH}\n\n**参考**：Conventional Commits 约定。`,
    en: `${BASE_EN}\n\n**Reference**: Conventional Commits.`,
    url: "https://www.conventionalcommits.org/",
  },
  "pp-skill-pr-body": {
    zh: `${BASE_ZH}\n\n**参考**：GitHub 上关于 Pull Request 说明的文档。`,
    en: `${BASE_EN}\n\n**Reference**: GitHub docs on pull requests.`,
    url: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests",
  },
  "pp-skill-readme-section": {
    zh: `${BASE_ZH}\n\n**参考**：README 最佳实践（GitHub 文档）。`,
    en: `${BASE_EN}\n\n**Reference**: README best practices (GitHub).`,
    url: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes",
  },
  "pp-skill-openapi-stub": {
    zh: `${BASE_ZH}\n\n**参考**：OpenAPI Specification。`,
    en: `${BASE_EN}\n\n**Reference**: OpenAPI Specification.`,
    url: "https://spec.openapis.org/oas/latest.html",
  },
  "pp-skill-security-checklist": {
    zh: `${BASE_ZH}\n\n**参考**：OWASP 公开资料（清单为工程向摘要，非渗透报告）。`,
    en: `${BASE_EN}\n\n**Reference**: OWASP public materials (checklist is engineering guidance, not a pentest).`,
    url: "https://owasp.org/www-project-top-ten/",
  },
  "pp-skill-meeting-actions": {
    zh: `${BASE_ZH}\n\n**说明**：会议纪要结构化习惯因团队而异，本模板为通用写法。`,
    en: `${BASE_EN}\n\n**Note**: meeting note styles vary; this is a generic template.`,
    url: null,
  },
  "pp-skill-changelog-from-commits": {
    zh: `${BASE_ZH}\n\n**参考**：Keep a Changelog。`,
    en: `${BASE_EN}\n\n**Reference**: Keep a Changelog.`,
    url: "https://keepachangelog.com/",
  },
  "pp-skill-adr-stub": {
    zh: `${BASE_ZH}\n\n**参考**：Architecture Decision Records（adr.github.io）。`,
    en: `${BASE_EN}\n\n**Reference**: Architecture Decision Records (adr.github.io).`,
    url: "https://adr.github.io/",
  },
  "pp-skill-installer": {
    zh:
      "**模式说明**：对标社区常见的 *skill-installer* 流程（发现 / 校验 / 安装路径）。正文由 **ProjectPilot** 编写。可参考各产品公开的 Agent Skill 文档对照使用。",
    en:
      "**Pattern**: common *skill-installer* style flow (discover / validate / paths). Body authored by **ProjectPilot**. See vendor docs for how Skills work in each product.",
    url: "https://cursor.com/docs",
  },
  "pp-skill-creator": {
    zh:
      "**模式说明**：从零编写 `SKILL.md` 的脚手架提示。正文由 **ProjectPilot** 编写。可参考 OpenAI 对 Skills 的公开说明。",
    en:
      "**Pattern**: scaffold for authoring `SKILL.md`. Body by **ProjectPilot**. See OpenAI’s public Skills guide.",
    url: "https://platform.openai.com/docs/guides/skills",
  },
  "pp-skill-migrator": {
    zh:
      "**说明**：迁移步骤针对 **ProjectPilot** 数据目录与 `skill-store` 约定；若你从 Cursor 等环境搬运，请同时阅读对方官方文档中的 Skills 目录说明。",
    en:
      "**Note**: migration targets **ProjectPilot** layouts (`skill-store`). If copying from Cursor etc., read that product’s official Skills docs too.",
    url: "https://docs.cursor.com/context/skills",
  },
};

const j = JSON.parse(fs.readFileSync(p, "utf8"));
for (const it of j.items) {
  const e = EXTRA[it.id];
  if (!e) continue;
  it.sourceNote = e.zh;
  it.sourceNoteEn = e.en;
  if (e.url) it.sourceUrl = e.url;
  else delete it.sourceUrl;
}
fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8");
console.log("Patched", j.items.length, "skills with source fields");
