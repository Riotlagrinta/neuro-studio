import assert from "node:assert/strict";
import { getVideoModel, QUALITY_LABELS, VIDEO_MODELS, VIDEO_QUALITIES, videoCost, videoInput, type VideoQuality, type VideoRequest } from "../src/lib/video-models";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  ok -", name);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// What each engine accepts and bills. Written from the Replicate schemas and price pages checked on 2026-10-08,
// deliberately NOT derived from src/lib/video-models.ts: the grid below compares the code against this table.
interface Spec {
  slug: string;
  needsImage: boolean;
  /** Every input name we may send (all exist in the model's schema); anything else is a bug. */
  inputs: string[];
  /** Name of the start-frame input. */
  imageKey: "image" | "start_image";
  /** aspect_ratio when an image is given: the model ignores it (not sent), follows the image ('auto'), or still needs it. */
  ratioWithImage: "omitted" | "auto" | "sent";
  /** aspect_ratio values the schema accepts. */
  ratios: string[];
  /** The schema's duration constraint. */
  durationOk?: (seconds: number) => boolean;
  /** Whole seconds rendered (and billed) for a requested length. Absent: no duration input, the model bills per clip. */
  seconds?: (requested: number, quality: VideoQuality) => number;
  /** resolution sent per quality. Absent: the model has no resolution input. */
  resolution?: Record<VideoQuality, string>;
  /** USD per second of output video (per clip when `seconds` is absent). Where sources disagree: the higher price. */
  rate: Record<VideoQuality, number>;
}

const RATIOS = ["16:9", "9:16"] as const;
const IMAGE = "https://res.cloudinary.com/demo/scene.png";
const same = (v: number): Record<VideoQuality, number> => ({ eco: v, standard: v, premium: v });
const clamp = (lo: number, hi: number) => (requested: number) => Math.round(Math.min(hi, Math.max(lo, requested)));
const integerIn = (lo: number, hi: number) => (s: number) => Number.isInteger(s) && s >= lo && s <= hi;
/** Smallest allowed value that covers the request (the largest one when nothing does). */
const snapUp = (allowed: number[]) => (requested: number) => {
  const covering = allowed.filter((a) => a >= Math.round(requested));
  return covering.length ? Math.min(...covering) : Math.max(...allowed);
};
/** The allowed value closest to the request. */
const nearest = (allowed: number[]) => (requested: number) =>
  allowed.reduce((best, a) => (Math.abs(a - Math.round(requested)) < Math.abs(best - Math.round(requested)) ? a : best));

