import assert from "node:assert/strict";
import {
  MAX_FADE,
  acceptFor,
  checkPickedFile,
  fadeMax,
  fadeValue,
  fileSummary,
  formatBytes,
  formatSeconds,
  formatsLabel,
  limitLabel,
  loopsToEnd,
  musicNameFromFile,
  newMusic,
  setFade,
  volumeFromPercent,
  volumePercent,
} from "../src/lib/motion/music-utils";
import { UPLOAD_KINDS } from "../src/lib/upload";
import type { Music } from "../src/lib/motion/types";

let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

const music = (o: Partial<Music> = {}): Music => ({ url: "https://res.cloudinary.com/demo/video/upload/a.mp3", name: "Piste", volume: 0.6, fadeIn: 1, fadeOut: 2, duck: true, ...o });
const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const fits = (m: Music, total: number) => assert.ok(m.fadeIn + m.fadeOut <= total + 1e-9, `${m.fadeIn} + ${m.fadeOut} > ${total}`);

console.log("musicNameFromFile");

test("drops the extension only", () => {
  assert.equal(musicNameFromFile("Holiday.mp3"), "Holiday");
  assert.equal(musicNameFromFile("take 2.final.WAV"), "take 2.final");
  assert.equal(musicNameFromFile("sans extension"), "sans extension");
});

test("trims, replaces control characters and falls back to a generic name", () => {
  assert.equal(musicNameFromFile("  a\nb\t.mp3"), "a b");
  assert.equal(musicNameFromFile(".mp3"), "Musique");
  assert.equal(musicNameFromFile("   .ogg"), "Musique");
  assert.equal(musicNameFromFile(""), "Musique");
});

test("at most 120 characters, and never half an emoji", () => {
  assert.equal(musicNameFromFile(`${"a".repeat(300)}.mp3`).length, 120);
  const cut = musicNameFromFile(`${"a".repeat(119)}😀.mp3`); // the emoji straddles the limit
  assert.equal(cut, "a".repeat(119));
  assert.doesNotMatch(cut, /[\uD800-\uDFFF]/);
  assert.equal(musicNameFromFile(`${"a".repeat(118)}😀.mp3`).length, 120);
});

console.log("fades");

test("a fade can use what the other fade leaves of the video", () => {
  assert.equal(fadeMax(music({ fadeIn: 1, fadeOut: 2 }), "fadeIn", 5), 3);
  assert.equal(fadeMax(music({ fadeIn: 1, fadeOut: 2 }), "fadeOut", 5), 4);
  assert.equal(fadeMax(music({ fadeIn: 1, fadeOut: 2 }), "fadeIn", 6.3), 4.3);
  assert.equal(fadeMax(music({ fadeIn: 0, fadeOut: 2.1 }), "fadeIn", 6.3), 4.2, "6.3 - 2.1 is 4.199999999999999: still 4.2");
});

test("never more than MAX_FADE, however long the video", () => {
  assert.equal(MAX_FADE, 10);
  assert.equal(fadeMax(music({ fadeIn: 0, fadeOut: 0 }), "fadeIn", 480), 10);
  assert.equal(setFade(music({ fadeOut: 0 }), "fadeIn", 99, 480).fadeIn, 10);
  assert.equal(setFade(music({ fadeIn: 3 }), "fadeOut", 10, 480).fadeOut, 10);
});

test("setFade caps at the room left and rounds to a tenth", () => {
  assert.equal(setFade(music(), "fadeIn", 4, 5).fadeIn, 3);
  assert.equal(setFade(music(), "fadeIn", 1.26, 60).fadeIn, 1.3);
  assert.equal(setFade(music(), "fadeIn", -2, 60).fadeIn, 0);
  assert.equal(setFade(music(), "fadeOut", 0.04, 60).fadeOut, 0);
});

test("setFade changes the fade asked for and leaves the rest of the music alone", () => {
  const before = deepFreeze(music());
  const after = setFade(before, "fadeOut", 3, 60);
  assert.deepEqual(after, { ...before, fadeOut: 3 });
  assert.notEqual(after, before);
});

test("unusable numbers are zero fades, not NaN", () => {
  assert.equal(setFade(music(), "fadeIn", NaN, 60).fadeIn, 0);
  assert.equal(setFade(music({ fadeOut: NaN }), "fadeIn", 2, 60).fadeOut, 0);
  assert.equal(fadeMax(music(), "fadeIn", NaN), 0);
  assert.equal(fadeMax(music(), "fadeIn", -3), 0);
  assert.equal(fadeMax(music({ fadeOut: Infinity }), "fadeIn", 60), 10, "an infinite fade counts as none");
  assert.equal(setFade(music(), "fadeIn", Infinity, 60).fadeIn, 0);
});

