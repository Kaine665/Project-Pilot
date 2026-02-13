/**
 * Playwright screenshot capture script.
 *
 * Usage:
 *   node capture-screenshot.js --url <baseUrl> --out <outputDir> [--pages <comma-separated-paths>]
 *
 * Examples:
 *   node capture-screenshot.js --url http://localhost:8080 --out ./data/artifacts/plan-123/
 *   node capture-screenshot.js --url http://localhost:8080 --out ./data/artifacts/plan-123/ --pages /,/feedback,/settings
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) {
      args.url = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    } else if (argv[i] === '--pages' && argv[i + 1]) {
      args.pages = argv[++i].split(',').map((p) => p.trim());
    }
  }
  return args;
}

function sanitizePath(pagePath) {
  if (pagePath === '/' || pagePath === '') return 'home';
  return pagePath
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url) {
    console.error('Error: --url is required');
    process.exit(1);
  }

  if (!args.out) {
    console.error('Error: --out is required');
    process.exit(1);
  }

  const baseUrl = args.url.replace(/\/$/, '');
  const outputDir = path.resolve(args.out);
  const pages = args.pages || ['/'];

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Capturing screenshots from ${baseUrl}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Pages: ${pages.join(', ')}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  try {
    for (const pagePath of pages) {
      const url = pagePath === '/' ? baseUrl : `${baseUrl}${pagePath}`;
      const name = sanitizePath(pagePath);
      const outputPath = path.join(outputDir, `screenshot-${name}.png`);

      console.log(`  Navigating to ${url} ...`);

      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.screenshot({ path: outputPath, fullPage: true });
        console.log(`  Saved: ${outputPath}`);
      } catch (err) {
        console.error(`  Failed to capture ${url}: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