const SPECS: Record<string, Spec> = {
  seedance: {
    slug: "bytedance/seedance-1.5-pro",
    needsImage: false,
    inputs: ["prompt", "duration", "generate_audio", "resolution", "image", "aspect_ratio"],
    imageKey: "image",
    ratioWithImage: "omitted",
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    durationOk: integerIn(2, 12),
    seconds: clamp(2, 12),
    resolution: { eco: "480p", standard: "720p", premium: "1080p" },
    rate: { eco: 0.013, standard: 0.026, premium: 0.06 }, // without audio
  },
  wan3: {
    slug: "alibaba/wan-3",
    needsImage: false,
    inputs: ["prompt", "duration", "resolution", "image", "aspect_ratio"],
    imageKey: "image",
    ratioWithImage: "omitted",
    ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
    durationOk: integerIn(2, 30),
    seconds: clamp(2, 12),
    resolution: { eco: "480p", standard: "720p", premium: "1080p" },
    rate: { eco: 0.05, standard: 0.1, premium: 0.2 }, // README (worst case); the live billing config shows half
  },
  kling: {
    slug: "kwaivgi/kling-v2.5-turbo-pro",
    needsImage: false,
    inputs: ["prompt", "duration", "start_image", "aspect_ratio"],
    imageKey: "start_image",
    ratioWithImage: "omitted",
    ratios: ["16:9", "9:16", "1:1"],
    durationOk: (s) => s === 5 || s === 10,
    seconds: nearest([5, 10]),
    rate: same(0.07),
  },
  veo: {
    slug: "google/veo-3.1-lite",
    needsImage: false,
    inputs: ["prompt", "duration", "resolution", "image", "aspect_ratio"],
    imageKey: "image",
    ratioWithImage: "sent",
    ratios: ["16:9", "9:16"],
    durationOk: (s) => s === 4 || s === 6 || s === 8,
    seconds: (requested, quality) => (quality === "premium" ? 8 : snapUp([4, 6, 8])(requested)), // 1080p requires 8 s
    resolution: { eco: "720p", standard: "720p", premium: "1080p" },
    rate: { eco: 0.05, standard: 0.05, premium: 0.08 },
  },
  grok: {
    slug: "xai/grok-imagine-video",
    needsImage: false,
    inputs: ["prompt", "duration", "resolution", "image", "aspect_ratio"],
    imageKey: "image",
    ratioWithImage: "auto",
    ratios: ["auto", "16:9", "4:3", "1:1", "9:16", "3:4", "3:2", "2:3"],
    durationOk: integerIn(1, 15),
    seconds: clamp(1, 12), // the schema accepts 15 s; the app caps every engine at 12 s
    resolution: { eco: "480p", standard: "720p", premium: "720p" },
    rate: same(0.05),
  },
  "wan-fast": {
    slug: "wan-video/wan-2.2-i2v-fast",
    needsImage: true,
    inputs: ["prompt", "image", "resolution", "interpolate_output"],
    imageKey: "image",
    ratioWithImage: "omitted",
    ratios: [],
    resolution: { eco: "480p", standard: "720p", premium: "720p" },
    rate: { eco: 0.05, standard: 0.11, premium: 0.145 }, // per clip
  },
};

// Whole seconds 1..15, plus fractions and out-of-range lengths (the interface passes scene lengths as they are).
const DURATIONS = [...new Set([...Array.from({ length: 15 }, (_, i) => i + 1), 0.4, 2.5, 4.5, 7.4, 7.5, 12.6, 40])].sort((a, b) => a - b);

console.log("video models (inputs and prices checked against Replicate schemas and price pages)");

t("ids are unique and match the table; the first one (the UI default) is seedance", () => {
  const ids = VIDEO_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "seedance");
  assert.deepEqual([...ids].sort(), Object.keys(SPECS).sort(), "a model was added or removed: update the table in this test");
});

t("slugs are Replicate owner/name and match the verified ones; labels, notes and details are filled in", () => {
  for (const m of VIDEO_MODELS) {
    assert.match(m.slug, /^[a-z0-9-]+\/[a-z0-9.-]+$/, m.id);
    assert.equal(m.slug, SPECS[m.id].slug, m.id);
    assert.ok(m.label.trim().length > 0, `${m.id} label`);
    assert.ok(m.note.trim().length > 0 && m.note.length <= 80, `${m.id} note must be a short hint: "${m.note}"`);
    for (const q of VIDEO_QUALITIES) assert.ok(m.tiers[q].detail.trim().length > 0, `${m.id} ${q} detail`);
  }
  const labels = VIDEO_MODELS.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const q of VIDEO_QUALITIES) assert.ok(QUALITY_LABELS[q]);
});

t("getVideoModel finds a model by id and returns undefined otherwise; only wan-fast needs an image", () => {
  for (const m of VIDEO_MODELS) assert.equal(getVideoModel(m.id), m);
  assert.equal(getVideoModel("seedance-1-lite"), undefined, "the old Seedance 1 Lite is gone");
  assert.equal(getVideoModel("nope"), undefined);
  for (const m of VIDEO_MODELS) assert.equal(m.needsImage, SPECS[m.id].needsImage, m.id);
});