test("a video shortened since the fades were set: the shown value is held inside the bounds, and the next edit repairs the other fade", () => {
  const stale = music({ fadeIn: 8, fadeOut: 9 });
  assert.equal(fadeMax(stale, "fadeIn", 6), 0, "fadeOut alone fills the 6 s");
  assert.equal(fadeValue(stale, "fadeIn", 6), 0);
  assert.equal(fadeValue(stale, "fadeOut", 6), 0, "the other fade is capped at the room too");
  const repaired = setFade(stale, "fadeIn", 2, 6);
  fits(repaired, 6);
  assert.deepEqual([repaired.fadeIn, repaired.fadeOut], [0, 6]);
  assert.equal(fadeValue(music({ fadeIn: 1.25 }), "fadeIn", 60), 1.25, "an off-grid stored value is shown as it is");
});

test("a dragged slider never breaks fadeIn + fadeOut <= total (every pointer step starts from the last result)", () => {
  for (const total of [0.3, 1, 2.5, 3, 6.3, 9.9, 10, 12, 45.7, 480]) {
    let m = music({ fadeIn: 1, fadeOut: 2 });
    for (let step = 0; step <= 120; step++) {
      const key = step % 2 ? "fadeIn" : "fadeOut";
      m = setFade(m, key, ((step * 37) % 130) / 10, total);
      fits(m, total);
      assert.ok(m.fadeIn >= 0 && m.fadeOut >= 0 && m.fadeIn <= MAX_FADE && m.fadeOut <= MAX_FADE);
    }
  }
});

test("the slider's own maximum is reachable and one tenth more is refused", () => {
  const m = music({ fadeIn: 0, fadeOut: 2.4 });
  const max = fadeMax(m, "fadeIn", 7);
  assert.equal(max, 4.6);
  assert.equal(setFade(m, "fadeIn", max, 7).fadeIn, max);
  assert.equal(setFade(m, "fadeIn", max + 0.1, 7).fadeIn, max);
});

console.log("volume");

test("percent and back", () => {
  assert.equal(volumePercent(0.6), 60);
  assert.equal(volumePercent(0.295), 30);
  assert.equal(volumePercent(5), 100);
  assert.equal(volumePercent(-1), 0);
  assert.equal(volumePercent(NaN), 0);
  assert.equal(volumeFromPercent(60), 0.6);
  assert.equal(volumeFromPercent(100), 1);
  assert.equal(volumeFromPercent(140), 1);
  assert.equal(volumeFromPercent(-5), 0);
  assert.equal(volumeFromPercent(NaN), 0);
  for (let p = 0; p <= 100; p++) assert.equal(volumePercent(volumeFromPercent(p)), p);
});

test("formatSeconds", () => {
  assert.equal(formatSeconds(1), "1,0 s");
  assert.equal(formatSeconds(2.25), "2,3 s");
  assert.equal(formatSeconds(NaN), "0,0 s");
});

console.log("newMusic");

test("a fresh track has the documented defaults", () => {
  assert.deepEqual(newMusic("https://x/a.mp3", "Chanson.mp3", 30), { url: "https://x/a.mp3", name: "Chanson", volume: 0.6, fadeIn: 1, fadeOut: 2, duck: true });
  assert.deepEqual(newMusic("https://x/a.mp3", "Chanson.mp3", 3), { url: "https://x/a.mp3", name: "Chanson", volume: 0.6, fadeIn: 1, fadeOut: 2, duck: true });
});

test("a short video gets shorter fades that still fit", () => {
  for (const total of [0, NaN, 0.05, 0.3, 1, 1.3, 2, 2.9, 3, 10, 480]) {
    const m = newMusic("https://x/a.mp3", "a.mp3", total);
    fits(m, Number.isFinite(total) ? total : 0);
    assert.ok(Number.isFinite(m.fadeIn) && Number.isFinite(m.fadeOut) && m.fadeIn >= 0 && m.fadeOut >= 0);
  }
  assert.deepEqual([newMusic("u", "a.mp3", 2).fadeIn, newMusic("u", "a.mp3", 2).fadeOut], [1, 1]);
  assert.deepEqual([newMusic("u", "a.mp3", 0.5).fadeIn, newMusic("u", "a.mp3", 0.5).fadeOut], [0.5, 0]);
  assert.deepEqual([newMusic("u", "a.mp3", 0).fadeIn, newMusic("u", "a.mp3", 0).fadeOut], [0, 0]);
});

console.log("checkPickedFile");

test("a good file is accepted, whatever the case of its extension", () => {
  assert.equal(checkPickedFile({ name: "song.mp3", size: 4_000_000 }, "audio"), null);
  assert.equal(checkPickedFile({ name: "SONG.FLAC", size: 4_000_000 }, "audio"), null);
  assert.equal(checkPickedFile({ name: "photo.JPEG", size: 400_000 }, "image"), null);
  assert.equal(checkPickedFile({ name: "clip.mov", size: 40_000_000 }, "video"), null);
});

