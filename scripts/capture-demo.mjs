import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.DEMO_BASE_URL || "http://127.0.0.1:4244";
const outputDir = path.resolve(process.env.DEMO_CAPTURE_DIR || "demo/captures");
const channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"]
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark"
});
await context.addInitScript("localStorage.setItem('lal-theme', 'dark')");

const page = await context.newPage();
page.setDefaultTimeout(45_000);

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
}

async function safeClick(locator) {
  try {
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await shot("01-dashboard");

  const trackInput = page.getByLabel("Track search");
  await trackInput.fill("Coldplay Viva La Vida Live");
  await page.waitForTimeout(1400);
  await shot("02-musixmatch-search");

  await page.getByRole("button", { name: /Recall lyric fragment/i }).click();
  await page.getByLabel("Remembered lyric words").fill("carry this chorus through the avenue");
  await shot("03-recall-rescue");

  await page.getByRole("button", { name: /Run judge-ready demo/i }).click();
  await page.waitForSelector("#analysis-timeline");
  await page.waitForSelector("#diff-view");
  await shot("04-analysis-timeline");

  await page.locator("#diff-view").scrollIntoViewIfNeeded();
  await shot("05-diff-view");

  await safeClick(page.getByTitle("Approve variant").first());
  await shot("06-review-actions");

  await page.getByText("Live Context").scrollIntoViewIfNeeded();
  await shot("07-evidence-context");

  await page.getByText("Passport Summary").scrollIntoViewIfNeeded();
  await shot("08-export-summary");
} finally {
  await browser.close();
}