t("grid: model x quality x duration x ratio x image: inputs follow the schema, cost follows the price table", () => {
  const priceSeen = new Map<string, number>();
  let combos = 0;
  for (const model of VIDEO_MODELS) {
    const spec = SPECS[model.id];
    for (const quality of VIDEO_QUALITIES) {
      for (const duration of DURATIONS) {
        for (const ratio of RATIOS) {
          for (const imageUrl of [undefined, IMAGE]) {
            if (spec.needsImage && !imageUrl) continue; // actions.startVideoJob refuses these before any call
            combos++;
            const ctx = `${model.id} ${quality} ${duration}s ${ratio} ${imageUrl ? "image" : "text"}`;
            const req: VideoRequest = { prompt: "waves at dusk", imageUrl, ratio, duration, quality };
            const input = videoInput(model, req);
            const rendered = spec.seconds?.(duration, quality);

            // Only known inputs, none undefined (JSON would silently drop it).
            for (const [key, value] of Object.entries(input)) {
              assert.ok(spec.inputs.includes(key), `${ctx}: unexpected input "${key}"`);
              assert.notEqual(value, undefined, `${ctx}: "${key}" is undefined`);
            }
            assert.equal(input.prompt, "waves at dusk", ctx);

            // Duration: sent when the model has one, in its allowed values, and the one that gets billed.
            if (spec.seconds && spec.durationOk) {
              assert.ok(spec.durationOk(input.duration as number), `${ctx}: duration ${String(input.duration)} not accepted by the schema`);
              assert.equal(input.duration, rendered, ctx);
            } else {
              assert.equal("duration" in input, false, `${ctx}: this model has a fixed length`);
            }

            // Resolution: always explicit where the model has one (its default is the most expensive tier).
            if (spec.resolution) assert.equal(input.resolution, spec.resolution[quality], ctx);
            else assert.equal("resolution" in input, false, ctx);

            // Start frame.
            const imageKeys = ["image", "start_image"].filter((k) => k in input);
            assert.deepEqual(imageKeys, imageUrl ? [spec.imageKey] : [], ctx);
            if (imageUrl) assert.equal(input[spec.imageKey], imageUrl, ctx);

            // aspect_ratio: omitted exactly when the model ignores it with an image.
            if (imageUrl && spec.ratioWithImage === "omitted") assert.equal("aspect_ratio" in input, false, ctx);
            else if (imageUrl && spec.ratioWithImage === "auto") assert.equal(input.aspect_ratio, "auto", ctx);
            else if (spec.ratios.length) assert.equal(input.aspect_ratio, ratio, ctx);
            else assert.equal("aspect_ratio" in input, false, ctx);
            if ("aspect_ratio" in input) assert.ok(spec.ratios.includes(input.aspect_ratio as string), `${ctx}: ratio not accepted`);

            // Audio: Seedance generates (and bills) sound unless told not to.
            if (model.id === "seedance") assert.equal(input.generate_audio, false, ctx);
            else assert.equal("generate_audio" in input, false, ctx);

            // Cost: independent recomputation, positive, finite, tied to the length actually sent.
            const cost = videoCost(model, req);
            assert.ok(Number.isFinite(cost) && cost > 0, `${ctx}: cost ${cost}`);
            assert.ok(near(cost, (rendered ?? 1) * spec.rate[quality]), `${ctx}: cost ${cost}, expected ${(rendered ?? 1) * spec.rate[quality]}`);
            if (spec.seconds) assert.ok(near(cost, (input.duration as number) * spec.rate[quality]), `${ctx}: cost must follow the duration sent`);

            // The estimate shown before any image exists is the one charged afterwards, whatever the ratio.
            const key = `${model.id} ${quality} ${duration}`;
            assert.ok(near(priceSeen.get(key) ?? cost, cost), `${ctx}: price depends on ratio or image`);
            priceSeen.set(key, cost);
          }
        }
      }
    }
  }
  assert.ok(combos > 1000, `grid too small (${combos})`);
});

