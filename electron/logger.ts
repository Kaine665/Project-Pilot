import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

let logFilePath: string | null = null;

function resolveLogDir(): string {
  try {
    if (app?.isReady()) {
      return path.join(app.getPath('userData'), 'logs');
    }
  } catch {}

  return path.join(os.homedir(), 'Library', 'Application Support', 'project-pilot', 'logs');
}

export function getLogFilePath(): string {
  if (logFilePath) return logFilePath;
  const logDir = resolveLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, 'desktop-startup.log');
  return logFilePath;
}

export function writeStartupLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), line, 'utf8');
  } catch {}
}

export function resetStartupLog(): void {
  try {
    fs.mkdirSync(path.dirname(getLogFilePath()), { recursive: true });
    fs.writeFileSync(getLogFilePath(), '', 'utf8');
  } catch {}
}
