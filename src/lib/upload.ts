// Direct browser-to-Cloudinary uploads of the user's own media: what is accepted, how asset ids are built and owned.
// Shared by the server actions (which sign and verify) and the browser (which pre-checks).
// Keep it free of secrets and of server-only or browser-only imports.
//
// Server-side switch, read in src/app/actions.ts: CLOUDINARY_DYNAMIC_FOLDERS=true also signs an `asset_folder`,
// for accounts in Cloudinary's "dynamic folder" mode (the default for accounts created after 2024-06-04). Default off:
// the slashes in the public id already give a folder tree in both modes, and `asset_folder` is rejected in fixed mode.

export type UploadKind = "audio" | "image" | "video";

export interface UploadKindSpec {
  /** Cloudinary resource type, which is also the endpoint of the upload URL. Audio is stored as "video". */
  resourceType: "image" | "video";
  /** Formats as Cloudinary detects them (it names a JPEG "jpg"). Signed as `allowed_formats`, checked again after the upload. */
  formats: readonly string[];
  maxBytes: number;
  /** What the interface calls this kind of file. */
  label: string;
}

// Decimal megabytes on purpose: whether Cloudinary counts in MB or MiB, a file under our cap is under theirs.
const MB = 1_000_000;

// Cloudinary's Free-plan caps (10 MB per image and 25 MP, 100 MB per video or audio file) are the real backstop,
// and no signed parameter can lower them: the sizes below are checked early for the user, and again after the upload.
export const UPLOAD_KINDS: Record<UploadKind, UploadKindSpec> = {
  audio: { resourceType: "video", formats: ["mp3", "m4a", "wav", "ogg", "opus", "aac", "flac"], maxBytes: 30 * MB, label: "Musique" },
  image: { resourceType: "image", formats: ["jpg", "png", "webp"], maxBytes: 10 * MB, label: "Image" },
  video: { resourceType: "video", formats: ["mp4", "mov", "webm"], maxBytes: 100 * MB, label: "Vidéo" },
};

/** How many times one issued upload may be checked: the first time, plus a retry or two when the hosting service hiccups. */
export const CONFIRM_ATTEMPTS = 3;

export const isUploadKind = (value: unknown): value is UploadKind =>
  typeof value === "string" && Object.hasOwn(UPLOAD_KINDS, value); // hasOwn: a forged "constructor" or "__proto__" must not pass

// ---------------------------------------------------------------------------
// Asset ids: neuro-studio/<kind>/<user>/<nonce>
// ---------------------------------------------------------------------------

/** The user id reduced to what is safe in a Cloudinary public id, a tag and a context value. Ids are UUIDs, so nothing is lost. */
export const userSlug = (userId: string): string => userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

const NONCE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The public id of an upload, with no extension and none of `& ? # \ % < > +` (Cloudinary forbids them, and `&` would
 * change how the signature is computed). Slashes give the folder tree in both folder modes.
 */
export function buildPublicId(kind: UploadKind, userId: string, nonce: string): string {
  const slug = userSlug(userId);
  if (!slug || !NONCE.test(nonce)) throw new Error("Invalid upload id parts");
  return `neuro-studio/${kind}/${slug}/${nonce}`;
}

/** Only a public id of this shape, for this user and this kind, can be confirmed by them (and only if it was really issued: see claimUploadCheck). */
export function ownsPublicId(publicId: unknown, kind: UploadKind, userId: string): boolean {
  const slug = userSlug(userId);
  if (typeof publicId !== "string" || !slug) return false;
  const prefix = `neuro-studio/${kind}/${slug}/`;
  return publicId.startsWith(prefix) && NONCE.test(publicId.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type UploadRequestError = "TYPE_INVALIDE" | "TAILLE_INVALIDE" | "FICHIER_TROP_VOLUMINEUX";

/** `input` comes straight from a public endpoint: anything can arrive. The size is the user's word, so this is only an early refusal. */
export function checkUploadRequest(
  input: unknown,
): { ok: true; kind: UploadKind; size: number } | { ok: false; error: UploadRequestError } {
  const { kind, size } = (typeof input === "object" && input !== null ? input : {}) as { kind?: unknown; size?: unknown };
  if (!isUploadKind(kind)) return { ok: false, error: "TYPE_INVALIDE" };
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, error: "TAILLE_INVALIDE" };
  if (size > UPLOAD_KINDS[kind].maxBytes) return { ok: false, error: "FICHIER_TROP_VOLUMINEUX" };
  return { ok: true, kind, size };
}

const FORMAT_ALIASES: Record<string, string> = { jpeg: "jpg", oga: "ogg" };

/** "Holiday.JPEG" -> "jpg". Cloudinary looks at the content: this is only the early, friendly refusal. */
export function fileFormat(fileName: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return extension && (FORMAT_ALIASES[extension] ?? extension);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Longest side of a photo after the browser shrinks it. */
const IMAGE_MAX_SIDE = 4096;
const IMAGE_MAX_PIXELS = 25_000_000;

export interface ImageResizePlan {
  /** Re-encode through a canvas at `width` x `height`; otherwise upload the file as it is. */
  resize: boolean;
  width: number;
  height: number;
}

/** Phone photos (12 to 200 MP, often over 10 MB) would hit the 10 MB and 25 MP caps: shrink those in the browser first. */
export function planImageResize(width: number, height: number, bytes: number): ImageResizePlan {
  if (bytes <= UPLOAD_KINDS.image.maxBytes && width * height <= IMAGE_MAX_PIXELS) return { resize: false, width, height };
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  return { resize: true, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ---------------------------------------------------------------------------
// Our own Cloudinary account
// ---------------------------------------------------------------------------

/**
 * The canonical form of an https delivery URL of OUR Cloudinary cloud, or undefined for anything else (other people's
 * clouds also live on res.cloudinary.com, under their own name). Forward the RETURNED string, never the input: parsers
 * disagree on `https://res.cloudinary.com\demo\@evil.io/a.png` (WHATWG reads host res.cloudinary.com, RFC 3986 parsers
 * such as curl or Python read evil.io), whereas the canonical form is read the same way everywhere.
 */
export function ownCloudinaryUrl(value: unknown, cloudName: string | undefined): string | undefined {
  // Backslashes, spaces and control characters are where parsers diverge (WHATWG also drops tabs and newlines silently).
  if (!cloudName || typeof value !== "string" || /[\s\\]|\p{Cc}/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.port !== "" || url.username !== "" || url.password !== "") {
      return undefined;
    }
    if (!url.pathname.startsWith(`/${cloudName}/`)) return undefined;
    // %2f and %5c survive URL parsing, but a server that decodes them would walk out of our cloud's folder.
    if (/\\|(^|\/)\.\.?(\/|$)/.test(decodeURIComponent(url.pathname))) return undefined;
    return url.href;
  } catch {
    return undefined; // not a URL, or a malformed %-escape
  }
}
