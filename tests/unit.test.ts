import assert from "node:assert/strict";
import { ease, sample } from "../src/lib/motion/easing";
import { ensureMediaLayer, extractJson, normalizeProject } from "../src/lib/motion/sanitize";
import { locate, sceneStart, projectDuration } from "../src/lib/motion/types";
import { sceneCountFor, systemPrompt } from "../src/lib/motion/prompt";
import { buildSampleProject } from "../src/lib/motion/sample";
import { listVoiceProviders, synthesize } from "../src/lib/voice-providers";
import { getVideoModel, videoCost, videoInput } from "../src/lib/video-models";
import { formatUsd, motionCost, refineCost } from "../src/lib/pricing";

let n = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log("  ok -", name);
};

(async () => {
  console.log("easing / tracks");
  await t("every ease maps 0→0 and 1→1", () => {
    for (const e of ["linear", "easeIn", "easeOut", "easeInOut", "backOut", "elasticOut", "expoOut", "bounceOut"] as const) {
      assert.ok(Math.abs(ease(e, 0)) < 1e-9, `${e}(0)`);
      assert.ok(Math.abs(ease(e, 1) - 1) < 1e-9, `${e}(1)`);
    }
  });
  await t("backOut overshoots past 1", () => assert.ok(ease("backOut", 0.6) > 1));
  await t("sample: holds before first / after last, interpolates between", () => {
    const k = [{ t: 1, v: 10 }, { t: 3, v: 30, ease: "linear" as const }];
    assert.equal(sample(k, 0), 10);
    assert.equal(sample(k, 2), 20);
    assert.equal(sample(k, 99), 30);
    assert.equal(sample(7, 5), 7);
  });

  console.log("timeline");
  const proj = buildSampleProject("16:9");
  await t("locate/sceneStart on the sample", () => {
    const d = proj.scenes.map((s) => s.duration);
    assert.deepEqual(locate(proj, 0), { index: 0, local: 0 });
    assert.equal(locate(proj, d[0]).index, 1);
    assert.equal(sceneStart(proj, 2), d[0] + d[1]);
    const end = locate(proj, projectDuration(proj) + 50);
    assert.equal(end.index, proj.scenes.length - 1);
    assert.equal(end.local, d[d.length - 1]);
  });

  console.log("sanitize");
  await t("legacy biopic plan gets default layers and keeps its own asset URLs", () => {
    const legacy = { title: "Mandela", category: "Biopic", scenes: [{ id: 1, voiceOver: "Il est né en 1918.", visualPrompt: "village", videoKeywords: "x", duration: 5, imageUrl: "https://res.cloudinary.com/demo/a.webp" }] };
    const p = normalizeProject(legacy, "16:9", true)!;
    assert.equal(p.ratio, "16:9");
    assert.deepEqual(p.scenes[0].layers.map((l) => l.type), ["media", "rect", "text"]);
    assert.equal(p.scenes[0].imageUrl, "https://res.cloudinary.com/demo/a.webp");
  });
  await t("model output: asset URLs are stripped (keepAssets=false)", () => {
    const p = normalizeProject({ scenes: [{ imageUrl: "https://evil.example/x.png", audioUrl: "https://evil.example/a.mp3", videoUrl: "https://evil.example/v.mp4" }] }, "9:16", false)!;
    assert.equal(p.scenes[0].imageUrl, undefined);
    assert.equal(p.scenes[0].audioUrl, undefined);
    assert.equal(p.scenes[0].videoUrl, undefined);
  });
  await t("stored data: non-https and junk URLs are rejected even when keeping assets", () => {
    const p = normalizeProject({ scenes: [{ imageUrl: "http://a.example/x.png", videoUrl: "javascript:alert(1)", audioUrl: "not a url" }] }, "16:9", true)!;
    assert.equal(p.scenes[0].imageUrl, undefined);
    assert.equal(p.scenes[0].videoUrl, undefined);
    assert.equal(p.scenes[0].audioUrl, undefined);
  });
  await t("keyframes are sorted, bad ones dropped, values clamped", () => {
    const p = normalizeProject(
      { scenes: [{ duration: 5, layers: [{ type: "rect", opacity: [{ t: 2, v: 9 }, { t: "x", v: 1 }, { t: 0, v: -4, ease: "nope" }, null], x: "abc", scale: Infinity }] }] },
      "16:9",
      false,
    )!;
    const r = p.scenes[0].layers[0] as any;
    assert.deepEqual(r.opacity, [{ t: 0, v: 0 }, { t: 2, v: 1 }]);
    assert.equal(r.x, 960); // unparsable → default center
    assert.ok(Number.isFinite(r.scale));
  });
  await t("caps: 20 scenes, 40 layers; no scenes → null; non-object → null", () => {
    const many = { scenes: Array.from({ length: 50 }, () => ({ layers: Array.from({ length: 80 }, () => ({ type: "rect" })) })) };
    const p = normalizeProject(many, "16:9", false)!;
    assert.equal(p.scenes.length, 20);
    assert.equal(p.scenes[0].layers.length, 40);
    assert.equal(normalizeProject({ scenes: [] }, "16:9", false), null);
    assert.equal(normalizeProject("nope", "16:9", false), null);
  });
  await t("ratio from the project wins over the fallback", () => {
    assert.equal(normalizeProject({ ratio: "9:16", scenes: [{}] }, "16:9", false)!.ratio, "9:16");
  });
  await t("ensureMediaLayer is idempotent", () => {
    const p = normalizeProject({ scenes: [{ layers: [{ type: "text", text: "hi" }] }] }, "16:9", false)!;
    const once = ensureMediaLayer(p.scenes[0], "16:9");
    assert.equal(once.layers[0].type, "media");
    assert.equal(ensureMediaLayer(once, "16:9"), once);
  });
  await t("extractJson: fenced / prose-wrapped / none", () => {
    assert.deepEqual(extractJson('Voici:\n```json\n{"a":1}\n```\nok'), { a: 1 });
    assert.throws(() => extractJson("pas de json"));
  });

  console.log("scene identity, captions, music");
  await t("every scene gets a unique uid; a stored project keeps its uids; a model's are ignored", () => {
    const fromModel = normalizeProject({ scenes: [{ uid: "chosenbymodel1" }, {}, {}] }, "16:9", false)!;
    const uids = fromModel.scenes.map((x) => x.uid);
    assert.equal(new Set(uids).size, 3);
    assert.ok(!uids.includes("chosenbymodel1"), "a model can't choose identities");
    const stored = normalizeProject({ scenes: [{ uid: "stored-uid-0001" }, { uid: "stored-uid-0002" }] }, "16:9", true)!;
    assert.deepEqual(stored.scenes.map((x) => x.uid), ["stored-uid-0001", "stored-uid-0002"]);
    const again = normalizeProject(JSON.parse(JSON.stringify(stored)), "16:9", true)!;
    assert.deepEqual(again.scenes.map((x) => x.uid), ["stored-uid-0001", "stored-uid-0002"], "round trip keeps identity");
  });
  await t("a malformed uid is replaced; display numbers follow position", () => {
    const p = normalizeProject({ scenes: [{ uid: "x" }, { uid: "has spaces!!" }, { uid: 12345 }] }, "16:9", true)!;
    assert.ok(p.scenes.every((x) => /^[A-Za-z0-9_-]{6,64}$/.test(x.uid)));
    assert.deepEqual(p.scenes.map((x) => x.id), [1, 2, 3]);
  });
  await t("captions layer: parsed with defaults, placed low, dropped when empty, bad enum falls back", () => {
    const p = normalizeProject({ scenes: [{ layers: [{ type: "captions", text: "Bonjour tout le monde", style: "nope" }, { type: "captions", text: "  " }] }] }, "9:16", false)!;
    const l = p.scenes[0].layers;
    assert.equal(l.length, 1);
    const c = l[0] as any;
    assert.deepEqual([c.type, c.style, c.uppercase, c.highlight], ["captions", "karaoke", false, "#fbbf24"]);
    assert.equal(c.y, 1920 * 0.72, "portrait subtitles sit at 72% of the height");
  });
  await t("music and audio/media offsets only come from stored projects, never from a model", () => {
    const raw = { music: { url: "https://res.cloudinary.com/x/a.mp3", name: "Song", volume: 7 }, scenes: [{ audioUrl: "https://res.cloudinary.com/x/v.mp3", audioOffset: 2.5, videoUrl: "https://res.cloudinary.com/x/c.mp4", mediaOffset: 1 }] };
    const fromModel = normalizeProject(raw, "16:9", false)!;
    assert.equal(fromModel.music, undefined);
    assert.equal(fromModel.scenes[0].audioOffset, undefined);
    const stored = normalizeProject(raw, "16:9", true)!;
    assert.equal(stored.music!.volume, 1, "volume clamped to 0-1");
    assert.deepEqual([stored.scenes[0].audioOffset, stored.scenes[0].mediaOffset], [2.5, 1]);
    assert.equal(normalizeProject({ music: { url: "http://insecure.example/a.mp3" }, scenes: [{}] }, "16:9", true)!.music, undefined, "non-https music is dropped");
    const noAsset = normalizeProject({ scenes: [{ audioOffset: 3, mediaOffset: 3 }] }, "16:9", true)!;
    assert.deepEqual([noAsset.scenes[0].audioOffset, noAsset.scenes[0].mediaOffset], [undefined, undefined], "an offset without its asset is meaningless");
  });

  console.log("prompt");
  await t("scene count follows target length", () => {
    assert.equal(sceneCountFor(15), 3);
    assert.equal(sceneCountFor(30), 6);
    assert.equal(sceneCountFor(60), 12);
  });
  await t("media clause toggles", () => {
    assert.ok(systemPrompt("16:9", false).includes('Do NOT use "media" layers'));
    assert.ok(systemPrompt("16:9", true).includes("BACKDROPS"));
    assert.ok(systemPrompt("16:9", true).includes("1920×1080"));
  });

  console.log("voice providers");
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await t("no keys → both unavailable, but listed", async () => {
    const list = await listVoiceProviders({ live: false });
    assert.deepEqual(list.map((p) => [p.id, p.available]), [["elevenlabs", false], ["openai", false]]);
    assert.ok(list[1].voices.length >= 6);
  });
  await t("missing key reported before anything else", async () => {
    assert.deepEqual(await synthesize("elevenlabs", "hi", "pNInz6OB85MvRmPLz5QN"), { ok: false, error: "CLÉ_ELEVEN_MANQUANTE" });
    assert.deepEqual(await synthesize("openai", "hi", "alloy"), { ok: false, error: "CLÉ_OPENAI_MANQUANTE" });
  });
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  await t("voice ids are validated before any network call (no path injection)", async () => {
    assert.deepEqual(await synthesize("elevenlabs", "hi", "../../v1/user"), { ok: false, error: "VOIX_INVALIDE" });
    assert.deepEqual(await synthesize("elevenlabs", "hi", "abc/def"), { ok: false, error: "VOIX_INVALIDE" });
    assert.deepEqual(await synthesize("openai", "hi", "not-a-voice"), { ok: false, error: "VOIX_INVALIDE" });
  });

  console.log("video models (inputs and prices checked against Replicate schemas and price pages)");
  await t("seedance: tiers set the resolution; audio off; image -> image and no aspect_ratio; duration clamped 2-12", () => {
    const m = getVideoModel("seedance")!;
    const base = { prompt: "p", ratio: "9:16" as const };
    assert.deepEqual(videoInput(m, { ...base, imageUrl: "https://res.cloudinary.com/x.png", duration: 1, quality: "eco" }), { prompt: "p", duration: 2, generate_audio: false, image: "https://res.cloudinary.com/x.png", resolution: "480p" });
    assert.deepEqual(videoInput(m, { ...base, duration: 40, quality: "premium" }), { prompt: "p", duration: 12, generate_audio: false, aspect_ratio: "9:16", resolution: "1080p" });
    assert.equal(m.needsImage, false);
  });
  await t("seedance prices per second of output, without audio: 0.013 / 0.026 / 0.06", () => {
    const m = getVideoModel("seedance")!;
    const c = (quality: "eco" | "standard" | "premium", duration: number) => videoCost(m, { prompt: "", ratio: "16:9", duration, quality });
    assert.ok(Math.abs(c("eco", 5) - 0.065) < 1e-9);
    assert.ok(Math.abs(c("standard", 5) - 0.13) < 1e-9);
    assert.ok(Math.abs(c("premium", 10) - 0.6) < 1e-9);
    assert.ok(Math.abs(c("eco", 1) - 0.026) < 1e-9, "a 1 s scene is billed as the 2 s minimum");
  });
  await t("wan fast: image-to-video only; premium adds 30 fps interpolation; per-clip prices 0.05 / 0.11 / 0.145", () => {
    const m = getVideoModel("wan-fast")!;
    const req = { prompt: "p", imageUrl: "u", ratio: "16:9" as const, duration: 5 };
    assert.equal(m.needsImage, true);
    assert.deepEqual(videoInput(m, { ...req, quality: "standard" }), { prompt: "p", image: "u", resolution: "720p" });
    assert.deepEqual(videoInput(m, { ...req, quality: "premium" }), { prompt: "p", image: "u", resolution: "720p", interpolate_output: true });
    assert.deepEqual((["eco", "standard", "premium"] as const).map((quality) => videoCost(m, { ...req, quality })), [0.05, 0.11, 0.145]);
    assert.equal(getVideoModel("nope"), undefined);
  });

  console.log("pricing");
  await t("Claude cost estimates: Sonnet retouch is about half of Opus; longer videos cost more", () => {
    assert.ok(Math.abs(motionCost(30, "claude-opus-5-5") - 0.332) < 1e-9);
    assert.ok(motionCost(60, "claude-opus-5-5") > 1.9 * motionCost(30, "claude-opus-5-5") - 0.01);
    assert.ok(refineCost("claude-sonnet-5-5") < 0.55 * refineCost("claude-opus-5-5"));
    assert.equal(motionCost(30, "unknown-model"), motionCost(30, "claude-opus-5-5"), "unknown models are priced as Opus (never under-estimate)");
  });
  await t("formatUsd: French decimal comma, 'gratuit' for zero", () => {
    assert.equal(formatUsd(0.09), "0,09 $");
    assert.equal(formatUsd(0), "gratuit");
    assert.equal(formatUsd(0.004), "< 0,01 $");
    assert.equal(formatUsd(2.5), "2,50 $");
  });

  console.log(`\n${n} checks passed`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
