// Must be imported first: some modules read their credentials once, at import time.
process.env.REPLICATE_API_TOKEN = "r8_test";
process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.CLOUDINARY_API_KEY = "k";
process.env.CLOUDINARY_API_SECRET = "s";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.OPEN_SIGNUP;
delete process.env.DAILY_COST_CAP_USD;
delete process.env.MAX_VIDEO_SECONDS;

// Network spy, installed before any SDK captures `fetch` at import time.
export const calls: string[] = [];
export const requests: { url: string; body: any }[] = [];
let handler: (url: string) => Response = () => new Response("{}", { status: 500 });
export const setHandler = (h: (url: string) => Response) => (handler = h);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push(String(input));
  let body: any = undefined;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { /* not JSON */ }
  requests.push({ url: String(input), body });
  return handler(String(input));
}) as typeof fetch;

