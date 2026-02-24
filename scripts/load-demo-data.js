#!/usr/bin/env node

/**
 * 导入示例数据脚本
 * 用于快速加载 demo 数据到 ProjectPilot
 */

const fs = require('fs');
const path = require('path');

const DEMO_DATA_PATH = path.join(__dirname, '../examples/personal-blog/demo-data.json');
const TARGET_DIR = path.join(__dirname, '../data/flows');
const TARGET_FILE = path.join(TARGET_DIR, 'demo-blog.json');

console.log('🚀 ProjectPilot Demo 数据导入工具\n');

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
  console.log('\n⚠️  警告: demo-blog.json 已存在');
  console.log('   是否覆盖? (y/n)');

  // 简化版：直接覆盖（生产环境应该等待用户输入）
  console.log('   > 自动覆盖已启用');
}

// 写入文件
console.log('\n💾 导入示例数据...');
fs.writeFileSync(TARGET_FILE, JSON.stringify(demoData, null, 2));

console.log('\n✅ 成功导入示例数据！');
console.log('\n📋 导入的内容:');
console.log(`   - Flow: ${demoData.flow.name}`);
console.log(`   - 节点数: ${demoData.flow.nodes.length}`);
console.log(`   - 任务数: ${demoData.flow.nodes.reduce((sum, node) => sum + node.tasks.length, 0)}`);
console.log(`   - Session 数: ${demoData.sessions.length}`);

console.log('\n🎯 下一步:');
console.log('   1. 启动应用: npm run dev');
console.log('   2. 访问: http://localhost:4000');
console.log('   3. 查看 "个人技术博客开发" Flow');
console.log('   4. 开始录制你的 demo!\n');

console.log('💡 提示: 查看 examples/personal-blog/USAGE.md 了解录制技巧');
