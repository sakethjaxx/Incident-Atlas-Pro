import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForSelector("text=Incident Atlas", { timeout: 15000 });
await page.screenshot({ path: "notes/screenshot-dashboard.png" });

// Scroll main content to show topbar blur over content
await page.evaluate(() => {
  const main = document.querySelector(".page-content");
  if (main) main.scrollIntoView();
  window.scrollTo(0, 400);
});
await page.waitForTimeout(300);
await page.screenshot({ path: "notes/screenshot-topbar-scrolled.png" });

console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
await browser.close();
