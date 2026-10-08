"use client";

import { gainAt, musicGainCurve, musicLoopPlan, type GainPoint } from "./audio-mix";
import { projectDuration, type MotionProject } from "./types";

// Plays the project's background music under the live preview. The element is a slave of the playhead: the player
// tells it where the video is and it only corrects itself when it has drifted, so a loop point or a slow network
// never turns into a glitch on every frame. The volume comes from the very curve the export mixes (fade in/out and
// ducking under the narration, `music.volume` already included), so what you hear is what ends up in the file.

/** The element is left alone while it is within this of where the video is. */
const DRIFT = 0.3;
/** A seek (play, scrub, loop) is exact to this: below it the element is already in the right place. */
const SEEK_TOLERANCE = 0.05;

/** Where in a file of `duration` seconds the video time `t` falls when the file loops. An unknown duration is no loop. */
export function loopPosition(t: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? t - Math.floor(t / duration) * duration : t;
}

/** How far apart two positions of a looping file are: 0.01 s before the end and 0.01 s after the start are close. */
export function loopDrift(current: number, target: number, duration: number): number {
  const gap = Math.abs(current - target);
  return Number.isFinite(duration) && duration > 0 ? Math.min(gap, Math.abs(duration - gap)) : gap;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export class MusicStage {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private project: MotionProject | null = null;
  /** undefined: not computed since the project last changed. null: no music. */
  private curve: GainPoint[] | null | undefined;
  private total = 0;
  /** The playhead, as last told by seek() / update(). */
  private time = 0;
  /** Whether the video is playing, i.e. whether the music should be. */
  private playing = false;
  /** play() was refused (autoplay policy) or the file is broken: don't retry on every frame. */
  private blocked = false;
  /** The file can be played for the whole video (a sliver of a file would need millions of loops: silence, as in the export). */
  private loopable = true;
  private planned = { duration: NaN, total: NaN, ok: true };
  private disposed = false;

  /** Call whenever the project changes. Opens, replaces or releases the audio element only when the music URL changes. */
  sync(project: MotionProject): void {
    if (this.disposed) return;
    this.project = project;
    this.curve = undefined;
    this.total = projectDuration(project);
    const url = project.music?.url || null;
    if (url !== this.url) {
      this.release();
      if (url) this.open(url);
    } else if (this.audio) {
      this.loopable = this.canLoop(this.audio);
      this.applyVolume(this.audio, this.time);
    }
  }

  /**
   * The video jumped to `t` (it started playing, the loop restarted, the user scrubbed). While playing, the music
   * goes to its place in the loop and starts; otherwise it is paused where it is and will be placed when it starts.
   */
  seek(t: number, playing: boolean): void {
    this.time = t;
    this.playing = playing;
    this.blocked = false;
    const audio = this.audio;
    if (!audio) return;
    this.applyVolume(audio, t);
    if (playing && this.audible(t)) this.start(audio, t);
    else audio.pause();
  }

  /** Every painted frame while playing: sets the volume and corrects the position if it has drifted. */
  update(t: number): void {
    this.time = t;
    const audio = this.audio;
    if (!audio) return;
    this.applyVolume(audio, t);
    if (!this.playing) return;
    if (!this.audible(t)) {
      audio.pause();
      return;
    }
    // A file shorter than the video stops at its end: the loop starts it again.
    if (audio.ended || (audio.paused && !this.blocked)) this.start(audio, t);
    else if (!audio.seeking) this.place(audio, t, DRIFT);
  }

  pause(): void {
    this.playing = false;
    this.audio?.pause();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  private open(url: string): void {
    const audio = new Audio();
    audio.crossOrigin = "anonymous"; // before src, or the request goes out without CORS
    audio.preload = "auto";
    audio.loop = false;
    const known = () => {
      if (this.audio !== audio) return;
      this.loopable = this.canLoop(audio);
      // Opened while the video was already playing: the file wasn't ready to be placed until now.
      if (this.playing && this.audible(this.time)) this.start(audio, this.time);
    };
    audio.addEventListener("loadedmetadata", known);
    audio.addEventListener("durationchange", known);
    audio.addEventListener("error", () => {
      if (this.audio === audio) this.blocked = true;
    });
    audio.src = url;
    this.audio = audio;
    this.url = url;
    this.applyVolume(audio, this.time);
  }

  private release(): void {
    const audio = this.audio;
    this.audio = null;
    this.url = null;
    this.blocked = false;
    this.loopable = true;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load(); // drops what was buffered
  }

  /** Whether music is heard at `t`: there is some, the video is still going, and the file can cover it. */
  private audible(t: number): boolean {
    return this.audio !== null && this.getCurve() !== null && this.loopable && t >= 0 && t < this.total;
  }

  private canLoop(audio: HTMLAudioElement): boolean {
    if (!Number.isFinite(audio.duration)) return true; // not known yet
    // Called on every project change while the file and the video keep their length: plan once.
    if (this.planned.duration !== audio.duration || this.planned.total !== this.total) {
      this.planned = { duration: audio.duration, total: this.total, ok: musicLoopPlan(audio.duration, this.total).length > 0 };
    }
    return this.planned.ok;
  }

  private getCurve(): GainPoint[] | null {
    if (this.curve === undefined) this.curve = this.project ? musicGainCurve(this.project) : null;
    return this.curve;
  }

  private applyVolume(audio: HTMLAudioElement, t: number): void {
    const curve = this.getCurve();
    const volume = curve && this.audible(t) ? clamp01(gainAt(curve, t)) : 0;
    if (audio.volume !== volume) audio.volume = volume;
  }

  /** Moves the element to its place in the loop at `t` unless it is within `tolerance` of it. Never throws. */
  private place(audio: HTMLAudioElement, t: number, tolerance: number): void {
    const target = loopPosition(t, audio.duration);
    if (loopDrift(audio.currentTime, target, audio.duration) <= tolerance) return;
    try {
      audio.currentTime = target;
    } catch {
      // An element with nothing loaded may refuse to seek: the drift correction tries again on the next frame.
    }
  }

  private start(audio: HTMLAudioElement, t: number): void {
    // A file that has ended sits on its last instant, which the loop reads as "next to the start": move it for real.
    this.place(audio, t, audio.ended ? 0 : SEEK_TOLERANCE);
    // A file that is blocked or broken rejects; that is silence, not an error.
    void audio.play().catch(() => {
      if (this.audio === audio) this.blocked = true;
    });
  }
}
