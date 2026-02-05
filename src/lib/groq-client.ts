import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;

export const groq = new Groq({
  apiKey: apiKey || "MISSING_KEY",
});
