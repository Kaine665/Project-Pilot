import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

export function startNextServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

    const packagedStandaloneDir = resourcesPath
      ? path.join(resourcesPath, 'standalone')
      : '';
    const localStandaloneDir = path.resolve(__dirname, '../../.next/standalone');

    const standaloneDir =
      packagedStandaloneDir && fs.existsSync(path.join(packagedStandaloneDir, 'server.js'))
        ? packagedStandaloneDir
        : localStandaloneDir;

    const serverPath = path.join(standaloneDir, 'server.js');
    if (!fs.existsSync(serverPath)) {
      reject(
        new Error(
          `Cannot find Next.js standalone server at: ${serverPath}. Run \"npm run build\" first.`
        )
      );
      return;
    }

    const nodeExecPath = process.env.npm_node_execpath || process.execPath;

    const child = spawn(nodeExecPath, [serverPath], {
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
      cwd: standaloneDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let resolved = false;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (!resolved && (text.includes('Ready') || text.includes('started'))) {
        resolved = true;
        resolve(child);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.error('[next-server]', data.toString());
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
        reject(new Error(`Next.js server exited early, code=${code}`));
      }
    });

    setTimeout(() => {
      if (resolved) return;
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
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
