// Pure helpers behind the music panel and the "import a file" buttons: what a picked file is checked against, how the
// fade sliders are bounded, what a new track starts with. No DOM, no network: the sizes and formats come from upload.ts.

import { checkUploadRequest, fileFormat, UPLOAD_KINDS, type UploadKind } from "../upload";
import { clock } from "./timecode";
import type { Music } from "./types";

/** Longest fade the sliders offer (sanitize.ts accepts up to 20 s from a stored project). */
export const MAX_FADE = 10;
const MUSIC_NAME_MAX = 120;

export type FadeKey = "fadeIn" | "fadeOut";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** NaN, Infinity and negatives mean "no usable length". */
const seconds = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
const roundTenth = (v: number) => Math.round(v * 10) / 10;
// The epsilon: 6.3 - 2.1 is 4.199999999999999, and its tenth is 4.2, not 4.1.
const floorTenth = (v: number) => Math.floor(v * 10 + 1e-9) / 10;

// ---------------------------------------------------------------------------
// Fades and volume
// ---------------------------------------------------------------------------

/** The video's length in whole tenths: what both fades together may not exceed. */
const fadeRoom = (total: number): number => floorTenth(seconds(total));

const otherFade = (key: FadeKey): FadeKey => (key === "fadeIn" ? "fadeOut" : "fadeIn");

/** The other fade as the sliders keep it: at most MAX_FADE, and short enough to fit the video on its own. */
const restOf = (music: Pick<Music, FadeKey>, key: FadeKey, total: number): number =>
  Math.min(seconds(music[otherFade(key)]), MAX_FADE, fadeRoom(total));

/** The longest `key` can be: the other fade keeps its length, so fadeIn + fadeOut <= total, and neither passes MAX_FADE. */
export function fadeMax(music: Pick<Music, FadeKey>, key: FadeKey, total: number): number {
  return clamp(floorTenth(fadeRoom(total) - restOf(music, key, total)), 0, MAX_FADE);
}

/** What the slider shows: the stored fade, held inside its bounds (a video shortened since the fade was set). */
export function fadeValue(music: Pick<Music, FadeKey>, key: FadeKey, total: number): number {
  return Math.min(seconds(music[key]), fadeMax(music, key, total));
}

/** Sets one fade to the nearest tenth within its bounds. The other fade only changes if it alone was longer than the bounds allow. */
export function setFade(music: Music, key: FadeKey, value: number, total: number): Music {
  const rest = restOf(music, key, total);
  const next = clamp(roundTenth(seconds(value)), 0, fadeMax(music, key, total));
  return key === "fadeIn" ? { ...music, fadeIn: next, fadeOut: rest } : { ...music, fadeOut: next, fadeIn: rest };
}

export const volumePercent = (volume: number): number => Math.round(clamp(Number.isFinite(volume) ? volume : 0, 0, 1) * 100);
export const volumeFromPercent = (percent: number): number => clamp(Math.round(Number.isFinite(percent) ? percent : 0), 0, 100) / 100;

/** "1,5 s" */
export const formatSeconds = (value: number): string => `${seconds(value).toFixed(1).replace(".", ",")} s`;

// ---------------------------------------------------------------------------
// A new track
// ---------------------------------------------------------------------------

/**
 * "Holiday – take 2.final.mp3" -> "Holiday – take 2.final". At most 120 characters (what sanitize.ts keeps), never
 * ending on half an emoji (a lone surrogate would make the stored JSON unreadable for the database).
 */
export function musicNameFromFile(fileName: string): string {
  let name = fileName.replace(/\.[^.]*$/, "").replace(/\p{Cc}/gu, " ").trim().slice(0, MUSIC_NAME_MAX);
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  return name.trim() || "Musique";
}

/** A freshly uploaded track: fades of 1 s and 2 s, shortened when the video is too short to hold both. */
export function newMusic(url: string, fileName: string, total: number): Music {
  const room = fadeRoom(total);
  const fadeIn = Math.min(1, room);
  return { url, name: musicNameFromFile(fileName), volume: 0.6, fadeIn, fadeOut: Math.min(2, roundTenth(room - fadeIn)), duck: true };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Wider than the extensions on purpose: phones filter the picker by type, not by name.
const MIME_TYPES: Record<UploadKind, string> = {
  audio: "audio/*",
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime,video/webm",
};

/** The `accept` attribute of a file input for this kind: the formats upload.ts allows, by extension and by type. */
export function acceptFor(kind: UploadKind): string {
  return [...UPLOAD_KINDS[kind].formats.map((format) => `.${format}`), MIME_TYPES[kind]].join(",");
}

/** "MP3, M4A, WAV" */
export const formatsLabel = (kind: UploadKind): string => UPLOAD_KINDS[kind].formats.map((format) => format.toUpperCase()).join(", ");

/** "3,4 Mo" (decimal megabytes, like the limits), "820 Ko" below a megabyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 999_500) return `${Math.max(1, Math.round(bytes / 1000))} Ko`;
  return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} Mo`;
}

/** The biggest file of this kind, for a sentence: "30 Mo". */
export const limitLabel = (kind: UploadKind): string => formatBytes(UPLOAD_KINDS[kind].maxBytes);

/**
 * Why a file the user picked cannot be uploaded, in French, or null when it can. The same refusals as uploadFile (which
 * checks again), given before anything is sent. A photo is never refused for its weight: uploadFile shrinks big ones.
 */
export function checkPickedFile(file: { name: string; size: number }, kind: UploadKind): string | null {
  const spec = UPLOAD_KINDS[kind];
  const format = fileFormat(file.name);
  if (!format || !spec.formats.includes(format)) {
    return `Format non pris en charge${format ? ` (.${format})` : ""}. Formats acceptés : ${spec.formats.join(", ")}.`;
  }
  const check = checkUploadRequest({ kind, size: file.size });
  if (check.ok) return null;
  if (check.error === "FICHIER_TROP_VOLUMINEUX") {
    return kind === "image" ? null : `Fichier trop volumineux : ${formatBytes(file.size)} (maximum ${limitLabel(kind)}).`;
  }
  return check.error === "TAILLE_INVALIDE" ? "Ce fichier est vide ou illisible." : "Ce type de fichier n'est pas pris en charge.";
}

/** "3,4 Mo · 2:05", with whatever is known. */
export function fileSummary(bytes: number | undefined, duration: number | undefined): string {
  const parts: string[] = [];
  if (bytes !== undefined && Number.isFinite(bytes) && bytes > 0) parts.push(formatBytes(bytes));
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) parts.push(clock(duration));
  return parts.join(" · ");
}

/** The file is known to be shorter than the video (a few frames do not count), so the music loops. An unknown length says nothing. */
export function loopsToEnd(duration: number | undefined, total: number): boolean {
  return duration !== undefined && Number.isFinite(duration) && duration > 0 && Number.isFinite(total) && duration < total - 0.1;
}
