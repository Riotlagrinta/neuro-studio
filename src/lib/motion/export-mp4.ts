"use client";

import type * as Mediabunny from "mediabunny";
import { musicGainCurve, musicLoopPlan, sceneAudioSchedule, scheduleGain } from "./audio-mix";
import {
  AUDIO_BITRATE,
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  audioFrameCount,
  avcCodecString,
  backdropSampleTime,
  backdropsAt,
  chooseContainer,
  clipTime,
  containerFormat,
  estimateBytes,
  exportSize,
  frameCount,
  frameDurationUs,
  frameTimestampUs,
  MAX_FILE_BYTES,
  vp9CodecString,
  type ContainerCapabilities,
  type ContainerChoice,
  type ExportContainer,
  type ExportPreset,
} from "./export-plan";
import { loadFonts, resolveFontStacks } from "./fonts";
import { renderFrame } from "./render";
import { projectDuration, type AspectRatio, type MotionProject, type MotionScene } from "./types";

// Offline export: every frame is drawn with the shared renderFrame at t = frameIndex / fps, handed to a WebCodecs
// encoder and muxed by Mediabunny, so a video exports faster than it plays and frame-exact, whatever the tab does.
// Mediabunny is imported lazily: the editor does not pay for it until somebody exports.

/** What reading a clip needs from Mediabunny; handed over by exportProject, which is the one that imports the library. */
type Decoding = Pick<typeof Mediabunny, "ALL_FORMATS" | "BlobSource" | "CanvasSink" | "Input">;

export interface ExportSupport extends ContainerChoice {
  capabilities: ContainerCapabilities;
}

/** Thrown when the offline export cannot run in this browser: the caller falls back to exportProjectToWebm (real time). */
export class ExportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportUnavailableError";
  }
}

const abortError = () => new DOMException("Export annulé", "AbortError");

/** Rejects as soon as the signal aborts, even if `promise` never settles (a seek that never fires, a stalled encoder). */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Gives the page a turn without setTimeout: timers are clamped to one second in background tabs, messages are not. */
const yieldNow = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

// ---------- what this browser can encode ----------

async function videoEncodable(config: VideoEncoderConfig): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false; // an unknown or invalid field makes isConfigSupported throw instead of answering false
  }
}

async function audioEncodable(codec: string, bitrate: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    return (await AudioEncoder.isConfigSupported({ codec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate })).supported === true;
  } catch {
    return false;
  }
}

/**
 * Which container the offline export can write here, found by asking the encoders about the real configuration
 * (size, level, bitrate). Cheap, does not load Mediabunny: call it when the export options open, then grey out
 * what `container` says is impossible and show `reason`. When it answers 'realtime', use exportProjectToWebm.
 * Pass `seconds` (the project's duration) to apply the in-memory size limit. The answer is the encoders' own: where one
 * says yes and then fails (Firefox), exportProject moves to the next container, so the file name must come from
 * ExportResult.container.
 */
export async function getExportSupport(preset: ExportPreset, hasAudio: boolean, options: { ratio?: AspectRatio; seconds?: number } = {}): Promise<ExportSupport> {
  const hasVideoEncoder = typeof VideoEncoder !== "undefined";
  const { width, height } = exportSize(preset, options.ratio ?? "16:9");
  const video = { width, height, bitrate: preset.videoBitrate, framerate: preset.fps, bitrateMode: "variable", latencyMode: "quality" } as const;
  const [hasH264, hasVp9, hasAac, hasOpus] = hasVideoEncoder
    ? await Promise.all([
        videoEncodable({ ...video, codec: avcCodecString(width, height, preset.fps, preset.videoBitrate), avc: { format: "avc" } }),
        videoEncodable({ ...video, codec: vp9CodecString(width, height) }),
        hasAudio && audioEncodable("mp4a.40.2", AUDIO_BITRATE.aac),
        hasAudio && audioEncodable("opus", AUDIO_BITRATE.opus),
      ])
    : [false, false, false, false];
  const capabilities: ContainerCapabilities = {
    hasVideoEncoder,
    hasH264,
    hasAac,
    hasVp9,
    hasOpus,
    hasAudio,
    estimatedBytes: options.seconds === undefined ? undefined : estimateBytes(preset, options.seconds),
  };
  return { ...chooseContainer(capabilities), capabilities };
}

