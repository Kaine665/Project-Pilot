import { Hono } from 'hono';

/**
 * Mount an API subtree whose module loads on the first matching request (dev: faster cold start).
 * Rewrites the URL pathname so the loaded {@link Hono} app sees paths relative to `mountPath`.
 *
 * Note: `bun build … --outfile=dist/server/index.js` bundles into one file, so production startup
 * still parses the full bundle once; this mainly helps `tsx ./src/server/index.ts` and any future
 * split-chunk server builds.
 */
export function lazyApiRoute(
  mountPath: string,
  loader: () => Promise<{ default: Hono }>,
): Hono {
  const wrapper = new Hono();
  let cached: Hono | null = null;

  const ensureLoaded = async (): Promise<Hono> => {
    if (!cached) {
      cached = (await loader()).default;
    }
    return cached;
  };

  wrapper.all('*', async (c) => {
    const sub = await ensureLoaded();
    const url = new URL(c.req.url);
    const path = url.pathname;
    const base = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath;

    let relative: string;
    if (path === base) {
      relative = '/';
    } else if (path.startsWith(`${base}/`)) {
      relative = path.slice(base.length);
      if (!relative.startsWith('/')) {
        relative = `/${relative}`;
      }
    } else {
      relative = path;
    }

    url.pathname = relative;
    const forwarded = new Request(url, c.req.raw);
    // @hono/node-server 无 ExecutionContext；访问 c.executionCtx 会抛错
    return sub.fetch(forwarded, c.env);
  });

  return wrapper;
}
