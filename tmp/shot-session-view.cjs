const { chromium } = require("playwright");
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto("http://127.0.0.1:4000/flows/agents", { waitUntil: "networkidle", timeout: 120000 });
  const firstSession = page.locator('div').filter({ hasText: /AI ¹Ü¼Ò|Self-Dev Agent|ELApp/ }).nth(0);
  await firstSession.click().catch(()=>{});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "tmp/agents-session-view.png", fullPage: true });
  await browser.close();
})().catch(err=>{ console.error(err); process.exit(1); });
