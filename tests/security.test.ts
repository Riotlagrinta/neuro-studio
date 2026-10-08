import { calls, requests, setHandler } from "./stubs/env-setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { setDb } from "./stubs/db-shim";
import { setUser } from "./stubs/auth-stub";
import * as actions from "../src/app/actions";
import { allowedEmail } from "../src/lib/allowlist";
import { upsertUser } from "../src/lib/users";
import { buildSampleProject } from "../src/lib/motion/sample";

const schemaSql = readFileSync("db/schema.sql", "utf8");

// ---- tiny harness ----
let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ok -", name);
  } catch (e) {
    failed++;
    console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 420));
  }
}

// ---- network is observable: any provider call shows up in `calls` (see env-setup.ts) ----
const DEFAULT_HANDLER = () => new Response("{}", { status: 500 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const VIDEO_INPUT = { modelId: "seedance", prompt: "waves", ratio: "16:9" as const, duration: 5 };
const GEN_INPUT = { topic: "une pub pour une appli", style: "kinetic" as const, targetSeconds: 30, ratio: "16:9" as const, useMedia: true };
const sample = buildSampleProject("16:9");

async function scenario(variant: "legacy" | "fresh") {
  console.log(`\n=== database variant: ${variant} ===`);
  const db = new PGlite();
  setDb(db);
  if (variant === "legacy") {
    // What production most likely looks like today: no user_id, plan stored as text, one old project.
    await db.exec(`CREATE TABLE projects (id serial PRIMARY KEY, title text, category text, plan text, topic text, created_at timestamptz DEFAULT now());
      INSERT INTO projects (title, category, plan, topic) VALUES ('Old biopic','Biopic','{"title":"Old biopic","category":"Biopic","scenes":[{"voiceOver":"Il est né en 1918.","visualPrompt":"village","duration":5}]}','legacy topic');`);
  }
  await db.exec(schemaSql);
  await t("schema.sql applies cleanly on top of the existing table, and twice in a row", async () => {
    await db.exec(schemaSql);
    const cols = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'`);
    assert.ok(cols.rows.some((c) => c.column_name === "user_id"));
  });

  process.env.ALLOWED_EMAILS = "a@example.com, B@Example.com";
  const A = { id: await upsertUser({ email: "A@Example.com", name: "Alice" }), email: "a@example.com", name: "Alice" };
  const B = { id: await upsertUser({ email: "b@example.com", name: "Bob" }), email: "b@example.com", name: "Bob" };
  const C = { id: await upsertUser({ email: "stranger@example.com", name: "Eve" }), email: "stranger@example.com", name: "Eve" };

  const usage = async (where = "") => Number((await db.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM usage_events ${where}`)).rows[0].n);
  const reset = async () => {
    await db.exec("DELETE FROM usage_events; DELETE FROM projects WHERE user_id IS NOT NULL");
    calls.length = 0;
    setHandler(DEFAULT_HANDLER);
  };

  await t("upsertUser is idempotent and case-insensitive on email", async () => {
    assert.equal(await upsertUser({ email: "a@EXAMPLE.com", name: "Alice 2" }), A.id);
    assert.equal(Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n), 3);
  });

  // ---------------------------------------------------------------- anonymous
  console.log("anonymous visitor");
  setUser(null);
  const everyAction: [string, () => Promise<{ success?: boolean; error?: string }>][] = [
    ["generateMotionProject", () => actions.generateMotionProject(GEN_INPUT)],
    ["refineMotionScene", () => actions.refineMotionScene({ title: "t", palette: [], ratio: "16:9", index: 0, total: 1, scene: sample.scenes[0], instruction: "plus rapide" })],
    ["generateImage", () => actions.generateImage("a calm sea at dawn", "16:9")],
    ["synthesizeVoice", () => actions.synthesizeVoice("Bonjour", "openai", "alloy")],
    ["startVideoJob", () => actions.startVideoJob(VIDEO_INPUT)],
    ["checkVideoJob", () => actions.checkVideoJob("abcd1234efgh")],
    ["saveProject", () => actions.saveProject("topic", sample)],
    ["getProjects", () => actions.getProjects()],
    ["getProject", () => actions.getProject(1)],
  ];
  await reset();
  for (const [name, run] of everyAction) {
    await t(`${name} refuses with NON_CONNECTÉ`, async () => assert.equal((await run()).error, "NON_CONNECTÉ"));
  }
  await t("…and none of them reached a provider or wrote anything", async () => {
    assert.deepEqual(calls, []);
    assert.equal(await usage(), 0);
  });

  // ---------------------------------------------------------------- signed in but not invited
  console.log("signed in, not invited");
  setUser(C);
  for (const [name, run] of everyAction) {
    await t(`${name} refuses with ACCÈS_REFUSÉ`, async () => assert.equal((await run()).error, "ACCÈS_REFUSÉ"));
  }
  await t("…and again: no provider call, no usage row", async () => {
    assert.deepEqual(calls, []);
    assert.equal(await usage(), 0);
  });

  // ---------------------------------------------------------------- invited: quotas and refunds
  console.log("invited user: quotas, cost cap, refunds");
  setUser(A);
  await t("a provider failure refunds the reservation (nothing counts against the user)", async () => {
    await reset();
    const r = await actions.generateMotionProject(GEN_INPUT); // no ANTHROPIC_API_KEY -> provider error after authorize
    assert.equal(r.error, "CLÉ_ANTHROPIC_MANQUANTE");
    assert.equal(await usage(), 1);
    assert.equal(await usage("WHERE NOT refunded"), 0);
  });
  await t("voice: refused once 60 actions were used in 24h (no provider call)", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'voice', 0.01 FROM generate_series(1, 60)`, [A.id]);
    assert.equal((await actions.synthesizeVoice("Bonjour", "openai", "alloy")).error, "QUOTA_ATTEINTE");
    assert.deepEqual(calls, []);
    assert.equal(await usage("WHERE kind = 'voice'"), 60); // the refused attempt left no row
  });
  await t("voice: 59 used -> still allowed (then the provider says no key, and it is refunded)", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'voice', 0.01 FROM generate_series(1, 59)`, [A.id]);
    assert.equal((await actions.synthesizeVoice("Bonjour", "openai", "alloy")).error, "CLÉ_OPENAI_MANQUANTE");
    assert.equal(await usage("WHERE kind = 'voice' AND NOT refunded"), 59);
  });
  await t("events older than 24 hours do not count", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd, created_at) SELECT $1::uuid, 'voice', 0.01, now() - interval '25 hours' FROM generate_series(1, 60)`, [A.id]);
    assert.equal((await actions.synthesizeVoice("Bonjour", "openai", "alloy")).error, "CLÉ_OPENAI_MANQUANTE");
  });
  await t("refunded events do not count", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd, refunded) SELECT $1::uuid, 'voice', 0.01, true FROM generate_series(1, 60)`, [A.id]);
    assert.equal((await actions.synthesizeVoice("Bonjour", "openai", "alloy")).error, "CLÉ_OPENAI_MANQUANTE");
  });
  await t("daily cost cap: 2.98 $ already spent + a 0.08 $ voice call -> refused", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) VALUES ($1::uuid, 'image', 2.98)`, [A.id]);
    assert.equal((await actions.synthesizeVoice("x".repeat(1000), "elevenlabs", "pNInz6OB85MvRmPLz5QN")).error, "QUOTA_ATTEINTE");
    assert.deepEqual(calls, []);
  });
  await t("quotas are per user: A's usage doesn't limit B", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'voice', 0.01 FROM generate_series(1, 60)`, [A.id]);
    setUser(B);
    assert.equal((await actions.synthesizeVoice("Bonjour", "openai", "alloy")).error, "CLÉ_OPENAI_MANQUANTE");
    setUser(A);
  });
  await t("requested length is capped to MAX_VIDEO_SECONDS (cost estimate follows)", async () => {
    await reset();
    process.env.MAX_VIDEO_SECONDS = "20";
    await actions.generateMotionProject({ ...GEN_INPUT, targetSeconds: 120 });
    const cost = Number((await db.query<{ c: string }>(`SELECT cost_usd::float AS c FROM usage_events WHERE kind = 'motion'`)).rows[0].c);
    delete process.env.MAX_VIDEO_SECONDS;
    assert.ok(Math.abs(cost - 0.224) < 1e-6, `expected 20 s on Opus = 0.224 $ (not the 120 s asked for), got ${cost}`);
  });
  await t("invalid input is rejected before it uses any quota", async () => {
    await reset();
    assert.equal((await actions.generateMotionProject({ ...GEN_INPUT, topic: "x" })).error, "SUJET_TROP_COURT");
    assert.equal((await actions.synthesizeVoice("   ", "openai", "alloy")).error, "TEXTE_VIDE");
    assert.equal(await usage(), 0);
  });

  // ---------------------------------------------------------------- video jobs
  console.log("video jobs");
  await t("startVideoJob records the job id against the user; a failed start is refunded", async () => {
    await reset();
    setHandler(() => json({ error: "boom" }, 500));
    const failedStart = await actions.startVideoJob(VIDEO_INPUT);
    assert.equal(failedStart.success, false, "failedStart=" + JSON.stringify(failedStart));
    assert.equal(await usage("WHERE NOT refunded"), 0);

    setHandler(() => json({ id: "abcd1234efgh", status: "starting", urls: {}, model: "bytedance/seedance-1-lite", version: "x", input: {}, created_at: new Date().toISOString() }, 201));
    const ok = await actions.startVideoJob(VIDEO_INPUT);
    assert.equal(ok.success, true, "ok=" + JSON.stringify(ok) + " calls=" + JSON.stringify(calls));
    const rows = await db.query<{ ref: string; cost_usd: string }>(`SELECT ref, cost_usd FROM usage_events WHERE NOT refunded`);
    assert.equal(rows.rows[0].ref, "abcd1234efgh");
    assert.ok(Math.abs(Number(rows.rows[0].cost_usd) - 0.09) < 1e-6, "5 s of Seedance, economical tier (480p) = 0.09 $");
  });
  await t("checkVideoJob: someone else's job id is refused and never forwarded to Replicate", async () => {
    setUser(B);
    calls.length = 0;
    assert.equal((await actions.checkVideoJob("abcd1234efgh")).success, false);
    assert.deepEqual(calls, []);
    setUser(A);
  });
  await t("checkVideoJob: the owner can poll; a failed job is refunded", async () => {
    calls.length = 0;
    setHandler(() => json({ id: "abcd1234efgh", status: "failed", error: "NSFW", urls: {}, model: "m", version: "v", input: {}, created_at: new Date().toISOString() }));
    const r = await actions.checkVideoJob("abcd1234efgh");
    assert.deepEqual(r, { success: false, error: "NSFW" }, "r=" + JSON.stringify(r) + " calls=" + JSON.stringify(calls));
    assert.equal(calls.length, 1);
    assert.equal(await usage("WHERE NOT refunded"), 0);
  });
  await t("startVideoJob only accepts images hosted on our Cloudinary", async () => {
    await reset();
    setHandler(() => json({ id: "zzzz1234yyyy", status: "starting", urls: {}, model: "m", version: "v", input: {}, created_at: new Date().toISOString() }, 201));
    const r = await actions.startVideoJob({ ...VIDEO_INPUT, modelId: "wan-fast", imageUrl: "https://evil.example/pwn.png" });
    assert.equal(r.success === false && r.error, "IMAGE_REQUISE");
    assert.deepEqual(calls, []);
  });


  // ---------------------------------------------------------------- cost control: quality tiers and models
  console.log("cost control: video quality tiers");
  const predictionStub = () =>
    setHandler(() => json({ id: "qual1234abcd", status: "starting", urls: {}, model: "m", version: "v", input: {}, created_at: new Date().toISOString() }, 201));
  const lastPrediction = () => requests.filter((r) => r.url.includes("/predictions")).at(-1)!;
  const lastCost = async () => Number((await db.query<{ c: string }>(`SELECT cost_usd::float AS c FROM usage_events WHERE NOT refunded ORDER BY id DESC LIMIT 1`)).rows[0].c);

  await t("default is the economical tier: 480p sent to Replicate, 0.09 $ recorded", async () => {
    await reset(); requests.length = 0; predictionStub();
    assert.equal((await actions.startVideoJob(VIDEO_INPUT)).success, true);
    assert.equal(lastPrediction().body.input.resolution, "480p");
    assert.ok(Math.abs((await lastCost()) - 0.09) < 1e-6);
  });
  await t("standard = 720p at 0.036 $/s; premium = 1080p at 0.072 $/s", async () => {
    await reset(); requests.length = 0; predictionStub();
    await actions.startVideoJob({ ...VIDEO_INPUT, quality: "standard" });
    assert.equal(lastPrediction().body.input.resolution, "720p");
    assert.ok(Math.abs((await lastCost()) - 0.18) < 1e-6);
    await actions.startVideoJob({ ...VIDEO_INPUT, quality: "premium" });
    assert.equal(lastPrediction().body.input.resolution, "1080p");
    assert.ok(Math.abs((await lastCost()) - 0.36) < 1e-6);
  });
  await t("Wan premium = 720p + 30 fps interpolation at 0.145 $; economical = 0.05 $", async () => {
    await reset(); requests.length = 0; predictionStub();
    const img = "https://res.cloudinary.com/demo/a.png";
    await actions.startVideoJob({ ...VIDEO_INPUT, modelId: "wan-fast", imageUrl: img, quality: "premium" });
    assert.deepEqual([lastPrediction().body.input.resolution, lastPrediction().body.input.interpolate_output], ["720p", true]);
    assert.ok(Math.abs((await lastCost()) - 0.145) < 1e-6);
    await actions.startVideoJob({ ...VIDEO_INPUT, modelId: "wan-fast", imageUrl: img });
    assert.equal(lastPrediction().body.input.resolution, "480p");
    assert.equal(lastPrediction().body.input.interpolate_output, undefined);
    assert.ok(Math.abs((await lastCost()) - 0.05) < 1e-6);
  });
  await t("an unknown quality falls back to the default; VIDEO_DEFAULT_QUALITY changes the default", async () => {
    await reset(); requests.length = 0; predictionStub();
    await actions.startVideoJob({ ...VIDEO_INPUT, quality: "ultra" as never });
    assert.equal(lastPrediction().body.input.resolution, "480p");
    process.env.VIDEO_DEFAULT_QUALITY = "standard";
    await actions.startVideoJob(VIDEO_INPUT);
    delete process.env.VIDEO_DEFAULT_QUALITY;
    assert.equal(lastPrediction().body.input.resolution, "720p");
  });
  await t("a premium clip counts more against the daily cost cap", async () => {
    await reset(); predictionStub();
    process.env.DAILY_COST_CAP_USD = "0.5";
    assert.equal((await actions.startVideoJob({ ...VIDEO_INPUT, quality: "premium" })).success, true); // 0.36
    assert.equal((await actions.startVideoJob({ ...VIDEO_INPUT, quality: "premium" })).success === false && "QUOTA_ATTEINTE", "QUOTA_ATTEINTE"); // 0.72 > 0.5
    assert.equal((await actions.startVideoJob({ ...VIDEO_INPUT, quality: "eco" })).success, true); // 0.36 + 0.09 = 0.45 <= 0.5
    delete process.env.DAILY_COST_CAP_USD;
  });

  console.log("cost control: which Claude model does what");
  const sse = (text: string) => {
    const ev = (e: string, d: unknown) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
    return new Response(
      ev("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) +
        ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
        ev("content_block_stop", { type: "content_block_stop", index: 0 }) +
        ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }) +
        ev("message_stop", { type: "message_stop" }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };
  const lastClaude = () => requests.filter((r) => r.url.includes("/v1/messages")).at(-1)!;
  const projectJson = JSON.stringify({ title: "T", category: "c", scenes: [{ voiceOver: "hi", duration: 5, layers: [{ type: "text", text: "Hi" }] }] });
  const sceneJson = JSON.stringify({ voiceOver: "hi", duration: 5, layers: [{ type: "text", text: "Hi" }] });
  process.env.ANTHROPIC_API_KEY = "k";

  await t("full video: Opus 5.5 at high effort, adaptive thinking, server-side fallback, no forced tool use or temperature", async () => {
    await reset(); requests.length = 0; setHandler(() => sse(projectJson));
    const r = await actions.generateMotionProject(GEN_INPUT);
    assert.equal(r.success, true, JSON.stringify(r));
    const b = lastClaude().body;
    assert.equal(b.model, "claude-opus-5-5");
    assert.equal(b.output_config.effort, "high");
    assert.deepEqual(b.thinking, { type: "adaptive" });
    assert.equal(b.fallbacks, "default");
    assert.equal(b.tool_choice, undefined);
    assert.equal(b.temperature, undefined);
    assert.ok(Math.abs((await lastCost()) - 0.332) < 1e-6, "30 s on Opus = 0.332 $ estimated");
  });
  await t("scene retouch: Sonnet 5.5 at medium effort, estimated at about half the Opus price", async () => {
    await reset(); requests.length = 0; setHandler(() => sse(sceneJson));
    const r = await actions.refineMotionScene({ title: "t", palette: [], ratio: "16:9", index: 0, total: 1, scene: sample.scenes[0], instruction: "plus rapide" });
    assert.equal(r.success, true, JSON.stringify(r));
    const b = lastClaude().body;
    assert.equal(b.model, "claude-sonnet-5-5");
    assert.equal(b.output_config.effort, "medium");
    assert.ok(Math.abs((await lastCost()) - 0.029) < 1e-6, "retouch on Sonnet = 0.029 $ estimated");
  });
  await t("a retouch hands back the same scene identity, and keeps the narration offset while the text is unchanged", async () => {
    await reset(); requests.length = 0; setHandler(() => sse(JSON.stringify({ voiceOver: "hi", duration: 5, layers: [{ type: "text", text: "Hi" }] })));
    const withAudio = { ...sample.scenes[0], voiceOver: "hi", audioUrl: "https://res.cloudinary.com/x/v.mp3", audioOffset: 2 };
    const r = await actions.refineMotionScene({ title: "t", palette: [], ratio: "16:9", index: 0, total: 1, scene: withAudio, instruction: "plus rapide" });
    assert.equal(r.success, true, JSON.stringify(r));
    if (r.success) {
      assert.equal(r.data.uid, withAudio.uid);
      assert.equal(r.data.audioUrl, withAudio.audioUrl);
      assert.equal(r.data.audioOffset, 2);
    }
  });
  await t("MOTION_* / REFINE_* override model and effort; unsupported values fall back to the defaults", async () => {
    process.env.REFINE_MODEL = "claude-opus-5-5"; process.env.REFINE_EFFORT = "low";
    process.env.MOTION_MODEL = "gpt-4"; process.env.MOTION_EFFORT = "ludicrous";
    await reset(); requests.length = 0; setHandler(() => sse(sceneJson));
    await actions.refineMotionScene({ title: "t", palette: [], ratio: "16:9", index: 0, total: 1, scene: sample.scenes[0], instruction: "plus rapide" });
    assert.deepEqual([lastClaude().body.model, lastClaude().body.output_config.effort], ["claude-opus-5-5", "low"]);
    setHandler(() => sse(projectJson));
    await actions.generateMotionProject(GEN_INPUT);
    assert.deepEqual([lastClaude().body.model, lastClaude().body.output_config.effort], ["claude-opus-5-5", "high"]);
    for (const k of ["REFINE_MODEL", "REFINE_EFFORT", "MOTION_MODEL", "MOTION_EFFORT"]) delete process.env[k];
  });
  delete process.env.ANTHROPIC_API_KEY;

  // ---------------------------------------------------------------- projects: privacy
  console.log("projects are private");
  let aProject = 0;
  await t("A saves a project and lists/opens it", async () => {
    await reset();
    const saved = await actions.saveProject("my secret topic", sample);
    assert.equal(saved.success, true);
    aProject = (saved as { id: number }).id;
    const list = await actions.getProjects();
    assert.equal(list.success && list.projects.length, 1);
    const opened = await actions.getProject(aProject);
    assert.equal(opened.success, true);
  });
  await t("B cannot list, open or find A's project (it looks like a missing one)", async () => {
    setUser(B);
    const list = await actions.getProjects();
    assert.equal(list.success && list.projects.length, 0);
    assert.equal((await actions.getProject(aProject)).error, "PROJET_INTROUVABLE");
    setUser(A);
  });
  await t("B's saved project is invisible to A", async () => {
    setUser(B);
    await actions.saveProject("b topic", sample);
    setUser(A);
    const list = await actions.getProjects();
    assert.equal(list.success && list.projects.length, 1);
    assert.ok(list.success && list.projects.every((p) => p.topic === "my secret topic"));
  });
  await t("a stored project keeps its owner in the database", async () => {
    const r = await db.query<{ user_id: string }>(`SELECT user_id FROM projects WHERE id = $1`, [aProject]);
    assert.equal(r.rows[0].user_id, A.id);
  });
  await t("project quota: 200 saved -> the next save is refused", async () => {
    await db.query(`INSERT INTO projects (title, category, plan, topic, user_id) SELECT 't','c','{}','x', $1::uuid FROM generate_series(1, 200)`, [A.id]);
    assert.equal((await actions.saveProject("x", sample)).error, "TROP_DE_PROJETS");
  });
  await t("withdrawing an invitation takes effect immediately, even with a still-valid session", async () => {
    process.env.ALLOWED_EMAILS = "b@example.com";
    assert.equal((await actions.getProjects()).error, "ACCÈS_REFUSÉ");
    process.env.ALLOWED_EMAILS = "a@example.com, B@Example.com";
  });

  if (variant === "legacy") {
    console.log("legacy projects (user_id empty)");
    await t("old projects are invisible to every user until adopted", async () => {
      const row = await db.query<{ id: number }>(`SELECT id FROM projects WHERE user_id IS NULL`);
      assert.equal(row.rows.length, 1);
      const id = Number(row.rows[0].id);
      for (const u of [A, B]) {
        setUser(u);
        assert.equal((await actions.getProject(id)).error, "PROJET_INTROUVABLE");
      }
      setUser(A);
    });
    await t("adopting an old project (the README's UPDATE) makes it open, with a default layout", async () => {
      await db.query(`UPDATE projects SET user_id = $1::uuid WHERE user_id IS NULL`, [A.id]);
      const id = Number((await db.query<{ id: number }>(`SELECT id FROM projects WHERE title = 'Old biopic'`)).rows[0].id);
      const r = await actions.getProject(id);
      assert.equal(r.success, true);
      if (r.success) {
        assert.equal(r.data.scenes[0].voiceOver, "Il est né en 1918.");
        assert.deepEqual(r.data.scenes[0].layers.map((l: { type: string }) => l.type), ["media", "rect", "text"]);
      }
    });
  }

  // ---------------------------------------------------------------- capabilities leak nothing
  console.log("capabilities for visitors");
  await t("anonymous: no account info, no ElevenLabs lookups even with a key configured", async () => {
    process.env.ELEVENLABS_API_KEY = "xi-test";
    setUser(null);
    calls.length = 0;
    const caps = await actions.getStudioCapabilities();
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(caps.auth.user, null);
    assert.equal(caps.auth.allowed, false);
    assert.equal(caps.quota, null);
    assert.deepEqual(calls, []);
    setUser(A);
  });
}

(async () => {
  await t("allowlist: fail-closed by default, case-insensitive, OPEN_SIGNUP opt-in", () => {
    delete process.env.ALLOWED_EMAILS;
    assert.equal(allowedEmail("a@example.com"), false);
    process.env.ALLOWED_EMAILS = " A@example.com ,b@example.com";
    assert.equal(allowedEmail("a@EXAMPLE.com"), true);
    assert.equal(allowedEmail("c@example.com"), false);
    assert.equal(allowedEmail("a@example.com.evil.io"), false);
    process.env.OPEN_SIGNUP = "true";
    assert.equal(allowedEmail("anyone@else.org"), true);
    delete process.env.OPEN_SIGNUP;
  });
  await scenario("legacy");
  await scenario("fresh");
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