// ---------- backdrops (the scene's AI video or image) ----------

const IMAGE_TIMEOUT_MS = 20_000;
/** A download that sends nothing for this long is given up on: a stalled response never settles by itself. */
const DOWNLOAD_IDLE_MS = 30_000;
const VIDEO_LOAD_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 3_000;
/** After 'seeked', how long to wait for the <video> to present the new picture before drawing it anyway. */
const PRESENT_TIMEOUT_MS = 250;
/** A jump further ahead than this is cheaper to reach from the nearest key frame than by decoding everything in between. */
const MAX_FORWARD_JUMP = 1;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
    function finish(value: HTMLImageElement | null) {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(value);
    }
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.crossOrigin = "anonymous"; // before src, or the canvas is tainted and the frames cannot be read
    img.src = url;
  });
}

/** null when the file cannot be fetched (network, CORS, stalled download): the export goes on without it. */
async function download(url: string, signal?: AbortSignal): Promise<Blob | null> {
  if (signal?.aborted) throw abortError();
  const attempt = new AbortController();
  const stop = () => attempt.abort();
  signal?.addEventListener("abort", stop, { once: true });
  let idle = setTimeout(stop, DOWNLOAD_IDLE_MS);
  try {
    const res = await fetch(url, { signal: attempt.signal });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.blob();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      clearTimeout(idle);
      idle = setTimeout(stop, DOWNLOAD_IDLE_MS);
    }
    return new Blob(parts, { type: res.headers.get("content-type") ?? "" });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener("abort", stop);
  }
}

/** Resolves true when the event fires, false on timeout; rejects when the element reports an error. */
function waitFor(target: HTMLMediaElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(false), timeoutMs);
    function settle(fired: boolean, error?: Error) {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve(fired);
    }
    const onEvent = () => settle(true);
    const onError = () => settle(false, new Error("Lecture du plan vidéo impossible."));
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

/** Hands out the picture of a video clip for a given moment of its scene. */
interface VideoCursor {
  /** `sceneTime` seconds into the scene; the clip loops and may start part-way in, like in the live player. */
  frameAt(sceneTime: number, mediaOffset: number | undefined): Promise<CanvasImageSource | null>;
  close(): void;
}

/** Decodes with WebCodecs through Mediabunny, walking forward frame by frame; restarts when the clip wraps. */
class SinkCursor implements VideoCursor {
  private iterator: AsyncGenerator<Mediabunny.WrappedCanvas, void, unknown> | null = null;
  private current: Mediabunny.WrappedCanvas | null = null;
  private next: Mediabunny.WrappedCanvas | null = null;
  private ended = false;
  private last = -Infinity;

  constructor(
    private readonly sink: Mediabunny.CanvasSink,
    private readonly duration: number,
  ) {}

  async frameAt(sceneTime: number, mediaOffset: number | undefined) {
    const t = clipTime(sceneTime, mediaOffset, this.duration);
    const farAhead = this.current !== null && t - (this.current.timestamp + this.current.duration) > MAX_FORWARD_JUMP;
    // First call, going back (the clip wrapped) or far ahead: decode again from the key frame before t.
    if (this.iterator === null || t < this.last || farAhead) await this.restart(t);
    this.last = t;
    for (;;) {
      if (!this.next && !this.ended && this.iterator) {
        const result = await this.iterator.next();
        if (result.done) this.ended = true;
        else this.next = result.value;
      }
      if (!this.next || this.next.timestamp > t) break;
      this.current = this.next;
      this.next = null;
    }
    return this.current?.canvas ?? null;
  }

  private async restart(t: number) {
    await this.release();
    this.iterator = this.sink.canvases(t); // starts with the frame showing at t
    const first = await this.iterator.next();
    this.current = first.done ? null : first.value;
    this.ended = first.done === true;
  }

  private async release() {
    const iterator = this.iterator;
    this.iterator = null;
    this.current = this.next = null;
    this.ended = false;
    await iterator?.return(undefined).catch(() => {});
  }

