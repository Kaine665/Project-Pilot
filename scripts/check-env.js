#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  console.log(`⚠️  ${message}`);
}

function fail(message) {
  console.log(`❌ ${message}`);
}

function parseMajor(version) {
  const match = String(version).match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function commandExists(command, args = ['--version']) {
  try {
    const out = execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return String(out).trim();
  } catch {
    return null;
  }
}

let hasFailure = false;

printSection('Runtime');
const nodeVersion = process.version;
const nodeMajor = parseMajor(nodeVersion);
if (nodeMajor >= 18) {
  ok(`Node.js ${nodeVersion}`);
} else {
  fail(`Node.js ${nodeVersion} 过低，至少需要 Node.js 18+`);
  hasFailure = true;
}

const npmVersion = commandExists('npm', ['--version']);
if (npmVersion) {
  ok(`npm ${npmVersion}`);
} else {
  fail('npm 不可用');
  hasFailure = true;
}

const gitVersion = commandExists('git', ['--version']);
if (gitVersion) {
  ok(gitVersion);
} else {
  fail('Git 未安装或不在 PATH 中');
  hasFailure = true;
}

printSection('Claude Code CLI');
const claudePathOverride = process.env.CLAUDE_CLI_PATH;
if (claudePathOverride) {
  if (fs.existsSync(claudePathOverride)) {
    ok(`CLAUDE_CLI_PATH 已设置: ${claudePathOverride}`);
  } else {
    fail(`CLAUDE_CLI_PATH 指向的文件不存在: ${claudePathOverride}`);
    hasFailure = true;
  }
}

const claudeVersion = commandExists('claude', ['--version']);
if (claudeVersion) {
  ok(`claude ${claudeVersion}`);
} else {
  warn('未检测到 Claude Code CLI；AI 执行能力可能不可用');
  warn('安装命令: npm install -g @anthropic-ai/claude-code');
}

printSection('Data directory');
const dataDir = process.env.PROJECT_PILOT_DATA_DIR || path.join(os.homedir(), '.project-pilot', 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
  ok(`数据目录可读写: ${dataDir}`);
} catch (error) {
  fail(`数据目录不可用: ${dataDir}`);
  fail(error instanceof Error ? error.message : String(error));
  hasFailure = true;
}

printSection('Platform notes');
if (process.platform === 'darwin') {
  ok('当前平台: macOS');
  const xcode = commandExists('xcode-select', ['-p']);
  if (xcode) {
    ok(`Xcode Command Line Tools: ${xcode}`);
  } else {
    warn('未检测到 Xcode Command Line Tools；部分原生依赖或打包流程可能受影响');
    warn('安装命令: xcode-select --install');
  }
} else if (process.platform === 'win32') {
  ok('当前平台: Windows');
  warn('Windows 打包前请确认 PowerShell、Git、Node 全部可从 PATH 调用');
} else {
  ok(`当前平台: ${process.platform}`);
}

printSection('Summary');
if (hasFailure) {
  fail('环境检查未通过，请先修复上面的错误项。');
  process.exit(1);
}

ok('环境检查通过。你可以继续运行 npm run dev / npm run electron:dev / npm run dist:mac 或 dist:win');
