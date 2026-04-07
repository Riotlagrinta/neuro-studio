import Replicate from "replicate";

const apiToken = process.env.REPLICATE_API_TOKEN?.trim();

export const replicate = new Replicate({
  auth: apiToken || "MISSING_TOKEN",
});
