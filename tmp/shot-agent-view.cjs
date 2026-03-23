const { chromium } = require("playwright");
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto("http://127.0.0.1:4000/flows/agents", { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('text=Agents').first().click();
  await page.waitForTimeout(1000);
  const firstAgent = page.locator('[class*="cursor-pointer"]').filter({ hasText: /Agent|Éè¼Æ|AI/ }).nth(1);
  await firstAgent.click().catch(()=>{});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tmp/agents-agent-view.png", fullPage: true });
  await browser.close();
})().catch(err=>{ console.error(err); process.exit(1); });
