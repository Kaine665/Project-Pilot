const { chromium } = require("playwright");
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto("http://127.0.0.1:4030/flows/agents", { waitUntil: "networkidle", timeout: 20000 });
  await page.screenshot({ path: "tmp/agents-test-4030.png", fullPage: true });
  console.log("SHOT_OK");
  await browser.close();
})();