  close() {
    void this.release();
  }
}

/**
 * Fallback when WebCodecs cannot decode the clip: seek a <video> to each frame. Slow (tens of milliseconds a frame,
 * about 100 ms on a long-GOP 1080p clip). 'seeked' can fire before drawImage sees the new picture (about one frame in
 * thirty showed the previous clip frame), so each seek also waits for the video to present a frame. A hidden tab
 * presents none and every seek would return the same picture: the cursor waits for the tab to come back.
 */
class SeekCursor implements VideoCursor {
  private shown = false;
  private closed = false;
  private wake: (() => void) | null = null;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {}

  static async open(blob: Blob): Promise<SeekCursor | null> {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const cursor = new SeekCursor(video, url);
    try {
      video.src = url;
      if ((await waitFor(video, "loadeddata", VIDEO_LOAD_TIMEOUT_MS)) && video.videoWidth > 0) return cursor;
    } catch {
      // unreadable: fall through
    }
    cursor.close();
    return null;
  }

  async frameAt(sceneTime: number, mediaOffset: number | undefined) {
    await this.untilVisible();
    const duration = this.video.duration;
    // Never the very end of the clip: seeking there can show nothing.
    const target = Math.min(clipTime(sceneTime, mediaOffset, duration), Math.max(0, duration - 0.001));
    if (!this.shown || Math.abs(this.video.currentTime - target) > 1e-3) await this.seek(target);
    this.shown = true;
    return this.video;
  }

