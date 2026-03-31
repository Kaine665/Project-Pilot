import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 与 config/load-dev-server.cjs 返回值一致 */
export interface DevServerResolved {
  raw: unknown;
  clientPort: number;
  apiPort: number;
  clientBindHost: string;
  clientLoadOrigin: string;
  clientProbeOrigin: string;
  apiHealthUrl: string;
  apiListenHost: string;
  viteProxyTarget: string;
}

const require = createRequire(import.meta.url);
const {
  loadDevServerConfig,
  isDevStackReady,
  probeUrl,
} = require('../../config/load-dev-server.cjs') as {
  loadDevServerConfig: (projectRoot: string) => DevServerResolved;
  isDevStackReady: (projectRoot: string) => Promise<boolean>;
  probeUrl: (url: string) => Promise<boolean>;
};

function getProjectRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** 开发态端口与探测 URL（默认 config/dev-server.json，可被环境变量覆盖） */
export function getDevServerConfig(): DevServerResolved {
  return loadDevServerConfig(getProjectRoot());
}

export { isDevStackReady, probeUrl };
