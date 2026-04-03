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

    const nodeExecPath = process.env.npm_node_execpath || process.execPath;

    const child = spawn(nodeExecPath, [serverPath], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1',
      },
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