  private untilVisible(): Promise<void> {
    if (!document.hidden) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        document.removeEventListener("visibilitychange", onChange);
        this.wake = null;
        resolve();
      };
      const onChange = () => {
        if (!document.hidden) done();
      };
      this.wake = done;
      document.addEventListener("visibilitychange", onChange);
    });
  }

  /** 'seeked' sometimes never fires: one more try, then give up on this clip. */
  private async seek(target: number) {
    if (this.closed) throw new Error("Lecture du plan vidéo interrompue.");
    for (let attempt = 0; attempt < 2; attempt++) {
      const seeked = waitFor(this.video, "seeked", SEEK_TIMEOUT_MS);
      const presented = this.presented();
      this.video.currentTime = target;
      if (await seeked) {
        await presented;
        return;
      }
    }
    throw new Error("Le plan vidéo ne répond plus.");
  }

  /** Resolves when the video presents its next frame, or after a short wait if it never does; at once without requestVideoFrameCallback. */
  private presented(): Promise<void> {
    const video = this.video;
    if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, PRESENT_TIMEOUT_MS);
      const handle = video.requestVideoFrameCallback(done);
      function done() {
        clearTimeout(timer);
        video.cancelVideoFrameCallback(handle);
        resolve();
      }
    });
  }

  close() {
    this.closed = true;
    this.wake?.();
    this.video.removeAttribute("src");
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

interface ClipEntry {
  blob: Blob;
  /** null when Mediabunny cannot read or the browser cannot decode this clip. */
  track: Mediabunny.InputVideoTrack | null;
  duration: number;
}

interface SceneBackdrop {
  clip: ClipEntry;
  cursor: VideoCursor | null;
  /** 0: Mediabunny CanvasSink, 1: seeking a <video>, 2: no video, the scene's image is used. */
  level: number;
}

/** Everything the backdrops need, loaded up front, then one frame at a time. A broken asset is skipped with a warning, never fatal. */
class Backdrops {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly blobs = new Map<string, Blob>();
  private readonly clips = new Map<string, Promise<ClipEntry>>();
  private readonly inputs: Mediabunny.Input[] = [];
  private readonly scenes = new Map<number, SceneBackdrop>();
  private disposed = false;

  private constructor(
    private readonly mb: Decoding,
    private readonly project: MotionProject,
    private readonly warn: (message: string) => void,
  ) {}

  static async load(mb: Decoding, project: MotionProject, warn: (message: string) => void, signal?: AbortSignal): Promise<Backdrops> {
    const backdrops = new Backdrops(mb, project, warn);
    const videos = new Set<string>();
    const images = new Set<string>();
    for (const scene of project.scenes) {
      if (!scene.layers.some((layer) => layer.type === "media")) continue;
      if (scene.videoUrl) videos.add(scene.videoUrl);
      if (scene.imageUrl) images.add(scene.imageUrl);
    }
    await Promise.all([
      ...[...videos].map(async (url) => {
        const blob = await download(url, signal);
        if (blob) backdrops.blobs.set(url, blob);
      }),
      ...[...images].map(async (url) => {
        const img = await loadImage(url);
        if (img) backdrops.images.set(url, img);
      }),
    ]);
    project.scenes.forEach((scene, index) => {
      const lostVideo = scene.videoUrl && videos.has(scene.videoUrl) && !backdrops.blobs.has(scene.videoUrl);
      const lostImage = scene.imageUrl && images.has(scene.imageUrl) && !backdrops.images.has(scene.imageUrl);
      if (lostVideo) warn(`Le plan vidéo de la scène ${index + 1} n'a pas pu être chargé${lostImage || !scene.imageUrl ? " : la scène est exportée sans fond" : " : son image le remplace"}.`);
      else if (lostImage && !scene.videoUrl) warn(`L'image de fond de la scène ${index + 1} n'a pas pu être chargée : la scène est exportée sans fond.`);
    });
    return backdrops;
  }

  /** The picture to draw for `sceneTime` seconds into scene `index`, or null (nothing to draw). */
  async frame(index: number, sceneTime: number, fps: number): Promise<CanvasImageSource | null> {
    const scene = this.project.scenes[index];
    const time = backdropSampleTime(sceneTime, scene.duration, fps);
    const blob = scene.videoUrl ? this.blobs.get(scene.videoUrl) : undefined;
    if (scene.videoUrl && blob) {
      let backdrop = this.scenes.get(index);
      if (!backdrop) {
        backdrop = { clip: await this.openClip(scene.videoUrl, blob), cursor: null, level: 0 };
        this.scenes.set(index, backdrop);
      }
      while (!this.disposed) {
        try {
          const opened = backdrop.cursor ?? (await this.cursorFor(backdrop));
          if (this.disposed) {
            opened?.close(); // the export ended while the clip was opening
            break;
          }
          backdrop.cursor = opened;
          if (!backdrop.cursor) {
            this.warn(`Le plan vidéo de la scène ${index + 1} n'a pas pu être lu : ${scene.imageUrl ? "son image le remplace" : "la scène est exportée sans fond"}.`);
            break;
          }
          const picture = await backdrop.cursor.frameAt(time, scene.mediaOffset);
          if (picture) return picture;
          break;
        } catch {
          // Decoding or seeking failed: go down one level (WebCodecs, then seeking, then the image).
          backdrop.cursor?.close();
          backdrop.cursor = null;
          backdrop.level = Math.min(backdrop.level + 1, 2);
        }
      }
    }
    return (scene.imageUrl && this.images.get(scene.imageUrl)) || null;
  }

  /** Stops decoding for scenes the next frames no longer draw. */
  retain(keep: ReadonlySet<number>) {
    for (const [index, backdrop] of this.scenes) {
      if (keep.has(index)) continue;
      backdrop.cursor?.close();
      this.scenes.delete(index);
    }
  }

  dispose() {
    this.disposed = true;
    for (const backdrop of this.scenes.values()) backdrop.cursor?.close();
    this.scenes.clear();
    for (const input of this.inputs) input.dispose();
    this.inputs.length = 0;
  }

  private openClip(url: string, blob: Blob): Promise<ClipEntry> {
    let clip = this.clips.get(url);
    if (!clip) {
      clip = this.probeClip(blob);
      this.clips.set(url, clip);
    }
    return clip;
  }

  private async probeClip(blob: Blob): Promise<ClipEntry> {
    let input: Mediabunny.Input | null = null;
    try {
      input = new this.mb.Input({ source: new this.mb.BlobSource(blob), formats: this.mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const duration = await input.computeDuration();
        this.inputs.push(input);
        return { blob, track, duration };
      }
    } catch {
      // Mediabunny cannot read this file; the <video> element may still play it
    }
    input?.dispose();
    return { blob, track: null, duration: NaN };
  }

  private async cursorFor(backdrop: SceneBackdrop): Promise<VideoCursor | null> {
    if (backdrop.level === 0) {
      // One sink (and decoder) per scene: two scenes sharing a clip during a transition need two positions in it.
      if (backdrop.clip.track) return new SinkCursor(new this.mb.CanvasSink(backdrop.clip.track, { poolSize: 3 }), backdrop.clip.duration);
      backdrop.level = 1;
    }
    if (backdrop.level === 1) {
      const cursor = await SeekCursor.open(backdrop.clip.blob);
      if (cursor) {
        this.warn("Un plan vidéo n'a pas pu être décodé image par image : lecture de secours, plus lente, où une image peut rester en retard d'un cran.");
        return cursor;
      }
      backdrop.level = 2;
    }
    return null;
  }
}

// ---------- audio ----------

/** A pass of the music is faded out and in over this long around the loop point, to hide the click of a track cut mid-note. */
const LOOP_FADE_SECONDS = 0.01;

/** Narration, music loop, fades and ducking mixed offline, as the live preview plays them. null when there is nothing to hear. */
async function renderMix(project: MotionProject, total: number, warn: (message: string) => void, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const clips = sceneAudioSchedule(project);
  const music = project.music?.url ? project.music : null;
  if (clips.length === 0 && !music) return null;

  const context = new OfflineAudioContext(AUDIO_CHANNELS, audioFrameCount(total), AUDIO_SAMPLE_RATE);
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (url: string) => {
    let buffer = decoded.get(url);
    if (!buffer) {
      buffer = (async () => {
        try {
          const blob = await download(url, signal);
          return blob ? await context.decodeAudioData(await blob.arrayBuffer()) : null;
        } catch {
          return null; // also what an abort looks like here; checked right after the downloads
        }
      })();
      decoded.set(url, buffer);
    }
    return buffer;
  };
  // Split scenes share their narration file, which is downloaded and decoded once.
  await Promise.all([...clips.map((clip) => decode(clip.url)), music ? decode(music.url) : null]);
  if (signal?.aborted) throw abortError();

  let heard = false;
  for (const clip of clips) {
    const buffer = await decode(clip.url);
    if (!buffer) {
      warn(`La voix de la scène ${clip.sceneIndex + 1} n'a pas pu être chargée : elle manque dans la vidéo.`);
      continue;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    // start(when, offset, duration): a split scene plays its slice of the file, not the whole file.
    source.start(clip.startAt, clip.offset, clip.length);
    heard = true;
  }

  const buffer = music ? await decode(music.url) : null;
  const curve = musicGainCurve(project);
  if (music && !buffer) warn("La musique n'a pas pu être chargée : elle manque dans la vidéo.");
  if (buffer && curve) {
    const master = context.createGain();
    master.connect(context.destination);
    scheduleGain(master.gain, curve, 0);
    const passes = musicLoopPlan(buffer.duration, total);
    passes.forEach((pass, i) => {
      const fade = Math.min(LOOP_FADE_SECONDS, pass.length / 2);
      const join = context.createGain();
      join.connect(master);
      if (i > 0) {
        join.gain.setValueAtTime(0, pass.at);
        join.gain.linearRampToValueAtTime(1, pass.at + fade);
      }
      if (i < passes.length - 1) {
        join.gain.setValueAtTime(1, pass.at + pass.length - fade);
        join.gain.linearRampToValueAtTime(0, pass.at + pass.length);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(join);
      source.start(pass.at, pass.offset, pass.length);
    });
    heard = passes.length > 0 || heard;
  }
  if (!heard) return null;

  const mix = await abortable(context.startRendering(), signal);
  // Voice over loud music can exceed full scale: clip it here rather than leave it to each encoder.
  for (let channel = 0; channel < mix.numberOfChannels; channel++) {
    const samples = mix.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      if (samples[i] > 1) samples[i] = 1;
      else if (samples[i] < -1) samples[i] = -1;
    }
  }
  return mix;
}

/** Feeds the mix to an encoder source in one-second chunks, interleaved with the video so the muxer never has to hold one track back. */
class AudioPump {
  private position = 0;

  constructor(
    private readonly source: Mediabunny.AudioBufferSource,
    private readonly mix: AudioBuffer,
    private readonly signal?: AbortSignal,
  ) {}

  /** Encodes the mix up to `seconds`. */
  async until(seconds: number) {
    while (this.position < this.mix.length && this.position / AUDIO_SAMPLE_RATE < seconds) {
      const length = Math.min(AUDIO_SAMPLE_RATE, this.mix.length - this.position);
      const chunk = new AudioBuffer({ length, numberOfChannels: this.mix.numberOfChannels, sampleRate: this.mix.sampleRate });
      for (let channel = 0; channel < this.mix.numberOfChannels; channel++) {
        chunk.copyToChannel(this.mix.getChannelData(channel).subarray(this.position, this.position + length), channel);
      }
      this.position += length;
      await abortable(this.source.add(chunk), this.signal);
    }
  }
}

// ---------- export ----------

export interface ExportOptions {
  preset: ExportPreset;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  extension: "mp4" | "webm";
  container: Exclude<ExportContainer, "realtime">;
  /** Assets that could not be used (French, ready to show): the video was exported without them. */
  warnings: string[];
}

// Share of the progress bar: assets and audio mix, then the frames (audio is encoded alongside), then closing the file.
const PREPARED = 0.04;
const ENCODED = 0.97;

type WrittenContainer = ExportResult["container"];

function codecsOf(container: WrittenContainer, preset: ExportPreset, width: number, height: number) {
  return container === "mp4-h264-aac"
    ? ({ video: "avc", audio: "aac", fullCodecString: avcCodecString(width, height, preset.fps, preset.videoBitrate) } as const)
    : ({ video: "vp9", audio: "opus", fullCodecString: vp9CodecString(width, height) } as const);
}

/** A failed encoder surfaces as an English DOMException and the UI shows the message as it comes: give it a French one. */
function explain(error: unknown): unknown {
  if (error instanceof DOMException && error.name !== "AbortError") return new Error(`L'encodage de la vidéo a échoué (${error.name}).`, { cause: error });
  return error;
}

/**
 * Exports the project faster than real time. Rejects with ExportUnavailableError when this browser cannot (use the
 * real-time export instead), before encoding or midway when the file outgrows the in-memory limit, with an AbortError
 * DOMException when `signal` aborts, with an Error (French message) otherwise. `onProgress` receives 0..1, audio and
 * finalization included.
 */
export async function exportProject(project: MotionProject, onProgress: (fraction: number) => void, { preset, signal }: ExportOptions): Promise<ExportResult> {
  const total = projectDuration(project);
  const frames = frameCount(total, preset.fps);
  if (frames === 0) throw new Error("Rien à exporter : le projet est vide.");
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };
  checkAbort();

  const hasAudio = sceneAudioSchedule(project).length > 0 || Boolean(project.music?.url);
  const support = await getExportSupport(preset, hasAudio, { ratio: project.ratio, seconds: total });
  if (support.container === "realtime") throw new ExportUnavailableError(support.reason);
  const { width, height } = exportSize(preset, project.ratio);
  // Destructured so that a bundler that can tree-shake dynamic imports keeps only what is used.
  const { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, Quality, WebMOutputFormat, canEncodeAudio, canEncodeVideo } = await import("mediabunny");
  checkAbort();
  const videoQuality = new Quality({ bitrate: preset.videoBitrate, bitrateMode: "variable" });

  // isConfigSupported can say yes where encoding then fails (Firefox): Mediabunny encodes a trial frame instead. A
  // container whose encoders refuse hands over to the next one, before anything is downloaded.
  let capabilities = support.capabilities;
  let choice: ContainerChoice = support;
  let container: WrittenContainer;
  let codecs: ReturnType<typeof codecsOf>;
  for (;;) {
    if (choice.container === "realtime") throw new ExportUnavailableError(choice.reason);
    container = choice.container;
    codecs = codecsOf(container, preset, width, height);
    const mp4 = container === "mp4-h264-aac";
    if (!(await canEncodeVideo(codecs.video, { width, height, quality: videoQuality, frameRate: preset.fps, fullCodecString: codecs.fullCodecString, latencyMode: "quality" }))) {
      capabilities = mp4 ? { ...capabilities, hasH264: false } : { ...capabilities, hasVp9: false };
    } else if (hasAudio && !(await canEncodeAudio(codecs.audio, { numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE, quality: new Quality({ bitrate: AUDIO_BITRATE[codecs.audio] }) }))) {
      capabilities = mp4 ? { ...capabilities, hasAac: false } : { ...capabilities, hasOpus: false };
    } else break;
    checkAbort();
    choice = chooseContainer(capabilities);
  }

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const fonts = resolveFontStacks();
  await loadFonts(fonts);
  checkAbort();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");

  let backdrops: Backdrops | null = null;
  let output: Mediabunny.Output<Mediabunny.OutputFormat, Mediabunny.BufferTarget> | null = null;
  let finalized = false;
  // The file is built in memory: whatever the bitrate does, it stops here rather than take the tab down with it.
  let encodedBytes = 0;
  const countBytes = (packet: Mediabunny.EncodedPacket) => {
    encodedBytes += packet.byteLength;
  };
  const checkSize = () => {
    if (encodedBytes > MAX_FILE_BYTES) {
      throw new ExportUnavailableError(`La vidéo dépasse ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} Mo, trop pour l'export rapide qui la garde en mémoire : export en temps réel, onglet à garder visible jusqu'à la fin.`);
    }
  };
  try {
    backdrops = await abortable(Backdrops.load({ ALL_FORMATS, BlobSource, CanvasSink, Input }, project, warn, signal), signal);
    onProgress(PREPARED / 2);
    const mix = await renderMix(project, total, warn, signal);
    checkAbort();
    onProgress(PREPARED);

    output = new Output({ format: container === "mp4-h264-aac" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: codecs.video, quality: videoQuality, fullCodecString: codecs.fullCodecString, keyFrameInterval: 2, latencyMode: "quality", onEncodedPacket: countBytes });
    output.addVideoTrack(video, { frameRate: preset.fps });
    let pump: AudioPump | null = null;
    if (mix) {
      const audio = new AudioBufferSource({ codec: codecs.audio, quality: new Quality({ bitrate: AUDIO_BITRATE[codecs.audio] }), onEncodedPacket: countBytes });
      output.addAudioTrack(audio);
      pump = new AudioPump(audio, mix, signal);
    }
    await abortable(output.start(), signal);

    let lastYield = performance.now();
    let lastReported = -1;
    for (let i = 0; i < frames; i++) {
      checkAbort();
      checkSize();
      const t = i / preset.fps;
      const needs = backdropsAt(project, t);
      backdrops.retain(new Set(needs.map((need) => need.sceneIndex)));
      const pictures = new Map<MotionScene, CanvasImageSource | null>();
      for (const need of needs) {
        pictures.set(project.scenes[need.sceneIndex], await abortable(backdrops.frame(need.sceneIndex, need.local, preset.fps), signal));
      }
      renderFrame(ctx, project, t, (scene) => pictures.get(scene) ?? null, fonts);

      const timestamp = frameTimestampUs(i, preset.fps);
      await abortable(video.add(timestamp / 1e6, frameDurationUs(i, preset.fps) / 1e6), signal);
      await pump?.until(timestamp / 1e6 + 1);

      const fraction = PREPARED + (ENCODED - PREPARED) * ((i + 1) / frames);
      if (fraction - lastReported >= 0.002) {
        lastReported = fraction;
        onProgress(fraction);
      }
      if (performance.now() - lastYield > 16) {
        await yieldNow();
        lastYield = performance.now();
      }
    }
    video.close();
    await pump?.until(Infinity);
    checkAbort();
    checkSize();
    await abortable(output.finalize(), signal);
    finalized = true;
    checkAbort();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Le fichier vidéo est vide.");
    output.target.buffer = null;
    onProgress(1);
    const { extension, mime } = containerFormat(container);
    return { blob: new Blob([buffer], { type: mime }), mime, extension, container, warnings };
  } catch (error) {
    if (!finalized) await output?.cancel().catch(() => {});
    throw explain(error);
  } finally {
    backdrops?.dispose();
    canvas.width = canvas.height = 0;
  }
}
