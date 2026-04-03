/**
 * 数据迁移脚本：将项目内 data/ 目录迁移到用户数据根
 *
 * 从：./data/
 * 到：~/.project-pilot/（与 file-store 默认 DATA_DIR 一致，可用 PROJECT_PILOT_DATA_DIR 覆盖）
 *
 * 旧版看板 JSON：从 src/data/flows 复制到 {DATA_DIR}/workflows/legacy-board/（与 getLegacyBoardDataDir 一致）
 *
 * 用法：npm run migrate:data
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const OLD_DATA_DIR = path.join(process.cwd(), 'data');
const OLD_FLOWS_DIR = path.join(process.cwd(), 'src', 'data', 'flows');
const NEW_DATA_DIR = process.env.PROJECT_PILOT_DATA_DIR || path.join(os.homedir(), '.project-pilot');
const NEW_LEGACY_BOARD_DIR = path.join(NEW_DATA_DIR, 'workflows', 'legacy-board');

async function copyRecursive(src, dest) {
  const stats = await fs.stat(src);

  if (stats.isDirectory()) {
    // 创建目标目录
    await fs.mkdir(dest, { recursive: true });

    // 读取目录内容
    const entries = await fs.readdir(src);

    // 递归复制每个条目
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // 复制文件
    await fs.copyFile(src, dest);
  }
}

async function migrate() {
  console.log('📦 ProjectPilot 数据迁移工具\n');
  console.log(`旧位置: ${OLD_DATA_DIR}`);
  console.log(`新位置: ${NEW_DATA_DIR}\n`);

  // 检查旧数据是否存在
  let oldExists = false;
  try {
    await fs.access(OLD_DATA_DIR);
    oldExists = true;
  } catch {
    console.log('❌ 旧数据目录不存在，无需迁移');
    return;
  }

  // 检查新位置是否已有数据
  let newExists = false;
  try {
    await fs.access(NEW_DATA_DIR);
    newExists = true;
  } catch {
    // 新位置不存在，继续
  }

  if (newExists) {
    console.log('⚠️  新位置已存在数据！');
    console.log('如果继续，旧数据会覆盖新位置的同名文件。');
    console.log('建议手动备份后再运行此脚本。\n');

    // 在生产环境应该用交互式确认，这里简化处理
    console.log('❌ 迁移已取消（新位置已有数据）');
    return;
  }

  // 开始迁移
  console.log('🚀 开始迁移...');

  try {
    await copyRecursive(OLD_DATA_DIR, NEW_DATA_DIR);
    console.log('✅ 迁移成功！\n');

    console.log('📝 后续步骤：');
    console.log('1. 验证新位置数据是否完整');
    console.log('2. 启动应用，确认功能正常');
    console.log('3. 确认无误后，可手动删除旧数据目录：');
    console.log(`   rm -rf ${OLD_DATA_DIR}`);
    console.log('\n⚠️  注意：旧数据未自动删除，请手动确认后删除');
  } catch (error) {
    console.error('❌ 迁移失败：', error.message);
    process.exit(1);
  }
}

async function migrateLegacyBoard() {
  console.log('\n📦 旧版看板 JSON 迁移\n');
  console.log(`旧位置: ${OLD_FLOWS_DIR}`);
  console.log(`新位置: ${NEW_LEGACY_BOARD_DIR}\n`);

  try {
    await fs.access(path.join(OLD_FLOWS_DIR, '_index.json'));
  } catch {
    console.log('❌ 源目录无 _index.json，无需迁移');
    return;
  }

  try {
    await fs.access(path.join(NEW_LEGACY_BOARD_DIR, '_index.json'));
    console.log('⚠️  新位置已存在看板索引，跳过迁移');
    return;
  } catch {
    /* proceed */
  }

  console.log('🚀 开始迁移旧版看板 JSON...');
  try {
    await fs.mkdir(NEW_LEGACY_BOARD_DIR, { recursive: true });
    const files = await fs.readdir(OLD_FLOWS_DIR);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.copyFile(
          path.join(OLD_FLOWS_DIR, file),
          path.join(NEW_LEGACY_BOARD_DIR, file),
        );
        count++;
      }
    }
    console.log(`✅ 已迁移 ${count} 个 JSON 文件`);
  } catch (error) {
    console.error('❌ 旧版看板迁移失败：', error.message);
  }
}

// 执行迁移
(async () => {
  try {
    await migrate();
    await migrateLegacyBoard();
  } catch (error) {
    console.error('致命错误：', error);
    process.exit(1);
  }
})();
