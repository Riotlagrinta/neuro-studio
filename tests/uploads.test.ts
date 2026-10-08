import { calls, requests, setHandler } from "./stubs/env-setup";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setDb } from "./stubs/db-shim";
import { setUser } from "./stubs/auth-stub";
import cloudinary from "../src/lib/cloudinary";
import * as actions from "../src/app/actions";
import { DAILY_LIMITS } from "../src/lib/access";
import { upsertUser } from "../src/lib/users";
import {
  buildPublicId,
  CONFIRM_ATTEMPTS,
  checkUploadRequest,
  fileFormat,
  isUploadKind,
  ownCloudinaryUrl,
  ownsPublicId,
  planImageResize,
  UPLOAD_KINDS,
  userSlug,
  type UploadKind,
} from "../src/lib/upload";
import { uploadFile, UploadError } from "../src/lib/upload-client";

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

// ---- the Cloudinary secret is fake, and the signature is recomputed here, independently of the SDK ----
const SECRET = "fake-secret-for-tests";
cloudinary.config({ api_secret: SECRET });

/** Cloudinary's documented algorithm: sorted name=value pairs joined by "&", the secret appended, SHA-1 in hex. */
const signWith = (fields: Record<string, string>, secret: string) =>
  createHash("sha1")
    .update(
      Object.keys(fields)
        .filter((k) => k !== "signature")
        .sort()
        .map((k) => `${k}=${fields[k]}`)
        .join("&") + secret,
    )
    .digest("hex");

// ---- Cloudinary's admin and uploader calls are observable, and scripted per test ----
const adminCalls: { publicId: string; options: any }[] = [];
const destroyCalls: { publicId: string; options: any }[] = [];
const unexpected = async (): Promise<any> => {
  throw new Error("unexpected Cloudinary call");
};
let resourceImpl: (publicId: string, options: any) => Promise<any> = unexpected;
let destroyImpl: (publicId: string, options: any) => Promise<any> = async () => ({ result: "ok" });
(cloudinary.api as any).resource = async (publicId: string, options: any) => {
  adminCalls.push({ publicId, options });
  return resourceImpl(publicId, options);
};
(cloudinary.uploader as any).destroy = async (publicId: string, options: any) => {
  destroyCalls.push({ publicId, options });
  return destroyImpl(publicId, options);
};

