"use client";

import type { MotionProject, MotionScene } from "./types";

// Owns the <img>/<video>/<audio> elements behind a project's generated assets, so the
// live player and the exporter share the same loading + playback logic.

export class MediaStage {
  private images = new Map<string, HTMLImageElement>();
  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private pending: Promise<void>[] = [];

  /** @param withAudio the live player plays narration through <audio>; the exporter mixes it itself. */
  constructor(private readonly withAudio: boolean) {}

  /** Creates elements for assets we haven't seen, drops the ones no longer referenced. */
  sync(project: MotionProject, onLoad?: () => void) {
    const wanted = { image: new Set<string>(), video: new Set<string>(), audio: new Set<string>() };
    for (const scene of project.scenes) {
      if (scene.imageUrl) wanted.image.add(scene.imageUrl);
      if (scene.videoUrl) wanted.video.add(scene.videoUrl);
      if (scene.audioUrl && this.withAudio) wanted.audio.add(scene.audioUrl);
    }

    for (const url of wanted.image) {
      if (this.images.has(url)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous"; // required to keep the canvas exportable
      this.track(img, "load", onLoad);
      img.src = url;
      this.images.set(url, img);
    }
    for (const url of wanted.video) {
      if (this.videos.has(url)) continue;
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      this.track(video, "loadeddata", onLoad);
      video.src = url;
      this.videos.set(url, video);
    }
    for (const url of wanted.audio) {
      if (this.audios.has(url)) continue;
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = url;
      this.audios.set(url, audio);
    }

    prune(this.images, wanted.image);
    prune(this.videos, wanted.video, (v) => v.pause());
    prune(this.audios, wanted.audio, (a) => a.pause());
  }

  private track(el: HTMLElement, event: string, onLoad?: () => void) {
    this.pending.push(
      new Promise<void>((resolve) => {
        const done = () => {
          onLoad?.();
          resolve();
        };
        el.addEventListener(event, done, { once: true });
        el.addEventListener("error", () => resolve(), { once: true }); // a broken asset must not block the rest
      }),
    );
  }

  /** Resolves once every asset requested so far has loaded (or failed). */
  async ready(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** What the media layer should draw for this scene right now. */
  source(scene: MotionScene): CanvasImageSource | null {
    const video = scene.videoUrl ? this.videos.get(scene.videoUrl) : undefined;
    if (video && video.readyState >= 2 && video.videoWidth > 0) return video;
    const img = scene.imageUrl ? this.images.get(scene.imageUrl) : undefined;
    if (img && img.complete && img.naturalWidth > 0) return img;
    return null;
  }

  /** Call when entering a scene, seeking, or toggling play/pause. */
  enter(scene: MotionScene, localTime: number, playing: boolean) {
    const activeVideo = scene.videoUrl ? this.videos.get(scene.videoUrl) : undefined;
    const activeAudio = scene.audioUrl ? this.audios.get(scene.audioUrl) : undefined;

    for (const v of this.videos.values()) if (v !== activeVideo) v.pause();
    for (const a of this.audios.values()) if (a !== activeAudio) a.pause();

    if (activeVideo) {
      const d = activeVideo.duration;
      // A scene cut out of a longer one starts part-way into its clip (mediaOffset), and the clip loops.
      const target = Number.isFinite(d) && d > 0 ? (localTime + (scene.mediaOffset ?? 0)) % d : 0;
      if (Math.abs(activeVideo.currentTime - target) > 0.3) activeVideo.currentTime = target;
      if (playing) void activeVideo.play().catch(() => {});
      else activeVideo.pause();
    }
    if (activeAudio) {
      // Likewise the narration: the second half of a split scene resumes where the first half stopped.
      const target = localTime + (scene.audioOffset ?? 0);
      if (Math.abs(activeAudio.currentTime - target) > 0.3) activeAudio.currentTime = target;
      if (playing && target < (activeAudio.duration || Infinity) && localTime < scene.duration) void activeAudio.play().catch(() => {});
      else activeAudio.pause();
    }
  }

  pause() {
    for (const v of this.videos.values()) v.pause();
    for (const a of this.audios.values()) a.pause();
  }

  dispose() {
    this.pause();
    for (const v of this.videos.values()) v.removeAttribute("src");
    for (const a of this.audios.values()) a.removeAttribute("src");
    this.images.clear();
    this.videos.clear();
    this.audios.clear();
  }
}

function prune<T>(map: Map<string, T>, keep: Set<string>, onDrop?: (el: T) => void) {
  for (const [url, el] of map) {
    if (keep.has(url)) continue;
    onDrop?.(el);
    map.delete(url);
  }
}