t("cost never decreases with duration, and never decreases with quality", () => {
  for (const model of VIDEO_MODELS) {
    for (const quality of VIDEO_QUALITIES) {
      let previous = 0;
      for (const duration of DURATIONS) {
        const cost = videoCost(model, { prompt: "", ratio: "16:9", duration, quality });
        assert.ok(cost >= previous - 1e-12, `${model.id} ${quality}: ${duration}s costs ${cost} < ${previous}`);
        previous = cost;
      }
    }
    for (const duration of DURATIONS) {
      const [eco, standard, premium] = VIDEO_QUALITIES.map((quality) => videoCost(model, { prompt: "", ratio: "16:9", duration, quality }));
      assert.ok(eco <= standard + 1e-12 && standard <= premium + 1e-12, `${model.id} ${duration}s: ${eco} / ${standard} / ${premium}`);
    }
  }
});

t("spot prices taken from the pages: Seedance 5 s eco 0.065 $, Wan 3 5 s 0.25 / 0.50 / 1.00 $, Kling 0.35 / 0.70 $, Grok 5 s 0.25 $", () => {
  const c = (id: string, quality: VideoQuality, duration: number) => videoCost(getVideoModel(id)!, { prompt: "", ratio: "16:9", duration, quality });
  assert.ok(near(c("seedance", "eco", 5), 0.065));
  assert.ok(near(c("seedance", "premium", 5), 0.3));
  assert.ok(near(c("wan3", "eco", 5), 0.25) && near(c("wan3", "standard", 5), 0.5) && near(c("wan3", "premium", 5), 1));
  assert.ok(near(c("kling", "standard", 5), 0.35) && near(c("kling", "standard", 10), 0.7));
  assert.ok(near(c("grok", "standard", 5), 0.25) && near(c("grok", "standard", 12), 0.6));
});

t("costs carry no float noise: a clip priced 0.35 $ is exactly 0.35, so a 0.35 $ daily cap accepts it", () => {
  const c = (id: string, quality: VideoQuality, duration: number) => videoCost(getVideoModel(id)!, { prompt: "", ratio: "16:9", duration, quality });
  assert.equal(c("kling", "standard", 5), 0.35);
  assert.equal(c("wan3", "eco", 6), 0.3);
  assert.equal(c("wan3", "premium", 12), 2.4);
  assert.equal(c("seedance", "eco", 9), 0.117);
  for (const model of VIDEO_MODELS) {
    for (const quality of VIDEO_QUALITIES) {
      for (let duration = 1; duration <= 40; duration++) {
        const cost = videoCost(model, { prompt: "", ratio: "16:9", duration, quality });
        assert.equal(cost, Math.round(cost * 1e4) / 1e4, `${model.id} ${quality} ${duration}s: ${cost}`);
      }
    }
  }
});

t("no engine is asked for more than 12 s, so the price shown for a long scene is the one charged", () => {
  for (const model of VIDEO_MODELS) {
    for (const quality of VIDEO_QUALITIES) {
      const long = { prompt: "p", ratio: "16:9", duration: 40, quality } as const;
      const sent = videoInput(model, long).duration;
      assert.ok(sent === undefined || (sent as number) <= 12, `${model.id} ${quality}: ${String(sent)} s`);
      for (const duration of [12, 15, 40]) assert.equal(videoCost(model, { ...long, duration }), videoCost(model, { ...long, duration: 12 }), `${model.id} ${quality} ${duration}s`);
    }
  }
  const grok = getVideoModel("grok")!;
  assert.equal(videoCost(grok, { prompt: "", ratio: "16:9", duration: 15, quality: "standard" }), 0.6);
});

