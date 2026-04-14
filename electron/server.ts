import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

export function startBackendServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

    const packagedServerPath = resourcesPath
      ? path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'server', 'index.js')
      : '';
    const localServerPath = path.resolve(__dirname, '../dist/server/index.js');

    const serverPath = packagedServerPath && fs.existsSync(packagedServerPath)
      ? packagedServerPath
      : localServerPath;

    if (!fs.existsSync(serverPath)) {
      reject(
        new Error(`Cannot find Hono backend at: ${serverPath}. Run "npm run build" first.`),
      );
      return;
    }

    /** 与 `package.json` asarUnpack 对齐；主进程路径可靠，避免子进程 bundle 里 `__dirname` 与磁盘不一致导致找不到 `dist/client` → 整页 404 */
    let projectPilotClientDist = '';
    if (resourcesPath) {
      const unpackedClient = path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'client');
      const asarClient = path.join(resourcesPath, 'app.asar', 'dist', 'client');
      if (fs.existsSync(path.join(unpackedClient, 'index.html'))) {
        projectPilotClientDist = unpackedClient;
      } else if (fs.existsSync(path.join(asarClient, 'index.html'))) {
        projectPilotClientDist = asarClient;
      }
    }
    if (!projectPilotClientDist) {
      const localClient = path.resolve(__dirname, '../dist/client');
      if (fs.existsSync(path.join(localClient, 'index.html'))) {
        projectPilotClientDist = localClient;
      }
    }

    const nodeExecPath = process.env.npm_node_execpath || process.execPath;

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    };
    if (projectPilotClientDist) {
      childEnv.PROJECT_PILOT_CLIENT_DIST = projectPilotClientDist;
    }

    const child = spawn(nodeExecPath, [serverPath], {
      env: childEnv,
      cwd: path.dirname(serverPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let resolved = false;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (!resolved && (text.includes('ready') || text.includes('Ready') || text.includes('started'))) {
        resolved = true;
        resolve(child);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.error('[hono-server]', data.toString());
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Hono server exited early, code=${code}`));
      }
    });

    setTimeout(() => {
      if (resolved) return;
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (!resolved) {
          resolved = true;
          resolve(child);
        }
        res.resume();
      });
      req.on('error', () => {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(child);
          }
        }, 5000);
      });
      req.end();
    }, 5000);
  });
}
