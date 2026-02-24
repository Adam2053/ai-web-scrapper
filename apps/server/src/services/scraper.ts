import { chromium } from "playwright";

export async function scrapeWebsite(url: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

     await page.waitForTimeout(3000);

    // remove script and style tags before extracting text content
    await page.evaluate(() => {
      document.querySelectorAll("script, style").forEach((el) => el.remove());
    });

    const textContent = await page.evaluate(() => {
      return document.body.innerText;
    });

    await browser.close();

    // Limitting the text content to 10000 characters for AI processing and removing extra whitespaces to save tokens
    const trimmed = textContent.replace(/\s+/g, " ").trim().slice(0, 10000);

    return trimmed;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
