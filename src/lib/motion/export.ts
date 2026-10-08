"use client";

import { loadFonts, resolveFontStacks } from "./fonts";
import { renderFrame } from "./render";
import { MediaStage } from "./stage";
import { FRAMES, locate, projectDuration, sceneStart, type MotionProject } from "./types";

// Records the canvas + narration in real time with MediaRecorder (WebM).
// Real time means a 30 s video takes 30 s to export, and the tab must stay visible.

const OUTPUT_WIDTH = { "16:9": 1280, "9:16": 720 } as const;
const FPS = 30;

function pickMimeType(): string | undefined {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export async function exportProjectToWebm(
  project: MotionProject,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("Ce navigateur ne supporte pas l'enregistrement vidéo.");

  const total = projectDuration(project);
  const width = OUTPUT_WIDTH[project.ratio];
  const frame = FRAMES[project.ratio];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * frame.height) / frame.width);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");

  const fonts = resolveFontStacks();
  await loadFonts(fonts);

  const stage = new MediaStage(false);
  stage.sync(project);
  await stage.ready();

  const audioCtx = new AudioContext();
  await audioCtx.resume();
  const destination = audioCtx.createMediaStreamDestination();

  // Decode each scene's narration up front so playback can be scheduled sample-accurately.
  const narration = await Promise.all(
    project.scenes.map(async (scene) => {
      if (!scene.audioUrl) return null;
      try {
        const res = await fetch(scene.audioUrl);
        return await audioCtx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null; // export without this scene's voice rather than failing the whole video
      }
    }),
  );

  // Chrome stops emitting audio packets while nothing is playing, so a narration starting after a
  // silent gap would land at the wrong time. A muted source keeps the audio track continuous.
  const keepAlive = audioCtx.createConstantSource();
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  keepAlive.connect(mute).connect(destination);
  keepAlive.start();

  const stream = canvas.captureStream(FPS);
  destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  // The audio clock is the master clock, so narration and picture can't drift apart.
  const t0 = audioCtx.currentTime + 0.2;
  narration.forEach((buffer, i) => {
    if (!buffer) return;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.start(t0 + sceneStart(project, i));
  });

  recorder.start(250);
  let lastScene = -1;

  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) return reject(new DOMException("Export annulé", "AbortError"));
        const t = Math.min(total, Math.max(0, audioCtx.currentTime - t0));
        const { index, local } = locate(project, t);
        if (index !== lastScene) {
          stage.enter(project.scenes[index], local, true);
          lastScene = index;
        }
        renderFrame(ctx, project, t, (s) => stage.source(s), fonts);
        onProgress(t / total);
        if (t >= total) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    stage.dispose();
    stream.getTracks().forEach((track) => track.stop());
    await audioCtx.close();
  }

  await stopped;
  return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
}
