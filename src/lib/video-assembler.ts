import type { Scene, DialogueLine } from "./types";

export interface RenderOptions {
  scenes: Scene[];
  format: "16:9" | "9:16";
  burnSubtitles?: boolean;
  bgmUrl?: string | null;
  bgmVolume?: number; // 0 to 1
  onProgress?: (progress: number, currentSceneIndex: number) => void;
}

/**
 * Dessine des sous-titres stylisés type CapCut / TikTok au bas de l'écran.
 */
export function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dialogue?: DialogueLine,
  voiceOverText?: string
) {
  const text = dialogue?.text || voiceOverText;
  if (!text) return;

  const cleanText = text.replace(/["«»]/g, "").trim();
  if (!cleanText) return;

  ctx.save();

  // Positionnement vertical (tiers inférieur)
  const isPortrait = height > width;
  const bottomMargin = isPortrait ? height * 0.22 : height * 0.15;
  const centerY = height - bottomMargin;
  const fontSize = isPortrait ? Math.round(width * 0.055) : Math.round(height * 0.045);

  ctx.font = `900 ${fontSize}px "Inter", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Découpage automatique des lignes (word wrap)
  const maxWidth = width * 0.85;
  const words = cleanText.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.3;
  const totalBlockHeight = lines.length * lineHeight;
  const startY = centerY - (totalBlockHeight / 2) + (lineHeight / 2);

  // Rendu de chaque ligne avec contour noir épais et ombre portée
  lines.forEach((line, i) => {
    const y = startY + (i * lineHeight);

    // Pillule d'arrière-plan semi-transparente pour lisibilité maximale
    const lineWidth = ctx.measureText(line).width;
    const paddingX = fontSize * 0.6;
    const paddingY = fontSize * 0.3;

    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.beginPath();
    ctx.roundRect(
      (width / 2) - (lineWidth / 2) - paddingX,
      y - (lineHeight / 2) - paddingY + 2,
      lineWidth + (paddingX * 2),
      lineHeight + (paddingY * 2),
      12
    );
    ctx.fill();

    // Contour noir net
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.12));
    ctx.strokeStyle = "#000000";
    ctx.strokeText(line, width / 2, y);

    // Texte Jaune dynamique (style viral TikTok/CapCut)
    ctx.fillStyle = "#FDE047"; // amber-300 / yellow
    ctx.fillText(line, width / 2, y);
  });

  // Affichage discret du nom de l'orateur si présent
  if (dialogue?.speaker) {
    const speakerFontSize = Math.round(fontSize * 0.65);
    ctx.font = `800 ${speakerFontSize}px "Inter", sans-serif`;
    const speakerText = dialogue.speaker.toUpperCase();
    const speakerY = startY - (lineHeight / 2) - 18;

    const sWidth = ctx.measureText(speakerText).width;
    ctx.fillStyle = "rgba(79, 70, 229, 0.9)"; // Indigo pill
    ctx.beginPath();
    ctx.roundRect(
      (width / 2) - (sWidth / 2) - 10,
      speakerY - (speakerFontSize / 2) - 4,
      sWidth + 20,
      speakerFontSize + 8,
      6
    );
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(speakerText, width / 2, speakerY);
  }

  ctx.restore();
}

/**
 * Moteur de rendu côté client : assemble toutes les scènes vidéo en un seul fichier MP4/WebM.
 */
export async function renderMontageSequence(
  options: RenderOptions,
  abortSignal?: AbortSignal
): Promise<Blob> {
  const { scenes, format, burnSubtitles = true, onProgress } = options;

  if (!scenes || scenes.length === 0) {
    throw new Error("Aucune scène à monter.");
  }

  const validScenes = scenes.filter((s) => Boolean(s.videoUrl));
  if (validScenes.length === 0) {
    throw new Error("Aucun clip vidéo n'a été importé. Glissez au moins une vidéo de scène.");
  }

  const isPortrait = format === "9:16";
  const width = isPortrait ? 720 : 1280;
  const height = isPortrait ? 1280 : 720;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Impossible d'initialiser le contexte Canvas 2D");

  // Détection du mime type vidéo optimal supporté par le navigateur
  const mimeTypes = [
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4',
    'video/webm; codecs=h264',
    'video/webm; codecs=vp9',
    'video/webm'
  ];
  const chosenMime = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";

  const stream = canvas.captureStream(30); // 30 FPS
  const recorder = new MediaRecorder(stream, {
    mimeType: chosenMime,
    videoBitsPerSecond: 4_500_000 // 4.5 Mbps haute qualité
  });

  const recordedChunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  recorder.start(100);

  const totalScenes = validScenes.length;

  for (let i = 0; i < totalScenes; i++) {
    if (abortSignal?.aborted) {
      recorder.stop();
      throw new Error("Rendu annulé par l'utilisateur.");
    }

    const scene = validScenes[i];
    onProgress?.((i / totalScenes) * 100, i);

    await playAndRecordScene(scene, ctx, width, height, burnSubtitles, abortSignal);
  }

  onProgress?.(100, totalScenes - 1);

  return new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      const finalBlob = new Blob(recordedChunks, { type: chosenMime });
      resolve(finalBlob);
    };
    recorder.stop();
  });
}

/**
 * Lit un clip vidéo de scène sur le canvas frame par frame.
 */
function playAndRecordScene(
  scene: Scene,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  burnSubtitles: boolean,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.src = scene.videoUrl!;
    video.crossOrigin = "anonymous";
    video.muted = true; // Pas de feedback sonore pendant l'enregistrement
    video.playsInline = true;

    const trimStart = scene.trimStart || 0;
    const trimEnd = scene.trimEnd || 0;

    let animId: number;

    const cleanup = () => {
      cancelAnimationFrame(animId);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      video.currentTime = trimStart;
    };

    video.onseeked = () => {
      video.play().catch((err) => {
        cleanup();
        reject(err);
      });
    };

    const drawFrame = () => {
      if (abortSignal?.aborted) {
        cleanup();
        reject(new Error("Annulé"));
        return;
      }

      const effectiveDuration = video.duration - trimEnd;
      if (video.currentTime >= effectiveDuration || video.ended) {
        cleanup();
        resolve();
        return;
      }

      // Remplir fond noir
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      // Adapter la vidéo avec ratio "contain" ou "cover"
      const vRatio = video.videoWidth / video.videoHeight;
      const cRatio = width / height;

      let drawW = width;
      let drawH = height;
      let drawX = 0;
      let drawY = 0;

      if (vRatio > cRatio) {
        // Vidéo plus large : bandes en haut/bas ou recadrage
        drawW = height * vRatio;
        drawX = (width - drawW) / 2;
      } else {
        drawH = width / vRatio;
        drawY = (height - drawH) / 2;
      }

      ctx.drawImage(video, drawX, drawY, drawW, drawH);

      // Superposition des sous-titres
      if (burnSubtitles) {
        const dialogue = scene.dialogues?.[0];
        drawSubtitles(ctx, width, height, dialogue, scene.voiceOver);
      }

      animId = requestAnimationFrame(drawFrame);
    };

    video.onplay = () => {
      animId = requestAnimationFrame(drawFrame);
    };

    video.onerror = () => {
      cleanup();
      // Si le clip échoue, passer à la scène suivante après un bref écran noir
      resolve();
    };
  });
}
