const { chromium } = require("playwright");
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto("http://127.0.0.1:4000/flows/agents", { waitUntil: "networkidle", timeout: 120000 });
  await page.screenshot({ path: "tmp/agents-test-4000.png", fullPage: true });
  console.log("SHOT_OK");
  await browser.close();
})().catch(err=>{ console.error(err); process.exit(1); });