const DEFAULT_HANDLER = () => new Response("{}", { status: 500 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const MB = 1_000_000;
const UUID = "0b9d6c1e-6f7a-4c52-9d4e-3a1f5b8c2d70";
const NONCE = "5f0c9a7e-1b2d-4e3f-8a9b-0c1d2e3f4a5b";

// ============================================================================================ pure helpers

async function pureHelpers() {
  console.log("\n=== pure helpers ===");

  await t("the independent signer reproduces Cloudinary's two documented examples", () => {
    assert.equal(signWith({ timestamp: "1315060510" }, "abcd"), "a21ad0f63beb4de2e5575204b79ab90bffb02c10");
    assert.equal(
      signWith({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: "1315060510" }, "abcd"),
      "bfd09f95f331f558cbd1320e67aa8d488770583e",
    );
  });

  await t("kinds: audio and video live under Cloudinary's video type; no heic, gif, svg or raw", () => {
    assert.deepEqual(Object.keys(UPLOAD_KINDS).sort(), ["audio", "image", "video"]);
    assert.deepEqual([UPLOAD_KINDS.audio.resourceType, UPLOAD_KINDS.image.resourceType, UPLOAD_KINDS.video.resourceType], ["video", "image", "video"]);
    assert.deepEqual([UPLOAD_KINDS.audio.maxBytes, UPLOAD_KINDS.image.maxBytes, UPLOAD_KINDS.video.maxBytes], [30 * MB, 10 * MB, 100 * MB]);
    assert.deepEqual(UPLOAD_KINDS.audio.formats, ["mp3", "m4a", "wav", "ogg", "opus", "aac", "flac"]);
    assert.deepEqual(UPLOAD_KINDS.image.formats, ["jpg", "png", "webp"]);
    assert.deepEqual(UPLOAD_KINDS.video.formats, ["mp4", "mov", "webm"]);
    const every = Object.values(UPLOAD_KINDS).flatMap((k) => k.formats);
    for (const bad of ["heic", "heif", "gif", "svg", "raw", "jpeg", "exe", "avif"]) assert.ok(!every.includes(bad), bad);
    assert.ok(every.every((f) => f === f.toLowerCase()));
    assert.ok(Object.values(UPLOAD_KINDS).every((k) => k.label.length > 0));
  });

  await t("isUploadKind: only the three kinds, never an inherited property", () => {
    for (const ok of ["audio", "image", "video"]) assert.equal(isUploadKind(ok), true);
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty", "raw", "auto", "Audio", "", null, undefined, 5, {}, ["audio"]]) {
      assert.equal(isUploadKind(bad), false, String(bad));
    }
  });

  await t("userSlug keeps [A-Za-z0-9_-] only, whatever it is given", () => {
    assert.equal(userSlug(UUID), UUID);
    assert.equal(userSlug("../../etc/passwd"), "etcpasswd");
    assert.equal(userSlug("a/b\\c?d&e#f%g<h>i+j.k=l|m,n"), "abcdefghijklmn");
    assert.equal(userSlug("é\u0000\n \t🙂"), "");
    assert.equal(userSlug("snake_case-and-ABC123"), "snake_case-and-ABC123");
    assert.equal(userSlug("x".repeat(500)).length, 64);
  });

  await t("buildPublicId: neuro-studio/<kind>/<user>/<nonce>, nothing Cloudinary forbids, no extension", () => {
    const id = buildPublicId("audio", UUID, NONCE);
    assert.equal(id, `neuro-studio/audio/${UUID}/${NONCE}`);
    assert.ok(!/[&?#\\%<>+.\s]/.test(id));
    assert.ok(id.length < 255);
    // hostile user ids can only lose characters
    assert.equal(buildPublicId("image", "../x&y?z", NONCE), `neuro-studio/image/xyz/${NONCE}`);
  });

  await t("buildPublicId refuses an empty user and a nonce that is short or has path characters", () => {
    assert.throws(() => buildPublicId("audio", "../../", NONCE));
    assert.throws(() => buildPublicId("audio", "", NONCE));
    for (const nonce of ["", "short", "../../../etc", "a/b/c/d/e/f/g", "with space 1234", "dot.dot.dot", "x".repeat(65), `${NONCE}\n`]) {
      assert.throws(() => buildPublicId("audio", UUID, nonce), nonce);
    }
  });

  await t("ownsPublicId: only the owner, only that kind, only that exact shape", () => {
    const own = buildPublicId("audio", UUID, NONCE);
    assert.equal(ownsPublicId(own, "audio", UUID), true);
    assert.equal(ownsPublicId(own, "video", UUID), false, "another kind");
    assert.equal(ownsPublicId(own, "audio", "someone-else"), false, "another user");
    assert.equal(ownsPublicId(own, "audio", UUID.slice(0, -1)), false, "a user whose slug is a prefix of the owner's");
    assert.equal(ownsPublicId(`neuro-studio/audio/${UUID}x/${NONCE}`, "audio", UUID), false);
    for (const hostile of [
      `${own}/extra`,
      `${own}/../other`,
      `${own}.mp3`,
      `${own}\n`,
      ` ${own}`,
      `neuro-studio/audio/${UUID}/..`,
      `neuro-studio/audio/${UUID}/`,
      `neuro-studio/audio/${UUID}/short`,
      `neuro-studio/audio/${UUID}/%2e%2e%2e%2e%2e%2e%2e%2e`,
      `neuro-studio/audio/../audio/${UUID}/${NONCE}`,
      own.toUpperCase(),
      "",
      "neuro-studio",
    ]) {
      assert.equal(ownsPublicId(hostile, "audio", UUID), false, JSON.stringify(hostile));
    }
    for (const notAString of [undefined, null, 5, {}, ["x"], true]) assert.equal(ownsPublicId(notAString, "audio", UUID), false);
    assert.equal(ownsPublicId("neuro-studio/audio//abcdefgh", "audio", ""), false, "an empty user owns nothing");
    assert.equal(ownsPublicId("neuro-studio/audio//abcdefgh", "audio", "../"), false);
  });

  await t("checkUploadRequest: valid sizes up to each cap", () => {
    assert.deepEqual(checkUploadRequest({ kind: "audio", size: 1 }), { ok: true, kind: "audio", size: 1 });
    assert.equal(checkUploadRequest({ kind: "audio", size: 30 * MB }).ok, true);
    assert.equal(checkUploadRequest({ kind: "image", size: 10 * MB }).ok, true);
    assert.equal(checkUploadRequest({ kind: "video", size: 100 * MB }).ok, true);
  });

  await t("checkUploadRequest: bad kind, bad size, over the cap", () => {
    const err = (input: unknown) => {
      const r = checkUploadRequest(input);
      return r.ok ? "ok" : r.error;
    };
    assert.equal(err({ kind: "audio", size: 30 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    assert.equal(err({ kind: "image", size: 10 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    assert.equal(err({ kind: "video", size: 100 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    for (const kind of ["constructor", "__proto__", "raw", "auto", "", 3, null, undefined]) assert.equal(err({ kind, size: 5 }), "TYPE_INVALIDE", String(kind));
    for (const size of [0, -1, 1.5, NaN, Infinity, -Infinity, "5", "", null, undefined, [], {}, true]) {
      assert.equal(err({ kind: "audio", size }), "TAILLE_INVALIDE", String(size));
    }
    for (const input of [null, undefined, "audio", 5, [], {}]) assert.equal(err(input), "TYPE_INVALIDE", String(input));
  });

  await t("fileFormat: the extension as Cloudinary names it", () => {
    assert.equal(fileFormat("Mon Morceau.MP3"), "mp3");
    assert.equal(fileFormat("holiday.JPEG"), "jpg");
    assert.equal(fileFormat("take.oga"), "ogg");
    assert.equal(fileFormat("archive.tar.gz"), "gz");
    assert.equal(fileFormat("noextension"), undefined);
    assert.equal(fileFormat("trailing."), undefined);
    assert.equal(fileFormat(""), undefined);
  });

  await t("planImageResize: leaves a light photo alone", () => {
    assert.deepEqual(planImageResize(4000, 3000, 3 * MB), { resize: false, width: 4000, height: 3000 });
    assert.deepEqual(planImageResize(6000, 4000, 2 * MB), { resize: false, width: 6000, height: 4000 }, "24 MP is under the 25 MP cap");
    assert.deepEqual(planImageResize(5000, 5000, 10 * MB), { resize: false, width: 5000, height: 5000 }, "exactly 25 MP and exactly 10 MB");
  });

  await t("planImageResize: a heavy or huge photo is shrunk to 4096 px on its long side, ratio kept", () => {
    assert.deepEqual(planImageResize(8000, 6000, 9 * MB), { resize: true, width: 4096, height: 3072 }, "48 MP phone photo");
    assert.deepEqual(planImageResize(6000, 4500, 2 * MB), { resize: true, width: 4096, height: 3072 }, "27 MP");
    assert.deepEqual(planImageResize(3000, 12000, 1 * MB), { resize: true, width: 1024, height: 4096 }, "36 MP panorama, portrait");
    assert.deepEqual(planImageResize(4000, 3000, 12 * MB), { resize: true, width: 4000, height: 3000 }, "too heavy but small: re-encode only, never enlarged");
    assert.deepEqual(planImageResize(1000, 800, 10 * MB + 1), { resize: true, width: 1000, height: 800 });
    assert.deepEqual(planImageResize(1, 40_000, 5 * MB), { resize: false, width: 1, height: 40_000 }, "a thin strip is light for Cloudinary: left alone");
  });

  await t("planImageResize: whatever the input, the result fits both caps", () => {
    for (const [w, h] of [[12000, 9000], [9000, 12000], [20000, 20000], [4097, 4097], [30000, 900], [5001, 5001], [100, 300000]]) {
      const plan = planImageResize(w, h, 50 * MB);
      assert.ok(plan.resize);
      assert.ok(plan.width >= 1 && plan.height >= 1);
      assert.ok(Math.max(plan.width, plan.height) <= 4096, `${w}x${h}`);
      assert.ok(plan.width * plan.height <= 25_000_000);
      assert.ok(Math.abs(plan.width / plan.height - w / h) < 0.01 * Math.max(1, w / h) + 1 / Math.min(plan.width, plan.height), `ratio of ${w}x${h}`);
    }
  });

  await t("ownCloudinaryUrl: our cloud over https on res.cloudinary.com, nothing else", () => {
    const ok = (u: string) => ownCloudinaryUrl(u, "demo") !== undefined;
    assert.equal(ok("https://res.cloudinary.com/demo/image/upload/v1/neuro-studio/image/u/n.jpg"), true);
    assert.equal(ok("https://res.cloudinary.com/demo/a.png"), true);
    assert.equal(ok("https://res.cloudinary.com/demo/a.png?x=1#t=2"), true);
    assert.equal(ok("https://res.cloudinary.com/other/image/upload/a.png"), false, "another cloud");
    assert.equal(ok("https://res.cloudinary.com/demo-evil/a.png"), false, "a cloud whose name starts with ours");
    assert.equal(ok("https://res.cloudinary.com/demo"), false, "no path under the cloud");
    assert.equal(ok("https://res.cloudinary.com/DEMO/a.png"), false, "cloud names are case-sensitive");
    assert.equal(ok("http://res.cloudinary.com/demo/a.png"), false, "not https");
    assert.equal(ok("https://res.cloudinary.com.evil.io/demo/a.png"), false);
    assert.equal(ok("https://evil.io/res.cloudinary.com/demo/a.png"), false);
    assert.equal(ok("https://res.cloudinary.com@evil.io/demo/a.png"), false);
    assert.equal(ok("https://demo:x@res.cloudinary.com/demo/a.png"), false, "credentials in the URL");
    assert.equal(ok("https://res.cloudinary.com:8443/demo/a.png"), false, "another port");
    assert.equal(ok("https://res.cloudinary.com/demo/../other/a.png"), false, "dot segments are resolved before the check");
    assert.equal(ok("https://res.cloudinary.com/%2e%2e/other/a.png"), false);
    assert.equal(ok("https://res.cloudinary.com/demo%2F..%2Fother/a.png"), false);
    assert.equal(ok("//res.cloudinary.com/demo/a.png"), false);
    assert.equal(ok("javascript:alert(1)"), false);
    assert.equal(ok("data:image/png;base64,AAAA"), false);
    assert.equal(ok(""), false);
    assert.equal(ok("not a url"), false);
    assert.equal(ownCloudinaryUrl("https://res.cloudinary.com/demo/a.png", undefined), undefined, "no cloud configured: nothing is ours");
    assert.equal(ownCloudinaryUrl("https://res.cloudinary.com//a.png", ""), undefined);
  });

  await t("ownCloudinaryUrl: URLs that parsers read differently are refused (a backslash can move the host to evil.io)", () => {
    for (const hostile of [
      "https://res.cloudinary.com\\@evil.io/demo/a.png",
      "https://res.cloudinary.com\\demo\\@evil.io/a.png", // WHATWG: host res.cloudinary.com. curl, PHP, Python: host evil.io
      "https://res.cloudinary.com\\demo\\a.png",
      "https://res.cloudinary.com/demo\\..\\other/a.png",
      "https://res.cloudinary.com/demo/a.png\\",
      "https://res.cloudin\tary.com/demo/a.png", // WHATWG drops tabs and newlines
      "https://res.cloudinary.com/demo/a\n.png",
      "https://res.cloudinary.com/demo/a .png",
      "https://res.cloudinary.com/demo/a\u0000.png",
      " https://res.cloudinary.com/demo/a.png",
      "https://res.cloudinary.com/demo/a.png ",
      "https://res.cloudinary.com/demo/..%2fother/a.png", // a server that decodes %2f walks out of our cloud
      "https://res.cloudinary.com/demo/%2e%2e/other/a.png",
      "https://res.cloudinary.com/demo/x%5c..%5cother/a.png",
      "https://res.cloudinary.com/demo/%zz/a.png", // malformed escape
    ]) {
      assert.equal(ownCloudinaryUrl(hostile, "demo"), undefined, JSON.stringify(hostile));
    }
    for (const notAString of [undefined, null, 5, {}, ["https://res.cloudinary.com/demo/a.png"], true]) {
      assert.equal(ownCloudinaryUrl(notAString, "demo"), undefined, JSON.stringify(notAString));
    }
  });

  await t("ownCloudinaryUrl: what it returns is canonical, so every parser reads the same host", () => {
    assert.equal(ownCloudinaryUrl("HTTPS://Res.Cloudinary.COM:443/demo/image/upload/a.png", "demo"), "https://res.cloudinary.com/demo/image/upload/a.png");
    assert.equal(ownCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/./a.png", "demo"), "https://res.cloudinary.com/demo/image/upload/a.png");
    // A triple slash is read by RFC 3986 parsers (Python) as an empty host, and by WHATWG as ours: only the canonical form is unambiguous.
    assert.equal(ownCloudinaryUrl("https:///res.cloudinary.com/demo/a.png", "demo"), "https://res.cloudinary.com/demo/a.png");
    // Seeded fuzz of the shapes that make parsers disagree. Whatever is accepted must have res.cloudinary.com as its
    // authority by the plain RFC 3986 reading too (the same corpus, checked with Python, PHP and Ruby, had 3670 hostile
    // strings among the 4106 that a host-and-prefix check alone accepts).
    let seed = 99;
    const next = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0; // mulberry32
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const schemes = ["https://", "https:\\\\", "https:/\\", "https:///", "https:\\/"];
    const separators = ["/", "\\", "/", "\\", "\\\\", "//", "?", "#", ";"];
    const segments = ["demo", "@evil.io", "evil.io", "x@evil.io", "u:p@evil.io", "..", ".", "a.png", ":80", ":443", "%40evil.io", "@", "demo@evil.io", "%2f", "%5c", "Demo", "image", "upload", "res.cloudinary.com", "@res.cloudinary.com", "\t", " ", "\u0000"];
    let accepted = 0;
    let rewritten = 0;
    for (let i = 0; i < 400000; i++) {
      let input = schemes[next(schemes.length)] + (next(8) === 0 ? "evil.io" : "res.cloudinary.com");
      for (let j = next(6) + 1; j > 0; j--) input += separators[next(separators.length)] + segments[next(segments.length)];
      const out = ownCloudinaryUrl(input, "demo");
      if (out === undefined) continue;
      accepted++;
      if (out !== input) rewritten++;
      assert.equal(out, new URL(out).href, "canonical: " + JSON.stringify(input));
      assert.ok(!/[\\\s]/.test(out), "no backslash or space: " + JSON.stringify(out));
      assert.equal(out.slice("https://".length).split(/[/?#]/)[0], "res.cloudinary.com", "authority: " + JSON.stringify(out));
      assert.ok(out.startsWith("https://res.cloudinary.com/demo/"), JSON.stringify(out));
    }
    assert.ok(accepted > 50 && rewritten > 0, `the corpus must contain accepted and rewritten URLs (${accepted}, ${rewritten})`);
  });
}

// ============================================================================================ fake browser

type XhrStep =
  | { status: number; body?: unknown; progress?: [number, number][] }
  | { networkError: true }
  | { hang: true };
interface XhrRecord {
  method: string;
  url: string;
  headers: [string, string][];
  responseType: string;
  withCredentials: boolean;
  timeout: number;
  form?: FormData;
  aborted: boolean;
}
const xhrScript: XhrStep[] = [];
const xhrLog: XhrRecord[] = [];

class FakeXhr {
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseType = "";
  withCredentials = false;
  timeout = 0;
  status = 0;
  response: unknown = null;
  private record!: XhrRecord;
  open(method: string, url: string) {
    this.record = { method, url, headers: [], responseType: "", withCredentials: false, timeout: 0, aborted: false };
    xhrLog.push(this.record);
  }
  setRequestHeader(name: string, value: string) {
    this.record.headers.push([name, value]);
  }
  send(form: FormData) {
    Object.assign(this.record, { form, responseType: this.responseType, withCredentials: this.withCredentials, timeout: this.timeout });
    const step = xhrScript.shift() ?? { status: 200, body: {} };
    if ("hang" in step) return;
    setTimeout(() => {
      if ("networkError" in step) return this.onerror?.();
      for (const [loaded, total] of step.progress ?? [[1, 2], [2, 2]]) this.upload.onprogress?.({ lengthComputable: true, loaded, total });
      this.upload.onload?.();
      this.status = step.status;
      this.response = step.body ?? null;
      this.onload?.();
    }, 0);
  }
  abort() {
    this.record.aborted = true;
    this.onabort?.();
  }
}

const mediaFake = { duration: 61.5 as number, fails: false, hangs: false };
const imageFake = { width: 4000, height: 3000, fails: false };
const encoderLog: { type: string; quality: number; width: number; height: number; opaque: boolean }[] = [];
const canvasLog = { fills: 0, draws: [] as [number, number][], bitmapsClosed: 0 };
// What the canvas encoder hands back for (type, quality, width, height); null = the browser failed.
let encoder: (type: string, quality: number, width: number, height: number) => { type: string; size: number } | null = (type) => ({ type, size: 2 * MB });

function installBrowser() {
  const g = globalThis as any;
  g.XMLHttpRequest = FakeXhr;
  g.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_: string) {
      setTimeout(() => {
        if (imageFake.fails) return this.onerror?.();
        this.naturalWidth = imageFake.width;
        this.naturalHeight = imageFake.height;
        this.onload?.();
      }, 0);
    }
  };
  g.createImageBitmap = async () => {
    if (imageFake.fails) throw new Error("cannot decode");
    return { width: imageFake.width, height: imageFake.height, close: () => canvasLog.bitmapsClosed++ };
  };
  g.document = {
    createElement(tag: string) {
      if (tag === "canvas") {
        let opaque = false;
        const context = {
          imageSmoothingQuality: "",
          fillStyle: "",
          clearRect: () => {
            opaque = false;
          },
          fillRect: () => {
            opaque = true;
            canvasLog.fills++;
          },
          drawImage: (_b: unknown, _x: number, _y: number, w: number, h: number) => canvasLog.draws.push([w, h]),
        };
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob(cb: (b: Blob | null) => void, type: string, quality: number) {
            encoderLog.push({ type, quality, width: canvas.width, height: canvas.height, opaque });
            const out = encoder(type, quality, canvas.width, canvas.height);
            setTimeout(() => cb(out && new Blob([new Uint8Array(out.size)], { type: out.type })), 0);
          },
        };
        return canvas;
      }
      const media: any = {
        preload: "",
        duration: mediaFake.duration,
        onloadedmetadata: null,
        onerror: null,
        removeAttribute() {},
      };
      Object.defineProperty(media, "src", {
        set() {
          if (mediaFake.hangs) return; // iOS Safari never loads a detached media element
          setTimeout(() => (mediaFake.fails ? media.onerror?.() : media.onloadedmetadata?.()), 0);
        },
      });
      return media;
    },
  };
}
function uninstallBrowser() {
  const g = globalThis as any;
  for (const name of ["XMLHttpRequest", "Image", "createImageBitmap", "document"]) delete g[name];
}

const fileOf = (name: string, size: number, type = "application/octet-stream") => new File([new Uint8Array(size)], name, { type });
const bigFile = (name: string, size: number, type?: string) => Object.defineProperty(fileOf(name, 4, type), "size", { value: size }) as File;

// ============================================================================================ with a database

async function scenario(variant: "legacy" | "fresh") {
  console.log(`\n=== database variant: ${variant} ===`);
  const db = new PGlite();
  setDb(db);
  if (variant === "legacy") {
    await db.exec(`CREATE TABLE projects (id serial PRIMARY KEY, title text, category text, plan text, topic text, created_at timestamptz DEFAULT now());`);
  }
  await db.exec(schemaSql);

  process.env.ALLOWED_EMAILS = "a@example.com, b@example.com";
  const A = { id: await upsertUser({ email: "a@example.com", name: "Alice" }), email: "a@example.com", name: "Alice" };
  const B = { id: await upsertUser({ email: "b@example.com", name: "Bob" }), email: "b@example.com", name: "Bob" };
  const C = { id: await upsertUser({ email: "stranger@example.com", name: "Eve" }), email: "stranger@example.com", name: "Eve" };

  const usage = async (where = "") => Number((await db.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM usage_events ${where}`)).rows[0].n);
  const reset = async () => {
    await db.exec("DELETE FROM usage_events");
    calls.length = 0;
    requests.length = 0;
    adminCalls.length = 0;
    destroyCalls.length = 0;
    xhrScript.length = 0;
    xhrLog.length = 0;
    resourceImpl = unexpected;
    destroyImpl = async () => ({ result: "ok" });
    setHandler(DEFAULT_HANDLER);
    delete process.env.CLOUDINARY_DYNAMIC_FOLDERS;
  };
  const untouched = () => {
    assert.deepEqual(calls, [], "no network call");
    assert.deepEqual(adminCalls, [], "no Cloudinary admin call");
    assert.deepEqual(destroyCalls, [], "no Cloudinary destroy call");
  };

  type Signed = Extract<Awaited<ReturnType<typeof actions.requestUploadSignature>>, { success: true }>;
  const sign = async (kind: UploadKind = "audio", size = 5 * MB): Promise<Signed> => {
    const r = await actions.requestUploadSignature({ kind, size });
    if (!r.success) throw new Error(`signature refused: ${r.error}`);
    return r;
  };
  const errorOf = async (input: unknown) => {
    const r = await actions.requestUploadSignature(input as never);
    return r.success ? "ok" : r.error;
  };
  const silently = async <T,>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    try {
      return { result: await fn(), logged: lines.join("\n") };
    } finally {
      console.error = original;
    }
  };

  await t("schema.sql still applies twice, and documents the upload kind", async () => {
    await db.exec(schemaSql);
    assert.ok(/upload/.test(schemaSql));
    assert.equal(DAILY_LIMITS.upload, 40);
  });

  // ---------------------------------------------------------------- access
  console.log("access");
  const everyUploadAction: [string, () => Promise<{ success?: boolean; error?: string }>][] = [
    ["requestUploadSignature", () => actions.requestUploadSignature({ kind: "audio", size: 5 * MB })],
    ["confirmUpload", () => actions.confirmUpload({ kind: "audio", publicId: buildPublicId("audio", A.id, NONCE) })],
  ];
  setUser(null);
  await reset();
  for (const [name, run] of everyUploadAction) await t(`${name}: anonymous gets NON_CONNECTÉ`, async () => assert.equal((await run()).error, "NON_CONNECTÉ"));
  await t("…and nothing was written or called", async () => {
    untouched();
    assert.equal(await usage(), 0);
  });
  setUser(C);
  for (const [name, run] of everyUploadAction) await t(`${name}: signed in but not invited gets ACCÈS_REFUSÉ`, async () => assert.equal((await run()).error, "ACCÈS_REFUSÉ"));
  await t("…and nothing was written or called", async () => {
    untouched();
    assert.equal(await usage(), 0);
  });
  await t("a withdrawn invitation stops uploads at once", async () => {
    setUser(A);
    process.env.ALLOWED_EMAILS = "b@example.com";
    assert.equal(await errorOf({ kind: "audio", size: 5 * MB }), "ACCÈS_REFUSÉ");
    process.env.ALLOWED_EMAILS = "a@example.com, b@example.com";
    assert.equal(await usage(), 0);
  });

  // ---------------------------------------------------------------- invalid requests
  console.log("invalid requests");
  setUser(A);
  await t("bad kind, bad size, over the cap: refused, and no usage row", async () => {
    await reset();
    assert.equal(await errorOf({ kind: "constructor", size: 5 * MB }), "TYPE_INVALIDE");
    assert.equal(await errorOf({ kind: "__proto__", size: 5 * MB }), "TYPE_INVALIDE");
    assert.equal(await errorOf({ kind: "raw", size: 5 * MB }), "TYPE_INVALIDE");
    assert.equal(await errorOf({ size: 5 * MB }), "TYPE_INVALIDE");
    assert.equal(await errorOf(null), "TYPE_INVALIDE");
    assert.equal(await errorOf(undefined), "TYPE_INVALIDE");
    assert.equal(await errorOf("audio"), "TYPE_INVALIDE");
    for (const size of [0, -5, NaN, Infinity, 2.5, "5000000", null, undefined, {}]) assert.equal(await errorOf({ kind: "audio", size }), "TAILLE_INVALIDE", String(size));
    assert.equal(await errorOf({ kind: "audio", size: 30 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    assert.equal(await errorOf({ kind: "image", size: 10 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    assert.equal(await errorOf({ kind: "video", size: 100 * MB + 1 }), "FICHIER_TROP_VOLUMINEUX");
    assert.equal(await usage(), 0);
    untouched();
  });
  await t("Cloudinary not configured: refused before a quota unit is reserved", async () => {
    await reset();
    cloudinary.config({ api_secret: "" });
    const refused = await errorOf({ kind: "audio", size: 5 * MB });
    cloudinary.config({ api_secret: SECRET });
    assert.equal(refused, "CLOUDINARY_NON_CONFIGURÉ");
    assert.equal(await usage(), 0);
  });
  await t("a failure while signing is refunded: nothing counts against the user", async () => {
    await reset();
    cloudinary.config({ signature_algorithm: "not-an-algorithm" });
    const { result, logged } = await silently(() => errorOf({ kind: "audio", size: 5 * MB }));
    cloudinary.config({ signature_algorithm: undefined });
    assert.equal(result, "SERVICE_INDISPONIBLE");
    assert.equal(await usage(), 1);
    assert.equal(await usage("WHERE NOT refunded"), 0);
    assert.ok(!logged.includes(SECRET));
    assert.equal((await sign()).success, true, "and signing works again once the config is back");
  });

  // ---------------------------------------------------------------- the signature
  console.log("signed parameters");
  await t("audio: the fields re-sign to the same signature, and contain exactly what the server decided", async () => {
    await reset();
    const r = await sign("audio", 5 * MB);
    assert.equal(r.url, "https://api.cloudinary.com/v1_1/demo/video/upload");
    assert.equal(r.apiKey, "k");
    assert.deepEqual(Object.keys(r.fields).sort(), ["allowed_formats", "context", "overwrite", "public_id", "signature", "tags", "timestamp", "type"]);
    assert.equal(r.fields.signature, signWith(r.fields, SECRET));
    assert.notEqual(r.fields.signature, signWith({ ...r.fields, overwrite: "1" }, SECRET), "the signature binds overwrite");
    assert.notEqual(r.fields.signature, signWith(r.fields, "another-secret"));
    assert.equal(r.fields.overwrite, "0", "the value the Cloudinary SDK itself sends for false");
    assert.equal(r.fields.type, "upload");
    assert.equal(r.fields.allowed_formats, "mp3,m4a,wav,ogg,opus,aac,flac");
    assert.equal(r.fields.context, `uid=${A.id}|kind=audio`);
    assert.equal(r.fields.tags, `neuro-studio,audio,user-${A.id}`);
    assert.match(r.fields.timestamp, /^\d{10}$/, "unix SECONDS");
    assert.ok(Math.abs(Number(r.fields.timestamp) - Date.now() / 1000) < 5);
    assert.ok(ownsPublicId(r.fields.public_id, "audio", A.id));
    assert.ok(!ownsPublicId(r.fields.public_id, "audio", B.id));
    assert.ok(Object.values(r.fields).every((v) => !v.includes("&")), "no & in a signed value");
    const rows = (await db.query<{ ref: string; kind: string; user_id: string }>(`SELECT ref, kind, user_id FROM usage_events`)).rows;
    assert.deepEqual(rows, [{ ref: r.fields.public_id, kind: "upload", user_id: A.id }], "the issued id is recorded with the reservation");
    untouched();
  });
  await t("each kind: its own endpoint, formats and public id folder", async () => {
    await reset();
    const cases: [UploadKind, string, string][] = [
      ["audio", "video", "mp3,m4a,wav,ogg,opus,aac,flac"],
      ["image", "image", "jpg,png,webp"],
      ["video", "video", "mp4,mov,webm"],
    ];
    for (const [kind, endpoint, formats] of cases) {
      const r = await sign(kind, 1000);
      assert.equal(r.url, `https://api.cloudinary.com/v1_1/demo/${endpoint}/upload`, kind);
      assert.equal(r.fields.allowed_formats, formats, kind);
      assert.ok(r.fields.public_id.startsWith(`neuro-studio/${kind}/${A.id}/`), kind);
      assert.equal(r.fields.signature, signWith(r.fields, SECRET), kind);
    }
  });
  await t("nothing client-chosen is signed: extra properties are ignored, and the size changes nothing", async () => {
    await reset();
    const plain = await sign("audio", 1000);
    const forged = (await actions.requestUploadSignature({
      kind: "audio",
      size: 29 * MB,
      public_id: "victim/asset",
      overwrite: "true",
      folder: "elsewhere",
      asset_folder: "elsewhere",
      eager: "w_10",
      tags: "admin",
      context: "uid=someone-else",
      allowed_formats: "exe",
      timestamp: 1,
      signature: "forged",
      resource_type: "raw",
      notification_url: "https://evil.example/hook",
      type: "private",
    } as never)) as Signed;
    assert.equal(forged.success, true);
    assert.deepEqual(Object.keys(forged.fields).sort(), Object.keys(plain.fields).sort());
    const text = JSON.stringify(forged);
    for (const needle of ["victim", "elsewhere", "w_10", "admin", "someone-else", "exe", "evil.example", "forged", "private", "raw"]) assert.ok(!text.includes(needle), needle);
    assert.equal(forged.fields.overwrite, "0");
    assert.equal(forged.fields.signature, signWith(forged.fields, SECRET));
  });
  await t("fields hold none of the four things Cloudinary never signs, and the secret never leaves the server", async () => {
    await reset();
    const r = await sign("image", 1000);
    for (const name of ["file", "cloud_name", "resource_type", "api_key", "api_secret"]) assert.ok(!(name in r.fields), name);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(SECRET));
    assert.ok(!text.includes("api_secret"));
    assert.deepEqual(Object.keys(r).sort(), ["apiKey", "fields", "success", "url"]);
  });
  await t("every call has its own public id", async () => {
    await reset();
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add((await sign("video", 1000)).fields.public_id);
    assert.equal(ids.size, 25);
  });
  await t("asset_folder is signed only when CLOUDINARY_DYNAMIC_FOLDERS=true", async () => {
    await reset();
    assert.ok(!("asset_folder" in (await sign()).fields), "default: off");
    for (const value of ["false", "1", "TRUE", "yes", ""]) {
      process.env.CLOUDINARY_DYNAMIC_FOLDERS = value;
      assert.ok(!("asset_folder" in (await sign()).fields), value);
    }
    process.env.CLOUDINARY_DYNAMIC_FOLDERS = "true";
    const r = await sign("image", 1000);
    assert.equal(r.fields.asset_folder, `neuro-studio/image/${A.id}`);
    assert.equal(r.fields.signature, signWith(r.fields, SECRET), "and the signature covers it");
    delete process.env.CLOUDINARY_DYNAMIC_FOLDERS;
  });

  // ---------------------------------------------------------------- quota
  console.log("quota");
  await t("the 41st signature in 24 h is refused, without a usage row; 40 rows cost nothing", async () => {
    await reset();
    for (let i = 0; i < 40; i++) assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok", `request ${i + 1}`);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "QUOTA_ATTEINTE");
    assert.equal(await errorOf({ kind: "image", size: 1000 }), "QUOTA_ATTEINTE", "the limit is shared by the three kinds");
    assert.equal(await usage("WHERE kind = 'upload'"), 40);
    assert.equal(Number((await db.query<{ s: string }>(`SELECT COALESCE(SUM(cost_usd), 0)::float AS s FROM usage_events`)).rows[0].s), 0);
    untouched();
  });
  await t("the quota is per user: A at the limit does not stop B", async () => {
    setUser(B);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok");
    setUser(A);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "QUOTA_ATTEINTE");
  });
  await t("events older than 24 h, and refunded ones, do not count", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd, created_at) SELECT $1::uuid, 'upload', 0, now() - interval '25 hours' FROM generate_series(1, 40)`, [A.id]);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok");
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd, refunded) SELECT $1::uuid, 'upload', 0, true FROM generate_series(1, 40)`, [A.id]);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok");
  });
  await t("39 used: the 40th is allowed", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'upload', 0 FROM generate_series(1, 39)`, [A.id]);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok");
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "QUOTA_ATTEINTE");
  });
  await t("uploads neither use up the dollar cap nor are blocked by other kinds' counts", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) VALUES ($1::uuid, 'image', 3.00)`, [A.id]); // exactly the 3 $ cap
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'voice', 0 FROM generate_series(1, 60)`, [A.id]);
    assert.equal(await errorOf({ kind: "audio", size: 1000 }), "ok");
  });

  // ---------------------------------------------------------------- confirmUpload
  console.log("confirmUpload");
  const assetFor = (publicId: string, over: Record<string, unknown> = {}) => ({
    public_id: publicId,
    resource_type: "video",
    type: "upload",
    format: "mp3",
    bytes: 4_200_000,
    duration: 187.4,
    secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${publicId}.mp3`,
    ...over,
  });
  const issue = async (kind: UploadKind = "audio") => (await sign(kind, 1000)).fields.public_id;
  const confirm = (kind: UploadKind, publicId: unknown) => actions.confirmUpload({ kind, publicId } as never);

  await t("an upload we issued is read back from Cloudinary under the expected resource type and returned", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId);
    const r = await confirm("audio", id);
    assert.deepEqual(r, { success: true, url: `https://res.cloudinary.com/demo/video/upload/v1/${id}.mp3`, bytes: 4_200_000, format: "mp3", duration: 187.4, width: undefined, height: undefined });
    assert.equal(adminCalls.length, 1);
    assert.equal(adminCalls[0].publicId, id);
    assert.equal(adminCalls[0].options.resource_type, "video");
    assert.deepEqual(destroyCalls, []);
    assert.equal(await usage(), 1, "confirming costs no quota");
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });
  await t("an image comes back with its dimensions and no duration", async () => {
    await reset();
    const id = await issue("image");
    resourceImpl = async (publicId) => ({ ...assetFor(publicId), resource_type: "image", format: "jpg", duration: undefined, width: 4096, height: 3072, secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg` });
    const r = await confirm("image", id);
    assert.equal(r.success, true);
    if (r.success) assert.deepEqual([r.width, r.height, r.duration, r.format], [4096, 3072, undefined, "jpg"]);
    assert.equal(adminCalls[0].options.resource_type, "image");
  });
  await t("someone else's public id is refused like a missing one, and Cloudinary is never asked", async () => {
    await reset();
    setUser(B);
    const bs = await issue("audio");
    setUser(A);
    resourceImpl = async (publicId) => assetFor(publicId);
    assert.deepEqual(await confirm("audio", bs), { success: false, error: "UPLOAD_INTROUVABLE" });
    untouched();
  });
  await t("another kind's public id, forged ids and odd input are refused without a Cloudinary call", async () => {
    await reset();
    const audioId = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId);
    assert.equal((await confirm("image", audioId)).success, false, "audio id confirmed as image");
    assert.equal((await confirm("video", audioId)).success, false, "audio id confirmed as video");
    for (const publicId of [undefined, null, 5, {}, "", "neuro-studio", `${audioId}/../x`, `${audioId}.mp3`, `neuro-studio/audio/${B.id}/${NONCE}`, "sample", "neuro-studio/audio/../../x"]) {
      assert.equal((await confirm("audio", publicId)).success, false, JSON.stringify(publicId));
    }
    for (const kind of ["constructor", "__proto__", "raw", null, undefined, 4]) assert.equal(((await actions.confirmUpload({ kind, publicId: audioId } as never)) as { error?: string }).error, "TYPE_INVALIDE", String(kind));
    assert.equal(((await actions.confirmUpload(null as never)) as { error?: string }).error, "TYPE_INVALIDE");
    untouched();
  });
  await t("wrong resource type reported by Cloudinary: refused and destroyed", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId, { resource_type: "image" });
    assert.deepEqual(await confirm("audio", id), { success: false, error: "FICHIER_REFUSÉ" });
    assert.deepEqual(destroyCalls, [{ publicId: id, options: { resource_type: "video", invalidate: true } }]);
  });
  await t("wrong format (an mp4 as audio, a gif or heic as image, an mp3 as video, no format at all): refused and destroyed", async () => {
    await reset();
    for (const [kind, resourceType, format] of [["audio", "video", "mp4"], ["audio", "video", "jpg"], ["image", "image", "gif"], ["image", "image", "heic"], ["video", "video", "mp3"], ["video", "video", "avi"], ["audio", "video", ""]] as const) {
      destroyCalls.length = 0;
      const id = await issue(kind);
      resourceImpl = async (publicId) => assetFor(publicId, { resource_type: resourceType, format, bytes: 1000 });
      assert.equal((await confirm(kind, id)).success, false, `${kind} as ${format}`);
      assert.equal(destroyCalls.length, 1, `${kind} as ${format} destroyed`);
      assert.equal(destroyCalls[0].options.resource_type, resourceType);
    }
  });
  await t("oversize: over the cap is refused and destroyed, exactly at the cap is accepted", async () => {
    await reset();
    const cases: [UploadKind, string, string, number][] = [["audio", "video", "mp3", 30 * MB], ["image", "image", "png", 10 * MB], ["video", "video", "mp4", 100 * MB]];
    for (const [kind, resourceType, format, cap] of cases) {
      const id = await issue(kind);
      resourceImpl = async (publicId) => assetFor(publicId, { resource_type: resourceType, format, bytes: cap });
      assert.equal((await confirm(kind, id)).success, true, `${kind} at the cap`);
      assert.equal(destroyCalls.length, 0);
      resourceImpl = async (publicId) => assetFor(publicId, { resource_type: resourceType, format, bytes: cap + 1 });
      assert.deepEqual(await confirm(kind, id), { success: false, error: "FICHIER_REFUSÉ" }, `${kind} over the cap`);
      assert.deepEqual(destroyCalls.pop(), { publicId: id, options: { resource_type: resourceType, invalidate: true } });
    }
  });
  await t("an answer without usable bytes or an https URL is refused and destroyed; the format is compared in lower case", async () => {
    await reset();
    for (const over of [{ bytes: undefined }, { bytes: "4200000" }, { bytes: 0 }, { bytes: -1 }, { bytes: NaN }, { secure_url: "http://res.cloudinary.com/demo/video/upload/x.mp3" }, { secure_url: undefined }]) {
      destroyCalls.length = 0;
      const id = await issue("audio"); // one id is checked at most CONFIRM_ATTEMPTS times
      resourceImpl = async (publicId) => assetFor(publicId, over);
      assert.equal((await confirm("audio", id)).success, false, JSON.stringify(over));
      assert.equal(destroyCalls.length, 1, JSON.stringify(over));
    }
    destroyCalls.length = 0;
    resourceImpl = async (publicId) => assetFor(publicId, { format: "MP3" });
    assert.equal((await confirm("audio", await issue("audio"))).success, true);
  });
  await t("a missing asset is UPLOAD_INTROUVABLE (nothing to destroy); other Cloudinary failures are SERVICE_INDISPONIBLE and never log credentials", async () => {
    await reset();
    // The SDK rejects with the parsed body plus the request it made, which includes the API credentials.
    const sdkRejection = (httpCode: number) => ({ error: { message: "Resource not found", http_code: httpCode }, request_options: { auth: `k:${SECRET}` }, query_params: `api_secret=${SECRET}` });
    resourceImpl = async () => {
      throw sdkRejection(404);
    };
    assert.deepEqual(await confirm("audio", await issue("audio")), { success: false, error: "UPLOAD_INTROUVABLE" });
    for (const failure of [sdkRejection(420), sdkRejection(500), new Error(`connect ECONNREFUSED ${SECRET}`), { error: { message: "x" } }, "boom"]) {
      resourceImpl = async () => {
        throw failure;
      };
      const id = await issue("audio");
      const { result, logged } = await silently(() => confirm("audio", id));
      assert.deepEqual(result, { success: false, error: "SERVICE_INDISPONIBLE" });
      assert.ok(!logged.includes(`k:${SECRET}`) && !logged.includes("api_secret"), "the rejection object is not logged: " + logged);
    }
    assert.deepEqual(destroyCalls, []);
  });
  await t("a failing cleanup does not hide the refusal, nor leak credentials", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId, { bytes: 50 * MB });
    destroyImpl = async () => {
      throw { error: { message: "nope", http_code: 500 }, request_options: { auth: `k:${SECRET}` } };
    };
    const { result, logged } = await silently(() => confirm("audio", id));
    assert.deepEqual(result, { success: false, error: "FICHIER_REFUSÉ" });
    assert.equal(destroyCalls.length, 1);
    assert.ok(!logged.includes(SECRET));
  });

  // ---------------------------------------------------------------- only issued ids reach Cloudinary, a few times each
  console.log("confirmUpload: issued ids only");
  await t("a well-formed id that was never issued is refused without a Cloudinary call (the Admin API budget is account-wide)", async () => {
    await reset();
    resourceImpl = async (publicId) => assetFor(publicId);
    const forged = (i: number) => buildPublicId("audio", A.id, `forged-${String(i).padStart(8, "0")}`);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => confirm("audio", forged(i))));
    assert.ok(results.every((r) => !r.success && r.error === "UPLOAD_INTROUVABLE"));
    untouched();
    assert.equal(await usage(), 0);
  });
  await t("an id is checked at most CONFIRM_ATTEMPTS times, parallel calls included", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId);
    const results = await Promise.all(Array.from({ length: 20 }, () => confirm("audio", id)));
    assert.equal(results.filter((r) => r.success).length, CONFIRM_ATTEMPTS);
    assert.ok(results.filter((r) => !r.success).every((r) => !r.success && r.error === "UPLOAD_INTROUVABLE"));
    assert.equal(adminCalls.length, CONFIRM_ATTEMPTS);
    assert.equal(Number((await db.query<{ n: number }>(`SELECT confirm_attempts AS n FROM usage_events WHERE ref = $1`, [id])).rows[0].n), CONFIRM_ATTEMPTS);
  });
  await t("failed checks use up attempts too: one id cannot be hammered while Cloudinary is failing", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async () => {
      throw { error: { message: "Rate limit exceeded", http_code: 420 } };
    };
    const { result } = await silently(async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < CONFIRM_ATTEMPTS + 2; i++) {
        const r = await confirm("audio", id);
        outcomes.push(r.success ? "ok" : r.error);
      }
      return outcomes;
    });
    assert.deepEqual(result, [...Array<string>(CONFIRM_ATTEMPTS).fill("SERVICE_INDISPONIBLE"), "UPLOAD_INTROUVABLE", "UPLOAD_INTROUVABLE"]);
    assert.equal(adminCalls.length, CONFIRM_ATTEMPTS);
  });
  await t("a refunded signature and an id older than 24 h cannot be checked", async () => {
    await reset();
    resourceImpl = async (publicId) => assetFor(publicId);
    const refunded = await issue("audio");
    await db.query(`UPDATE usage_events SET refunded = true WHERE ref = $1`, [refunded]);
    const old = await issue("audio");
    await db.query(`UPDATE usage_events SET created_at = now() - interval '25 hours' WHERE ref = $1`, [old]);
    for (const id of [refunded, old]) assert.deepEqual(await confirm("audio", id), { success: false, error: "UPLOAD_INTROUVABLE" });
    untouched();
  });
  await t("when the database cannot say whether the id was issued, Cloudinary is not asked, and no attempt is used up", async () => {
    await reset();
    const id = await issue("audio");
    resourceImpl = async (publicId) => assetFor(publicId);
    await db.exec(`ALTER TABLE usage_events RENAME COLUMN confirm_attempts TO confirm_attempts_gone`);
    const { result } = await silently(() => confirm("audio", id));
    await db.exec(`ALTER TABLE usage_events RENAME COLUMN confirm_attempts_gone TO confirm_attempts`);
    assert.deepEqual(result, { success: false, error: "SERVICE_INDISPONIBLE" });
    untouched();
    assert.equal((await confirm("audio", id)).success, true, "and the same id works once the database is back");
  });

  // ---------------------------------------------------------------- reserve_usage
  console.log("reserve_usage (the atomic reservation behind authorize)");
  await t("reserve_usage locks the user first, in a VOLATILE function: what keeps parallel requests honest on a real Postgres", async () => {
    // PGlite runs one statement at a time and cannot show the race (100 parallel requests got up to 100 reservations for a limit of 40 before the lock):
    // this guards the two properties that fix it, and TEST_PG_URL runs the real thing (see the last section).
    const rows = (await db.query<{ prosrc: string; provolatile: string }>(`SELECT prosrc, provolatile FROM pg_proc WHERE proname = 'reserve_usage'`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provolatile, "v", "STABLE would reuse the caller's snapshot, which was taken before the lock");
    assert.match(rows[0].prosrc, /pg_advisory_xact_lock\(hashtextextended\(p_user::text, 0\)\)/);
    assert.ok(rows[0].prosrc.indexOf("pg_advisory_xact_lock") < rows[0].prosrc.indexOf("INSERT INTO usage_events"), "lock first, then count and insert");
  });
  await t("reserve_usage: the per-kind limit, the dollar cap, the ref, and NULL when refused", async () => {
    await reset();
    const reserve = async (kind: string, cost: number, limit: number, cap: number, ref: string | null = null) =>
      (await db.query<{ id: string | null }>(`SELECT reserve_usage($1::uuid, $2::text, $3::numeric, $4::int, $5::numeric, $6::text) AS id`, [A.id, kind, cost, limit, cap, ref])).rows[0].id;
    assert.ok(await reserve("upload", 0, 2, 3, "r1"));
    assert.ok(await reserve("upload", 0, 2, 3));
    assert.equal(await reserve("upload", 0, 2, 3), null, "limit of the kind");
    assert.ok(await reserve("video", 2, 8, 3), "another kind has its own count");
    assert.equal(await reserve("video", 1.01, 8, 3), null, "2 + 1.01 is over the cap of 3");
    assert.ok(await reserve("video", 1, 8, 3), "exactly the cap");
    assert.equal(await usage(), 4);
    assert.equal(await usage("WHERE ref = 'r1' AND kind = 'upload'"), 1);
  });

  // ---------------------------------------------------------------- res.cloudinary.com URLs given to Replicate
  console.log("images given to the video models");
  const predictionStub = () => setHandler(() => json({ id: "zzzz1234yyyy", status: "starting", urls: {}, model: "m", version: "v", input: {}, created_at: new Date().toISOString() }, 201));
  const wan = (imageUrl: string) => actions.startVideoJob({ modelId: "wan-fast", prompt: "waves", ratio: "16:9", duration: 5, imageUrl });
  await t("startVideoJob refuses an image from another Cloudinary cloud, or over http, before any call", async () => {
    await reset();
    predictionStub();
    for (const url of [
      "https://res.cloudinary.com/other-cloud/image/upload/a.png",
      "http://res.cloudinary.com/demo/image/upload/a.png",
      "https://res.cloudinary.com.evil.io/demo/a.png",
      "https://res.cloudinary.com/demo/../other/a.png",
      "https://res.cloudinary.com@evil.io/demo/a.png",
      "https://res.cloudinary.com\\demo\\@evil.io/a.png", // WHATWG reads host res.cloudinary.com, curl and Python read evil.io
      "https://res.cloudinary.com/demo/..%2fother/a.png",
    ]) {
      const r = await wan(url);
      assert.equal(r.success === false && r.error, "IMAGE_REQUISE", url);
    }
    assert.deepEqual(calls, []);
    assert.equal(await usage(), 0);
  });
  await t("…and accepts one from our cloud, including a user upload", async () => {
    await reset();
    predictionStub();
    assert.equal((await wan("https://res.cloudinary.com/demo/image/upload/v1/neuro-studio/image/u/n.jpg")).success, true);
    assert.equal((await wan(`https://res.cloudinary.com/demo/image/upload/v1/${buildPublicId("image", A.id, NONCE)}.jpg`)).success, true);
    assert.equal(requests.filter((r) => r.url.includes("/predictions")).length, 2);
  });
  await t("…and forwards the canonical URL, never the string it was given; a non-string is refused", async () => {
    await reset();
    predictionStub();
    assert.equal((await wan("HTTPS://Res.Cloudinary.com:443/demo/image/upload/./v1/a.png")).success, true);
    assert.equal(requests.filter((r) => r.url.includes("/predictions")).at(-1)!.body.input.image, "https://res.cloudinary.com/demo/image/upload/v1/a.png");
    const array = await actions.startVideoJob({ modelId: "wan-fast", prompt: "waves", ratio: "16:9", duration: 5, imageUrl: ["https://res.cloudinary.com/demo/a.png"] as never });
    assert.equal(array.success === false && array.error, "IMAGE_REQUISE");
  });

  // ---------------------------------------------------------------- uploadFile, with a fake browser
  console.log("uploadFile (fake XMLHttpRequest, canvas and media elements)");
  installBrowser();
  const echoAsset = (over: Record<string, unknown> = {}) => (publicId: string) => assetFor(publicId, over);
  const mp3 = () => fileOf("Mon morceau.MP3", 1234, "audio/mpeg");
  const failsWith = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected a rejection");
  };
  const formEntries = (record: XhrRecord) => [...record.form!.entries()];
  const formFields = (record: XhrRecord) => Object.fromEntries(formEntries(record).filter(([k]) => k !== "file")) as Record<string, string>;

  await t("audio end to end: signed fields appended verbatim, then api_key, then the file; nothing else", async () => {
    await reset();
    resourceImpl = async (publicId) => echoAsset({ duration: undefined })(publicId);
    const phases: string[] = [];
    const ratios: number[] = [];
    const result = await uploadFile(mp3(), "audio", { onProgress: (p) => (phases.push(p.phase), ratios.push(p.ratio)) });

    assert.equal(xhrLog.length, 1);
    const sent = xhrLog[0];
    assert.equal(sent.method, "POST");
    assert.equal(sent.url, "https://api.cloudinary.com/v1_1/demo/video/upload");
    assert.deepEqual(sent.headers, [], "no header set by hand (the multipart boundary is the browser's)");
    assert.equal(sent.withCredentials, false);
    assert.equal(sent.responseType, "json");
    assert.equal(sent.timeout, 0);

    const names = formEntries(sent).map(([k]) => k);
    assert.deepEqual(names.slice(-2), ["api_key", "file"]);
    assert.deepEqual([...names].sort(), ["allowed_formats", "api_key", "context", "file", "overwrite", "public_id", "signature", "tags", "timestamp", "type"]);
    const fields = formFields(sent);
    assert.equal(fields.api_key, "k");
    const { api_key, ...signed } = fields;
    assert.equal(api_key, "k");
    assert.equal(signed.signature, signWith(signed, SECRET), "what left the browser re-signs to its own signature");
    assert.ok(ownsPublicId(signed.public_id, "audio", A.id));
    const file = sent.form!.get("file") as File;
    assert.equal(file.size, 1234);

    // the numbers come from the server's read-back, not from the browser
    assert.equal(result.url, `https://res.cloudinary.com/demo/video/upload/v1/${signed.public_id}.mp3`);
    assert.equal(result.bytes, 4_200_000);
    assert.equal(result.format, "mp3");
    assert.equal(result.duration, 61.5, "no duration from Cloudinary: the browser's, for display");
    assert.deepEqual(adminCalls.map((c) => c.publicId), [signed.public_id], "the id read back is the server-issued one");
    assert.equal(await usage("WHERE kind = 'upload'"), 1);

    assert.equal(phases[0], "preparing");
    assert.equal(phases.at(-1), "processing");
    assert.ok(phases.includes("uploading"));
    assert.ok(ratios.every((r) => r >= 0 && r <= 1));
    assert.deepEqual(ratios.filter((_, i) => phases[i] === "uploading"), [0.5, 1]);
  });
  await t("a duration reported by Cloudinary wins over the browser's", async () => {
    await reset();
    resourceImpl = async (publicId) => echoAsset({ duration: 187.4 })(publicId);
    assert.equal((await uploadFile(mp3(), "audio")).duration, 187.4);
  });
  await t("a duration the browser cannot read does not stop the upload", async () => {
    await reset();
    mediaFake.fails = true;
    resourceImpl = async (publicId) => echoAsset({ duration: undefined })(publicId);
    const r = await uploadFile(mp3(), "audio");
    mediaFake.fails = false;
    assert.equal(r.duration, undefined);
    assert.equal(r.format, "mp3");
  });
  await t("video: sent to the video endpoint, with the dimensions Cloudinary reports", async () => {
    await reset();
    resourceImpl = async (publicId) => echoAsset({ format: "mp4", width: 1920, height: 1080, bytes: 9 * MB, secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${publicId}.mp4` })(publicId);
    const r = await uploadFile(fileOf("clip.mp4", 5000, "video/mp4"), "video");
    assert.equal(xhrLog[0].url, "https://api.cloudinary.com/v1_1/demo/video/upload");
    assert.deepEqual([r.width, r.height, r.format], [1920, 1080, "mp4"]);
  });

  await t("pre-check: wrong extension, empty or oversize files are refused in French, before any server call", async () => {
    await reset();
    const cases: [File, UploadKind, RegExp][] = [
      [fileOf("virus.exe", 100), "audio", /Format non pris en charge \(\.exe\)\. Formats acceptés : mp3, m4a/],
      [fileOf("noextension", 100), "audio", /Format non pris en charge\. Formats acceptés/],
      [fileOf("song.mp3", 100), "video", /Format non pris en charge \(\.mp3\)\. Formats acceptés : mp4, mov, webm/],
      [fileOf("anim.gif", 100), "image", /Format non pris en charge \(\.gif\)/],
      [fileOf("photo.heic", 100), "image", /Format non pris en charge \(\.heic\)/],
      [fileOf("silence.mp3", 0), "audio", /vide/],
      [bigFile("long.wav", 31 * MB), "audio", /Fichier trop volumineux : 31 Mo \(maximum 30 Mo\)/],
      [bigFile("film.mp4", 100 * MB + 1), "video", /Fichier trop volumineux : 100 Mo \(maximum 100 Mo\)/],
    ];
    for (const [file, kind, message] of cases) {
      const error = await failsWith(() => uploadFile(file, kind));
      assert.ok(error instanceof UploadError, file.name);
      assert.match(error.message, message, file.name);
    }
    assert.equal(xhrLog.length, 0);
    assert.equal(await usage(), 0);
    untouched();
  });

  await t("a stale signature (401) is replaced once, then the upload goes through", async () => {
    await reset();
    resourceImpl = async (publicId) => echoAsset()(publicId);
    xhrScript.push({ status: 401, body: { error: { message: "Stale request - reported time is 2026-10-08 10:00:00 +0000 which is more than 1 hour ago" } } });
    const r = await uploadFile(mp3(), "audio");
    assert.equal(r.format, "mp3");
    assert.equal(xhrLog.length, 2);
    const [first, second] = xhrLog.map(formFields);
    assert.notEqual(first.public_id, second.public_id);
    assert.notEqual(first.signature, second.signature);
    assert.equal(await usage("WHERE kind = 'upload'"), 2);
    assert.deepEqual(adminCalls.map((c) => c.publicId), [second.public_id], "the confirmed asset is the one that was uploaded");
  });
  await t("…but only once", async () => {
    await reset();
    const stale = { status: 401, body: { error: { message: "Stale request" } } };
    xhrScript.push(stale, stale, stale);
    const error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.ok(error instanceof UploadError);
    assert.match(error.message, /Autorisation d'envoi refusée/);
    assert.equal(error.status, 401);
    assert.equal(xhrLog.length, 2);
    assert.equal(await usage("WHERE kind = 'upload'"), 2);
  });
  await t("a 401 that is not a stale request (bad signature) is not retried", async () => {
    await reset();
    xhrScript.push({ status: 401, body: { error: { message: "Invalid Signature abc. String to sign - x" } } });
    const error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.match(error.message, /Autorisation d'envoi refusée/);
    assert.equal(xhrLog.length, 1);
    assert.equal(await usage("WHERE kind = 'upload'"), 1);
  });
  await t("Cloudinary's refusals and network failures come out in French", async () => {
    await reset();
    xhrScript.push({ status: 400, body: { error: { message: "Image file format m4a not allowed" } } });
    let error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.match(error.message, /^Fichier refusé par l'hébergeur : format, contenu ou taille non pris en charge \(Image file format m4a not allowed\)\.$/);
    xhrScript.push({ status: 413, body: null });
    error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.equal(error.message, "Fichier trop volumineux pour l'hébergeur.");
    xhrScript.push({ status: 503, body: "<html>" });
    error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.match(error.message, /Échec de l'envoi \(erreur 503\)/);
    xhrScript.push({ networkError: true });
    error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.match(error.message, /Connexion interrompue/);
    assert.ok(error instanceof UploadError);
  });
  await t("the server's refusal after the upload (oversize read back) is reported and the asset destroyed", async () => {
    await reset();
    resourceImpl = async (publicId) => echoAsset({ bytes: 31 * MB })(publicId);
    const error = await failsWith(() => uploadFile(mp3(), "audio"));
    assert.match(error.message, /Fichier refusé/);
    assert.equal(destroyCalls.length, 1);
  });
  await t("a missing asset after the upload is reported", async () => {
    await reset();
    resourceImpl = async () => {
      throw { error: { message: "Resource not found", http_code: 404 } };
    };
    assert.match((await failsWith(() => uploadFile(mp3(), "audio"))).message, /l'hébergeur ne trouve pas le fichier/);
  });
  await t("quota, anonymous and uninvited users get the French explanation, and nothing is uploaded", async () => {
    await reset();
    await db.query(`INSERT INTO usage_events (user_id, kind, cost_usd) SELECT $1::uuid, 'upload', 0 FROM generate_series(1, 40)`, [A.id]);
    assert.match((await failsWith(() => uploadFile(mp3(), "audio"))).message, /Limite atteinte/);
    setUser(null);
    assert.match((await failsWith(() => uploadFile(mp3(), "audio"))).message, /Connectez-vous/);
    setUser(C);
    assert.match((await failsWith(() => uploadFile(mp3(), "audio"))).message, /sur invitation/);
    setUser(A);
    assert.equal(xhrLog.length, 0);
  });

  // The pause before a retry is a second or more: run those tests with the long timers shortened.
  const quickTimers = async <T,>(run: () => Promise<T>): Promise<T> => {
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => real(fn, ms !== undefined && ms >= 500 ? 5 : ms, ...rest)) as typeof setTimeout;
    try {
      return await run();
    } finally {
      globalThis.setTimeout = real;
    }
  };
  await t("a hiccup while checking the upload is retried: one signature, the file is not lost", async () => {
    await reset();
    let reads = 0;
    resourceImpl = async (publicId) => {
      if (++reads === 1) throw { error: { message: "Internal error", http_code: 500 } };
      return echoAsset()(publicId);
    };
    const { result } = await silently(() => quickTimers(() => uploadFile(mp3(), "audio")));
    assert.equal(result.format, "mp3");
    assert.equal(xhrLog.length, 1, "the file is sent once");
    assert.equal(adminCalls.length, 2);
    assert.equal(await usage("WHERE kind = 'upload'"), 1, "no second signature");
  });
  await t("a check that keeps failing says the file was sent but not verified, and does not claim the attempt was free", async () => {
    await reset();
    resourceImpl = async () => {
      throw { error: { message: "Internal error", http_code: 500 } };
    };
    const { result } = await silently(() => quickTimers(() => failsWith(() => uploadFile(mp3(), "audio"))));
    assert.ok(result instanceof UploadError);
    assert.match(result.message, /Le fichier est envoyé, mais sa vérification a échoué/);
    assert.ok(!/n'a pas été comptée/.test(result.message));
    assert.equal(adminCalls.length, CONFIRM_ATTEMPTS, "as many reads as the server allows, no more");
    assert.equal(xhrLog.length, 1);
  });
  await t("cancelling while waiting to retry the check stops there", async () => {
    await reset();
    resourceImpl = async () => {
      throw { error: { message: "Internal error", http_code: 500 } };
    };
    const controller = new AbortController();
    const { result } = await silently(async () => {
      const pending = failsWith(() => uploadFile(mp3(), "audio", { signal: controller.signal }));
      for (let i = 0; i < 200 && adminCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
      controller.abort();
      return pending;
    });
    assert.equal(result.name, "AbortError");
    assert.equal(adminCalls.length, 1, "no second read after the cancel");
  });
  await t("a browser that never reads the duration does not hold up a finished upload for long", async () => {
    await reset();
    mediaFake.hangs = true;
    resourceImpl = async (publicId) => echoAsset({ duration: undefined })(publicId);
    const started = Date.now();
    const r = await uploadFile(mp3(), "audio");
    const elapsed = Date.now() - started;
    mediaFake.hangs = false;
    assert.equal(r.duration, undefined);
    assert.equal(r.format, "mp3");
    assert.ok(elapsed < 4000, `waited ${elapsed} ms (the fallback of the duration reader is 10 s)`);
  });

  await t("cancelling during the upload aborts the request and rejects with an AbortError", async () => {
    await reset();
    xhrScript.push({ hang: true });
    const controller = new AbortController();
    const pending = failsWith(() => uploadFile(mp3(), "audio", { signal: controller.signal }));
    for (let i = 0; i < 50 && !xhrLog[0]?.form; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(xhrLog[0]?.form, "the upload started");
    controller.abort();
    const error = await pending;
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    assert.equal(xhrLog[0].aborted, true);
    assert.equal(adminCalls.length, 0, "an aborted upload is not confirmed");
  });
  await t("already aborted: no signature is requested at all", async () => {
    await reset();
    const controller = new AbortController();
    controller.abort();
    const error = await failsWith(() => uploadFile(mp3(), "audio", { signal: controller.signal }));
    assert.equal(error.name, "AbortError");
    assert.equal(xhrLog.length, 0);
    assert.equal(await usage(), 0);
  });

  console.log("uploadFile: photos");
  const jpg = (size: number) => fileOf("IMG_0001.JPG", size, "image/jpeg");
  const imageAsset = (publicId: string) => assetFor(publicId, { resource_type: "image", format: "jpg", duration: undefined, bytes: 3 * MB, width: 4000, height: 3000 });
  const resetCanvas = () => {
    encoderLog.length = 0;
    canvasLog.fills = 0;
    canvasLog.draws.length = 0;
    canvasLog.bitmapsClosed = 0;
    encoder = (type) => ({ type, size: 2 * MB });
    imageFake.fails = false;
  };
  await t("a light photo is uploaded as it is, the canvas untouched", async () => {
    await reset();
    resetCanvas();
    Object.assign(imageFake, { width: 4000, height: 3000 });
    resourceImpl = async (publicId) => imageAsset(publicId);
    await uploadFile(jpg(3 * MB), "image");
    assert.equal(encoderLog.length, 0);
    const sent = xhrLog[0].form!.get("file") as File;
    assert.equal(sent.name, "IMG_0001.JPG");
    assert.equal(sent.size, 3 * MB);
    assert.equal(xhrLog[0].url, "https://api.cloudinary.com/v1_1/demo/image/upload");
  });
  await t("a 48 MP photo is shrunk to 4096 px and re-encoded as JPEG before it is signed and sent", async () => {
    await reset();
    resetCanvas();
    Object.assign(imageFake, { width: 8000, height: 6000 });
    resourceImpl = async (publicId) => imageAsset(publicId);
    await uploadFile(jpg(9 * MB), "image");
    assert.deepEqual(encoderLog, [{ type: "image/jpeg", quality: 0.9, width: 4096, height: 3072, opaque: true }]);
    assert.deepEqual(canvasLog.draws, [[4096, 3072]]);
    assert.equal(canvasLog.bitmapsClosed, 1);
    const sent = xhrLog[0].form!.get("file") as File;
    assert.equal(sent.name, "IMG_0001.jpg");
    assert.equal(sent.type, "image/jpeg");
    assert.equal(sent.size, 2 * MB, "what is sent is the shrunk file");
  });
  await t("a heavy photo is re-encoded with lower quality until it fits under 10 MB", async () => {
    await reset();
    resetCanvas();
    Object.assign(imageFake, { width: 4000, height: 3000 });
    encoder = (type, quality) => ({ type, size: quality >= 0.9 ? 11 * MB : quality >= 0.8 ? 10 * MB + 1 : 9 * MB });
    resourceImpl = async (publicId) => imageAsset(publicId);
    await uploadFile(jpg(12 * MB), "image");
    assert.deepEqual(encoderLog.map((e) => e.quality), [0.9, 0.8, 0.7]);
    assert.deepEqual(encoderLog.map((e) => [e.width, e.height]), [[4000, 3000], [4000, 3000], [4000, 3000]], "never enlarged");
    assert.equal((xhrLog[0].form!.get("file") as File).size, 9 * MB);
  });
  await t("a big PNG goes to WebP (it keeps transparency); where WebP cannot be encoded it falls back to JPEG on white", async () => {
    await reset();
    resetCanvas();
    Object.assign(imageFake, { width: 6000, height: 5000 });
    resourceImpl = async (publicId) => imageAsset(publicId);
    await uploadFile(fileOf("logo.png", 3 * MB, "image/png"), "image");
    assert.deepEqual(encoderLog.map((e) => [e.type, e.opaque]), [["image/webp", false]]);
    assert.equal((xhrLog[0].form!.get("file") as File).name, "logo.webp");

    await reset();
    resetCanvas();
    resourceImpl = async (publicId) => imageAsset(publicId);
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 2 * MB }); // Safari before 17 answers PNG
    await uploadFile(fileOf("logo.png", 3 * MB, "image/png"), "image");
    assert.deepEqual(encoderLog.map((e) => [e.type, e.opaque]), [["image/webp", false], ["image/jpeg", true]]);
    assert.ok(canvasLog.fills >= 1, "white backdrop painted under the JPEG");
    assert.equal((xhrLog[0].form!.get("file") as File).name, "logo.jpg");
  });
  await t("a photo that cannot get under 10 MB, or cannot be read, is refused before any server call", async () => {
    await reset();
    resetCanvas();
    Object.assign(imageFake, { width: 4000, height: 3000 });
    encoder = (type) => ({ type, size: 12 * MB });
    assert.match((await failsWith(() => uploadFile(jpg(40 * MB), "image"))).message, /Impossible de réduire cette image/);
    assert.equal(canvasLog.bitmapsClosed, 1, "the bitmap is released even on failure");
    encoder = () => null;
    assert.match((await failsWith(() => uploadFile(jpg(40 * MB), "image"))).message, /Impossible de réduire cette image/);
    resetCanvas();
    imageFake.fails = true;
    assert.equal((await failsWith(() => uploadFile(jpg(1 * MB), "image"))).message, "Cette image est illisible.");
    assert.equal((await failsWith(() => uploadFile(jpg(40 * MB), "image"))).message, "Cette image est illisible.");
    assert.equal(xhrLog.length, 0);
    assert.equal(await usage(), 0);
  });
  uninstallBrowser();

  await reset();
}

// ============================================================================================ real PostgreSQL, opt-in

// PGlite runs one statement at a time, so it cannot show requests racing each other. With TEST_PG_URL pointing at a
// scratch database (psql and pgbench installed), the same reservations come from 100 parallel connections.
async function parallelRequests() {
  console.log("\n=== parallel requests on a real PostgreSQL ===");
  const url = process.env.TEST_PG_URL;
  if (!url) {
    console.log("  skipped - set TEST_PG_URL to a scratch database (needs psql and pgbench)");
    return;
  }
  const psql = (sql: string) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", "-c", sql], { encoding: "utf8" }).trim();
  const bench = (script: string) => {
    const file = join(mkdtempSync(join(tmpdir(), "neuro-pgbench-")), "script.sql");
    writeFileSync(file, script);
    execFileSync("pgbench", ["-n", "-c", "100", "-j", "8", "-t", "1", "-f", file, url], { stdio: "ignore" });
  };
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "db/schema.sql"], { stdio: "ignore" });
  const user = psql(`INSERT INTO users (email) VALUES ('race-' || gen_random_uuid() || '@example.com') RETURNING id`).split("\n")[0];
  const rows = () => psql(`SELECT count(*) || ' ' || COALESCE(sum(cost_usd), 0)::float FROM usage_events WHERE user_id = '${user}'`);

  await t("100 clients at once get exactly the daily limit of signatures, round after round", () => {
    for (let round = 0; round < 3; round++) {
      psql(`DELETE FROM usage_events WHERE user_id = '${user}'`);
      bench(`SELECT reserve_usage('${user}'::uuid, 'upload', 0, ${DAILY_LIMITS.upload}, 3, NULL);`);
      assert.equal(rows(), `${DAILY_LIMITS.upload} 0`, `round ${round + 1}`);
    }
  });
  await t("100 clients at once cannot spend past the dollar cap", () => {
    psql(`DELETE FROM usage_events WHERE user_id = '${user}'`);
    bench(`SELECT reserve_usage('${user}'::uuid, 'video', 0.5, 100, 3, NULL);`);
    assert.equal(rows(), "6 3");
  });
  await t("100 clients checking one issued id take CONFIRM_ATTEMPTS attempts, no more (same predicate as claimUploadCheck)", () => {
    psql(`DELETE FROM usage_events WHERE user_id = '${user}'`);
    psql(`INSERT INTO usage_events (user_id, kind, ref) VALUES ('${user}', 'upload', 'neuro-studio/audio/race/00000000')`);
    bench(
      `UPDATE usage_events SET confirm_attempts = confirm_attempts + 1 WHERE user_id = '${user}'::uuid AND kind = 'upload' ` +
        `AND ref = 'neuro-studio/audio/race/00000000' AND NOT refunded AND created_at > now() - interval '24 hours' ` +
        `AND confirm_attempts < ${CONFIRM_ATTEMPTS} RETURNING id;`,
    );
    assert.equal(psql(`SELECT confirm_attempts FROM usage_events WHERE user_id = '${user}'`), String(CONFIRM_ATTEMPTS));
  });
  psql(`DELETE FROM users WHERE id = '${user}'`);
}

(async () => {
  await pureHelpers();
  await scenario("legacy");
  await scenario("fresh");
  await parallelRequests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
