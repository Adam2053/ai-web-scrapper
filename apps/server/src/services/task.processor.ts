import { db } from "../lib/db";
import { tasks } from "@internship-project-sbl/db/src/schema";
import { eq } from "drizzle-orm";
import { scrapeWebsite } from "./scraper";
import { askGemini } from "./ai";

type TaskJobData = {
  taskId: string;
  url: string;
  question: string;
};

export async function processTask(data: TaskJobData) {
  console.log("Processing Task : ", data);

  // TODO:
  // 1. Update DB → processing
  // 2. Scrape website
  // 3. Call AI
  // 4. Update DB → completed

  const { taskId, url, question } = data;

  try {
    // update status to processing
    await db
      .update(tasks)
      .set({ status: "processing" })
      .where(eq(tasks.id, taskId));

    console.log("Scraping started for : ", url);

    const content = await scrapeWebsite(url);

    console.log("Scraped Content Preview:");
    console.log(content.slice(0, 1000));

    console.log("Calling Gemini....");

    const aiAnswer = await askGemini(content, question);

    // TEMP: Store scraped content preview
    await db
      .update(tasks)
      .set({ status: "completed", answer: aiAnswer })
      .where(eq(tasks.id, taskId));

    console.log("Task completed : ", taskId);
  } catch (error: any) {
    // update status to failed
    console.error("Processing failed:", error);

    await db
      .update(tasks)
      .set({
        status: "failed",
        error: error.message || "Scraping failed",
      })
      .where(eq(tasks.id, taskId));

    throw error;
  }
}