test("every format upload.ts lists is accepted, and others are refused with the list", () => {
  for (const kind of ["audio", "image", "video"] as const) {
    for (const format of UPLOAD_KINDS[kind].formats) assert.equal(checkPickedFile({ name: `x.${format}`, size: 1000 }, kind), null, `${kind} ${format}`);
  }
  const refusal = checkPickedFile({ name: "song.wma", size: 1000 }, "audio");
  assert.match(refusal ?? "", /^Format non pris en charge \(\.wma\)\. Formats acceptés : mp3, m4a/);
  assert.match(checkPickedFile({ name: "song", size: 1000 }, "audio") ?? "", /^Format non pris en charge\. /);
  assert.match(checkPickedFile({ name: "song.mp3.exe", size: 1000 }, "audio") ?? "", /\(\.exe\)/);
  assert.match(checkPickedFile({ name: "clip.mp4", size: 1000 }, "image") ?? "", /Format non pris en charge/, "a video is not an image");
});

test("the size limit comes from upload.ts, in decimal megabytes", () => {
  const { maxBytes } = UPLOAD_KINDS.audio;
  assert.equal(checkPickedFile({ name: "a.mp3", size: maxBytes }, "audio"), null);
  assert.equal(checkPickedFile({ name: "a.mp3", size: maxBytes + 1 }, "audio"), "Fichier trop volumineux : 30 Mo (maximum 30 Mo).");
  assert.equal(checkPickedFile({ name: "a.mp3", size: 31_500_000 }, "audio"), "Fichier trop volumineux : 31,5 Mo (maximum 30 Mo).");
  assert.equal(checkPickedFile({ name: "a.mp4", size: UPLOAD_KINDS.video.maxBytes + 1 }, "video")?.startsWith("Fichier trop volumineux"), true);
});

test("a photo is never refused for its weight (it is shrunk), an empty file always is", () => {
  assert.equal(checkPickedFile({ name: "photo.jpg", size: 80_000_000 }, "image"), null);
  assert.equal(checkPickedFile({ name: "photo.jpg", size: 0 }, "image"), "Ce fichier est vide ou illisible.");
  assert.equal(checkPickedFile({ name: "a.mp3", size: 0 }, "audio"), "Ce fichier est vide ou illisible.");
  assert.equal(checkPickedFile({ name: "a.mp3", size: NaN }, "audio"), "Ce fichier est vide ou illisible.");
});

console.log("labels");

test("accept covers the extensions and the media types", () => {
  const audio = acceptFor("audio").split(",");
  for (const format of UPLOAD_KINDS.audio.formats) assert.ok(audio.includes(`.${format}`), format);
  assert.ok(audio.includes("audio/*"));
  assert.equal(acceptFor("image"), ".jpg,.png,.webp,image/jpeg,image/png,image/webp");
  assert.equal(acceptFor("video"), ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm");
});

test("formats and limits are the ones of upload.ts", () => {
  assert.equal(formatsLabel("audio"), "MP3, M4A, WAV, OGG, OPUS, AAC, FLAC");
  assert.equal(formatsLabel("image"), "JPG, PNG, WEBP");
  assert.equal(limitLabel("audio"), "30 Mo");
  assert.equal(limitLabel("video"), "100 Mo");
  assert.equal(limitLabel("image"), "10 Mo");
});

test("formatBytes", () => {
  assert.equal(formatBytes(820_000), "820 Ko");
  assert.equal(formatBytes(1), "1 Ko");
  assert.equal(formatBytes(999_400), "999 Ko");
  assert.equal(formatBytes(999_600), "1 Mo");
  assert.equal(formatBytes(3_400_000), "3,4 Mo");
  assert.equal(formatBytes(30_000_000), "30 Mo");
});

test("fileSummary says what is known", () => {
  assert.equal(fileSummary(3_400_000, 125), "3,4 Mo · 2:05");
  assert.equal(fileSummary(3_400_000, undefined), "3,4 Mo");
  assert.equal(fileSummary(undefined, 125), "2:05");
  assert.equal(fileSummary(undefined, undefined), "");
  assert.equal(fileSummary(0, NaN), "");
});

test("loopsToEnd only speaks when the browser reported a length shorter than the video", () => {
  assert.equal(loopsToEnd(20, 60), true);
  assert.equal(loopsToEnd(60, 60), false);
  assert.equal(loopsToEnd(59.95, 60), false, "a few frames are not worth a warning");
  assert.equal(loopsToEnd(120, 60), false);
  assert.equal(loopsToEnd(undefined, 60), false);
  assert.equal(loopsToEnd(NaN, 60), false);
  assert.equal(loopsToEnd(0, 60), false);
  assert.equal(loopsToEnd(20, NaN), false);
  assert.equal(loopsToEnd(20, Infinity), false);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
