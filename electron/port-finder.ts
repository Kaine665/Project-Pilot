import net from 'net';

/**
 * 查找可用端口。优先尝试 preferred，被占用则由 OS 分配随机端口。
 */
export function findAvailablePort(preferred: number = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      server.close(() => resolve(preferred));
    });
    server.on('error', () => {
      // preferred 端口被占用，让 OS 分配
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address() as net.AddressInfo;
        fallback.close(() => resolve(addr.port));
      });
      fallback.on('error', reject);
    });
  });
}
