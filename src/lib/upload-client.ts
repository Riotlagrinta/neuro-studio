// Browser side of an upload of the user's own media: pre-check, shrink big photos, ask the server for a signature,
// POST the file straight to Cloudinary, then let the server read the asset back and confirm it.
// Browser-only (XMLHttpRequest, canvas, media elements), but importing this file touches no browser API.
//
// Everything the browser reports about the file (name, size, duration, the upload response) is untrusted and only
// used to help the user: the server signs what it decides, and confirmUpload re-reads the asset from Cloudinary.

import { confirmUpload, requestUploadSignature } from "@/app/actions";
import { explain } from "@/lib/errors";
import { checkUploadRequest, fileFormat, planImageResize, UPLOAD_KINDS, type ImageResizePlan, type UploadKind } from "@/lib/upload";

export interface UploadProgress {
  /** "preparing": checking the file, shrinking a photo. "uploading": `ratio` runs from 0 to 1. "processing": sent, Cloudinary and our check are still working. */
  phase: "preparing" | "uploading" | "processing";
  ratio: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting rejects with a DOMException named "AbortError". */
  signal?: AbortSignal;
}

export interface UploadedFile {
  /** https URL of the asset, checked by the server. */
  url: string;
  bytes: number;
  format: string;
  /** Seconds. Cloudinary's when it reports one, else read in the browser: display only. */
  duration?: number;
  width?: number;
  height?: number;
}

/** Every failure of an upload, with a message that can be shown as it is. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/** What Cloudinary answered to the POST (its JSON `error.message` is English, and the X-Cld-Error header is not readable from here). */
class CloudinaryRejection extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const UNREADABLE_IMAGE = "Cette image est illisible.";
const NETWORK_ERROR = "Connexion interrompue pendant l'envoi : vérifiez votre réseau et réessayez.";

const SERVER_MESSAGES: Record<string, string> = {
  TYPE_INVALIDE: "Ce type de fichier n'est pas pris en charge.",
  TAILLE_INVALIDE: "Ce fichier est vide ou illisible.",
  FICHIER_TROP_VOLUMINEUX: "Ce fichier est trop volumineux.",
  CLOUDINARY_NON_CONFIGURÉ: "L'hébergement des médias n'est pas configuré (variables CLOUDINARY_*).",
  UPLOAD_INTROUVABLE: "L'envoi n'a pas abouti : l'hébergeur ne trouve pas le fichier. Réessayez.",
  FICHIER_REFUSÉ: "Fichier refusé : son format ou son poids n'est pas autorisé.",
};
const serverMessage = (code: string) => SERVER_MESSAGES[code] ?? explain(code);

function rejectionMessage({ status, detail }: CloudinaryRejection): string {
  const reason = detail ? ` (${detail.slice(0, 120)})` : "";
  if (status === 413) return "Fichier trop volumineux pour l'hébergeur.";
  if (status === 400) return `Fichier refusé par l'hébergeur : format, contenu ou taille non pris en charge${reason}.`;
  if (status === 401) return `Autorisation d'envoi refusée : réessayez${reason}.`;
  return `Échec de l'envoi (erreur ${status})${reason}.`;
}

const abortError = () => new DOMException("Envoi annulé", "AbortError");
const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} Mo`;

function checkSize(kind: UploadKind, size: number) {
  const check = checkUploadRequest({ kind, size });
  if (check.ok) return;
  throw new UploadError(
    check.error === "FICHIER_TROP_VOLUMINEUX"
      ? `Fichier trop volumineux : ${megabytes(size)} (maximum ${megabytes(UPLOAD_KINDS[kind].maxBytes)}).`
      : serverMessage(check.error),
  );
}

// ---------------------------------------------------------------------------
// Photos: shrink them here rather than hit Cloudinary's 10 MB / 25 MP caps
// ---------------------------------------------------------------------------

function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve({ width: image.naturalWidth, height: image.naturalHeight });
      else reject(new UploadError(UNREADABLE_IMAGE));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UploadError(UNREADABLE_IMAGE));
    };
    image.src = url;
  });
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

async function shrinkImage(file: File, plan: ImageResizePlan): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError(UNREADABLE_IMAGE);
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (!context) throw new UploadError(UNREADABLE_IMAGE);
    context.imageSmoothingQuality = "high";
    const paint = (opaque: boolean) => {
      context.clearRect(0, 0, plan.width, plan.height);
      if (opaque) {
        context.fillStyle = "#fff"; // JPEG has no transparency: transparent pixels would turn black
        context.fillRect(0, 0, plan.width, plan.height);
      }
      context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    };

    let type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp"; // WebP keeps the transparency of a PNG
    for (const quality of [0.9, 0.8, 0.7]) {
      paint(type === "image/jpeg");
      let blob = await encode(canvas, type, quality);
      if (blob && blob.type !== type) {
        // The browser cannot encode WebP (Safari before 17) and quietly returned a PNG.
        type = "image/jpeg";
        paint(true);
        blob = await encode(canvas, type, quality);
      }
      if (blob && blob.size <= UPLOAD_KINDS.image.maxBytes) {
        return new File([blob], `${file.name.replace(/\.[^.]*$/, "")}.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new UploadError("Impossible de réduire cette image assez : choisissez-en une plus petite.");
}

