import { dialog, shell } from 'electron';
import http from 'http';

/**
 * 服务器启动后，调用 health API 检测 Claude CLI 是否可用。
 * 如果不可用，弹出原生对话框引导用户安装。
 */
export function checkCliHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/settings/health`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.cli?.ok) {
            resolve(true);
          } else {
            showCliMissingDialog(data.cli?.diagnostic);
            resolve(false);
          }
        } catch {
          // 解析失败，不阻塞用户
          resolve(true);
        }
      });
    });

    req.on('error', () => {
      // health API 请求失败，不阻塞
      resolve(true);
    });

    req.end();
  });
}

function showCliMissingDialog(diagnostic?: string) {
  const result = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Claude CLI 未安装',
    message: 'ProjectPilot 需要 Claude Code CLI 才能使用 AI 功能。',
    detail: diagnostic
      ? `诊断信息：${diagnostic}\n\n安装命令：npm install -g @anthropic-ai/claude-code`
      : '请先安装 Claude Code CLI：\nnpm install -g @anthropic-ai/claude-code\n\n安装后重启 ProjectPilot 即可使用 AI 功能。',
    buttons: ['查看安装指南', '稍后安装'],
    defaultId: 0,
  });

  if (result === 0) {
    shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/getting-started');
  }
}
