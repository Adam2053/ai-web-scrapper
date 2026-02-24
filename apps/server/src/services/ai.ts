import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY is not set. Set GEMINI_API_KEY in your environment or in a .env file inside the app (e.g. apps/server/.env).",
  );
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview",
});

export async function askGemini(content: string, question: string) {
  const prompt = `
        You are a precise and reliable AI assistant.

You will be given content scraped from a website and a user question.

Your task:
- Answer ONLY using the provided website content.
- Do NOT use external knowledge.
- If the answer cannot be found in the content, clearly say:
  "The answer is not available in the provided website content."
- Keep the response clear, concise, and well-structured.
- Avoid repeating large chunks of the website text.
- If appropriate, summarize before answering.

Website Content:
====================
${content}
====================

User Question:
"${question}"

Provide a helpful and accurate response below:
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error: any) {
    if (error.message?.includes("retry")) {
      console.log("Rate limited. Retrying in 25 seconds...");
      await new Promise((res) => setTimeout(res, 25000));
      const retry = await model.generateContent(prompt);
      const response = await retry.response;
      return response.text();
    }
  }
}