async function prepareImage(file: File): Promise<File> {
  const { width, height } = await readImageSize(file);
  const plan = planImageResize(width, height, file.size);
  return plan.resize ? shrinkImage(file, plan) : file;
}

// ---------------------------------------------------------------------------
// Audio and video: the duration, for the interface only
// ---------------------------------------------------------------------------

/** Never rejects: a duration we cannot read is not a reason to refuse the file. */
function readDuration(file: Blob, kind: "audio" | "video"): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const media = document.createElement(kind);
      const url = URL.createObjectURL(file);
      const finish = (duration?: number) => {
        clearTimeout(timer);
        media.removeAttribute("src");
        URL.revokeObjectURL(url);
        resolve(duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined);
      };
      const timer = setTimeout(finish, 10_000);
      media.preload = "metadata";
      media.onloadedmetadata = () => finish(media.duration);
      media.onerror = () => finish();
      media.src = url;
    } catch {
      resolve(undefined);
    }
  });
}

// ---------------------------------------------------------------------------
// The upload itself
// ---------------------------------------------------------------------------

/** XMLHttpRequest, because fetch cannot report upload progress. */
function postToCloudinary(
  body: Blob,
  signed: { url: string; apiKey: string; fields: Record<string, string> },
  { onProgress, signal }: UploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());

    const form = new FormData();
    // Exactly the signed fields, with the same values: one more, or one changed, and the signature no longer matches.
    for (const [name, value] of Object.entries(signed.fields)) form.append(name, value);
    form.append("api_key", signed.apiKey);
    form.append("file", body);

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const end = (settle: () => void) => {
      signal?.removeEventListener("abort", abort);
      settle();
    };
    xhr.open("POST", signed.url);
    xhr.responseType = "json"; // null if the answer is not JSON
    // No Content-Type (the browser adds the multipart boundary) and no credentials: a plain "simple" CORS request.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.({ phase: "uploading", ratio: event.loaded / event.total });
    };
    xhr.upload.onload = () => onProgress?.({ phase: "processing", ratio: 1 });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return end(resolve);
      const message = (xhr.response as { error?: { message?: unknown } } | null)?.error?.message;
      end(() => reject(new CloudinaryRejection(xhr.status, typeof message === "string" ? message : "")));
    };
    xhr.onerror = () => end(() => reject(new UploadError(NETWORK_ERROR)));
    xhr.onabort = () => end(() => reject(abortError()));
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}

/** Signs and uploads; returns the public id the server issued. */
async function sendSigned(body: Blob, kind: UploadKind, options: UploadOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    checkAborted(options.signal);
    const signed = await requestUploadSignature({ kind, size: body.size });
    if (!signed.success) throw new UploadError(serverMessage(signed.error));
    try {
      await postToCloudinary(body, signed, options);
      return signed.fields.public_id;
    } catch (error) {
      // "Stale request": the signature expired before the upload began (one hour). Sign again, once.
      const stale = error instanceof CloudinaryRejection && error.status === 401 && /stale/i.test(error.detail);
      if (stale && attempt === 0) continue;
      throw error instanceof CloudinaryRejection ? new UploadError(rejectionMessage(error), error.status) : error;
    }
  }
}

/**
 * Uploads a file of the user's own to Cloudinary. A photo too big for the hosting limits is shrunk first.
 * Rejects with an UploadError (French message), or an AbortError DOMException when `signal` is aborted.
 */
export async function uploadFile(file: File, kind: UploadKind, options: UploadOptions = {}): Promise<UploadedFile> {
  const spec = UPLOAD_KINDS[kind];
  const format = fileFormat(file.name);
  if (!format || !spec.formats.includes(format)) {
    throw new UploadError(`Format non pris en charge${format ? ` (.${format})` : ""}. Formats acceptés : ${spec.formats.join(", ")}.`);
  }
  if (kind !== "image") checkSize(kind, file.size); // a photo may still shrink under the limit

  options.onProgress?.({ phase: "preparing", ratio: 0 });
  const body = kind === "image" ? await prepareImage(file) : file;
  checkSize(kind, body.size);
  const duration = kind === "image" ? undefined : readDuration(body, kind);

  const publicId = await sendSigned(body, kind, options);
  checkAborted(options.signal);
  const confirmed = await confirmUpload({ kind, publicId });
  if (!confirmed.success) throw new UploadError(serverMessage(confirmed.error));
  return {
    url: confirmed.url,
    bytes: confirmed.bytes,
    format: confirmed.format,
    duration: confirmed.duration ?? (await duration),
    width: confirmed.width,
    height: confirmed.height,
  };
}
