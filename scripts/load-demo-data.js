#!/usr/bin/env node

/**
 * 导入示例数据脚本
 * 用于快速加载 demo 数据到 ProjectPilot
 *
 * Usage:
 *   node scripts/load-demo-data.js       # 加载中文版
 *   node scripts/load-demo-data.js en    # 加载英文版
 */

const fs = require('fs');
const path = require('path');

// 检查语言参数
const lang = process.argv[2] === 'en' ? 'en' : 'zh';
const langName = lang === 'en' ? 'English' : '中文';
const suffix = lang === 'en' ? '-en' : '';

const DEMO_DATA_PATH = path.join(__dirname, `../examples/personal-blog/demo-data${suffix}.json`);
const TARGET_DIR = path.join(__dirname, '../data/flows');
const TARGET_FILE = path.join(TARGET_DIR, `demo-blog${suffix}.json`);

console.log(`🚀 ProjectPilot Demo Data Loader (${langName})\n`);

// 检查示例数据文件是否存在
if (!fs.existsSync(DEMO_DATA_PATH)) {
  console.error('❌ 错误: 找不到示例数据文件');
  console.error(`   路径: ${DEMO_DATA_PATH}`);
  process.exit(1);
}

// 确保目标目录存在
if (!fs.existsSync(TARGET_DIR)) {
  console.log('📁 创建 data/flows 目录...');
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// 读取示例数据
console.log('📖 读取示例数据...');
const demoData = JSON.parse(fs.readFileSync(DEMO_DATA_PATH, 'utf-8'));

// 检查是否已存在
if (fs.existsSync(TARGET_FILE)) {
  console.log(`\n⚠️  Warning: demo-blog${suffix}.json already exists`);
  console.log('   Auto-overwrite enabled');
}

// 写入文件
console.log('\n💾 导入示例数据...');
fs.writeFileSync(TARGET_FILE, JSON.stringify(demoData, null, 2));

console.log('\n✅ Demo data loaded successfully!');
console.log('\n📋 Imported content:');
console.log(`   - Flow: ${demoData.flow.name}`);
console.log(`   - Nodes: ${demoData.flow.nodes.length}`);
console.log(`   - Tasks: ${demoData.flow.nodes.reduce((sum, node) => sum + node.tasks.length, 0)}`);
console.log(`   - Sessions: ${demoData.sessions.length}`);
console.log(`   - Language: ${langName}`);

console.log('\n🎯 Next steps:');
console.log('   1. Start app: npm run dev');
console.log(`   2. Visit: http://localhost:4287/${lang}`);
console.log(`   3. View "${demoData.flow.name}" Flow`);
console.log('   4. Start recording your demo!\n');

console.log('💡 Tip: Check examples/personal-blog/DEMO_SCRIPT.md for recording guide');