t("veo: 4 / 6 / 8 s at 0.05 $/s in 720p; premium is 1080p, always an 8 s clip, 0.64 $", () => {
  const m = getVideoModel("veo")!;
  const input = (duration: number, quality: VideoQuality) => videoInput(m, { prompt: "p", ratio: "9:16", duration, quality });
  const cost = (duration: number, quality: VideoQuality) => videoCost(m, { prompt: "p", ratio: "9:16", duration, quality });
  for (const duration of DURATIONS) {
    assert.equal(input(duration, "premium").duration, 8, `${duration}s`);
    assert.equal(input(duration, "premium").resolution, "1080p");
    assert.ok(near(cost(duration, "premium"), 0.64), `${duration}s`);
    for (const quality of ["eco", "standard"] as const) {
      assert.equal(input(duration, quality).resolution, "720p");
      assert.ok([4, 6, 8].includes(input(duration, quality).duration as number));
    }
  }
  assert.deepEqual([1, 4, 4.4, 5, 6, 7, 8, 12].map((d) => input(d, "eco").duration), [4, 4, 4, 6, 6, 8, 8, 8]);
  assert.ok(near(cost(4, "eco"), 0.2) && near(cost(5, "standard"), 0.3) && near(cost(8, "eco"), 0.4));
  assert.equal(input(5, "eco").aspect_ratio, "9:16");
  // aspect_ratio is sent even with an image: the schema does not say Veo ignores it.
  assert.equal(videoInput(m, { prompt: "p", imageUrl: IMAGE, ratio: "9:16", duration: 5, quality: "eco" }).aspect_ratio, "9:16");
});

t("kling: duration is only 5 or 10 s, no resolution input, the three tiers are identical", () => {
  const m = getVideoModel("kling")!;
  const durations = new Set<unknown>();
  for (const duration of DURATIONS) for (const quality of VIDEO_QUALITIES) durations.add(videoInput(m, { prompt: "p", ratio: "16:9", duration, quality }).duration);
  assert.deepEqual([...durations].sort(), [10, 5]);
  assert.deepEqual([1, 5, 7, 7.4, 8, 12].map((d) => videoInput(m, { prompt: "p", ratio: "16:9", duration: d, quality: "eco" }).duration), [5, 5, 5, 5, 10, 10]);
  const [eco, standard, premium] = VIDEO_QUALITIES.map((quality) => m.tiers[quality]);
  assert.deepEqual([eco.params, eco.detail], [standard.params, standard.detail]);
  assert.deepEqual([eco.params, eco.detail], [premium.params, premium.detail]);
  assert.equal(eco.detail, "HD");
});

t("grok: 480p only in the economical tier; the ratio is 'auto' with an image, the project ratio otherwise", () => {
  const m = getVideoModel("grok")!;
  const input = (imageUrl: string | undefined, quality: VideoQuality) => videoInput(m, { prompt: "p", imageUrl, ratio: "9:16", duration: 20, quality });
  assert.deepEqual(input(undefined, "eco"), { prompt: "p", duration: 12, aspect_ratio: "9:16", resolution: "480p" });
  assert.deepEqual(input(IMAGE, "premium"), { prompt: "p", duration: 12, aspect_ratio: "auto", image: IMAGE, resolution: "720p" });
  assert.equal(input(undefined, "standard").resolution, "720p");
});

t("seedance and wan 3: 2 to 12 s, resolution always explicit, image replaces aspect_ratio", () => {
  for (const id of ["seedance", "wan3"]) {
    const m = getVideoModel(id)!;
    const input = (imageUrl: string | undefined, duration: number) => videoInput(m, { prompt: "p", imageUrl, ratio: "9:16", duration, quality: "premium" });
    assert.equal(input(undefined, 1).duration, 2, id);
    assert.equal(input(undefined, 40).duration, 12, id);
    assert.equal(input(undefined, 6).aspect_ratio, "9:16", id);
    assert.equal(input(undefined, 6).resolution, "1080p", id);
    assert.deepEqual(input(IMAGE, 6), { prompt: "p", duration: 6, image: IMAGE, resolution: "1080p", ...(id === "seedance" ? { generate_audio: false } : {}) }, id);
  }
});

console.log(`\n${n} checks passed`);
