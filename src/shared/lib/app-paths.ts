import os from 'os';

/**
 * 获取应用工作目录，用于 Claude CLI 子进程的 cwd。
 *
 * Electron 打包后 process.cwd() 指向安装目录（如 C:\Program Files\ProjectPilot\），
 * 这不是一个有用的工作目录。此时 fallback 到用户 home 目录。
 *
 * 支持通过环境变量 PROJECT_PILOT_WORK_DIR 显式覆盖。
 */
export function getAppWorkingDir(): string {
  if (process.env.PROJECT_PILOT_WORK_DIR) {
    return process.env.PROJECT_PILOT_WORK_DIR;
  }

  // Electron 打包环境（process.resourcesPath 仅在打包后存在）
  const p = process as NodeJS.Process & { resourcesPath?: string };
  if (p.resourcesPath) {
    return os.homedir();
  }

  return process.cwd();
}
