"use server";

// Every exported function here is a public endpoint: anyone can call it directly, not just our UI.
// So each one checks who is calling (src/lib/access.ts) before spending money or touching data.

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { signIn, signOut } from "@/auth";
import cloudinary from "@/lib/cloudinary";
import { claudeConfig, getAnthropic, type ClaudeTask } from "@/lib/anthropic-client";
import { allowedEmail, authConfigured } from "@/lib/allowlist";
import { authorize, claimUploadCheck, getBalance, getSessionUser, ownsVideoJob, refund, refundByRef, requireUser, tagEvent } from "@/lib/access";
import { billingEnabled, billingMarkup } from "@/lib/billing";
import type { BillingInfo } from "@/lib/billing-types";
import { defaultVideoQuality, maxVideoSeconds, motionCost, refineCost, VOICE_RATES, voiceCost } from "@/lib/pricing";
import { replicate } from "@/lib/replicate-client";
import { buildPublicId, checkUploadRequest, isUploadKind, ownCloudinaryUrl, ownsPublicId, UPLOAD_KINDS, userSlug, type UploadKind } from "@/lib/upload";
import { listVoiceProviders, synthesize, type VoiceProviderId, type VoiceProviderInfo } from "@/lib/voice-providers";
import { getVideoModel, videoCost, videoInput, VIDEO_MODELS, VIDEO_QUALITIES, type VideoQuality } from "@/lib/video-models";
import { projectRequest, sceneRequest, STYLES, systemPrompt, type StyleId } from "@/lib/motion/prompt";
import { extractJson, normalizeProject, normalizeScene } from "@/lib/motion/sanitize";
import type { AspectRatio, MotionProject, MotionScene } from "@/lib/motion/types";

const RATIOS: AspectRatio[] = ["16:9", "9:16"];
const MAX_VOICE_CHARS = 1500;
const MAX_PROJECT_BYTES = 1_500_000;
const MAX_PROJECTS_PER_USER = 200;

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutUser() {
  await signOut({ redirectTo: "/" });
}

// ---------------------------------------------------------------------------
// Motion design (Claude: Opus for a whole video, Sonnet for a scene retouch — see anthropic-client.ts)
// ---------------------------------------------------------------------------

async function askClaude(task: ClaudeTask, system: string, user: string): Promise<{ text: string } | { error: string }> {
  const client = getAnthropic();
  if (!client) return { error: "CLÉ_ANTHROPIC_MANQUANTE" };
  const { model, effort } = claudeConfig(task);
  try {
    // Streaming: a full motion spec is a long output, and Opus may think before writing it.
    const message = await client.beta.messages
      .stream({
        model,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if a safety classifier declines, Anthropic re-runs the request on a fallback model
        system,
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();

    if (message.stop_reason === "refusal") return { error: "REFUS_IA" };
    if (message.stop_reason === "max_tokens") return { error: "RÉPONSE_TROP_LONGUE" };
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return text ? { text } : { error: "IA_VIDE" };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { error: "CLÉ_ANTHROPIC_INVALIDE" };
    if (error instanceof Anthropic.RateLimitError) return { error: "ANTHROPIC_LIMITE_ATTEINTE" };
    if (error instanceof Anthropic.APIError) return { error: `ANTHROPIC_${error.status ?? "ERREUR"}` };
    return { error: errorMessage(error, "ECHEC_GEN") };
  }
}

export interface GenerateInput {
  topic: string;
  style: StyleId;
  targetSeconds: number;
  ratio: AspectRatio;
  useMedia: boolean;
}

export async function generateMotionProject(input: GenerateInput) {
  const topic = typeof input.topic === "string" ? input.topic.trim().slice(0, 1500) : "";
  if (topic.length < 3) return { success: false as const, error: "SUJET_TROP_COURT" };
  const ratio = RATIOS.includes(input.ratio) ? input.ratio : "16:9";
  const style = STYLES.some((s) => s.id === input.style) ? input.style : "kinetic";
  const targetSeconds = Math.min(maxVideoSeconds(), Math.max(10, Math.round(Number(input.targetSeconds) || 30)));

  const access = await authorize("motion", motionCost(targetSeconds, claudeConfig("generate").model));
  if (!access.ok) return { success: false as const, error: access.error };

  const reply = await askClaude("generate", systemPrompt(ratio, !!input.useMedia), projectRequest({ topic, style, targetSeconds, ratio }));
  if ("error" in reply) {
    await refund(access.eventId);
    return { success: false as const, error: reply.error };
  }

  try {
    const project = normalizeProject(extractJson(reply.text), ratio, false);
    if (!project) throw new Error("empty");
    return { success: true as const, data: clean({ ...project, ratio }) };
  } catch {
    await refund(access.eventId); // the user gets nothing usable, so nothing is charged
    return { success: false as const, error: "RÉPONSE_INVALIDE" };
  }
}

export interface RefineInput {
  title: string;
  palette: string[];
  ratio: AspectRatio;
  index: number;
  total: number;
  scene: MotionScene;
  instruction: string;
}

export async function refineMotionScene(input: RefineInput) {
  const instruction = typeof input.instruction === "string" ? input.instruction.trim().slice(0, 600) : "";
  if (!instruction) return { success: false as const, error: "INSTRUCTION_VIDE" };
  const ratio = RATIOS.includes(input.ratio) ? input.ratio : "16:9";
  const index = Number.isInteger(input.index) ? input.index : 0;

  const access = await authorize("refine", refineCost(claudeConfig("refine").model));
  if (!access.ok) return { success: false as const, error: access.error };

  const current = normalizeScene(input.scene, index, ratio, true);
  // Generated asset URLs mean nothing to the model; undefined fields are dropped by JSON.stringify.
  const forModel = { ...current, imageUrl: undefined, videoUrl: undefined, audioUrl: undefined };

  const reply = await askClaude(
    "refine",
    systemPrompt(ratio, current.layers.some((l) => l.type === "media")),
    sceneRequest({
      title: String(input.title).slice(0, 120),
      palette: Array.isArray(input.palette) ? input.palette.slice(0, 8).map(String) : [],
      index,
      total: Math.max(1, Number(input.total) || 1),
      scene: forModel,
      instruction,
    }),
  );
  if ("error" in reply) {
    await refund(access.eventId);
    return { success: false as const, error: reply.error };
  }

  try {
    const revised = normalizeScene(extractJson(reply.text), index, ratio, false);
    // Keep the assets that are still valid for the revised scene. Narration audio only stays if
    // the text is unchanged — and then so does the duration, which was fitted to that audio.
    const sameVoice = revised.voiceOver === current.voiceOver;
    const scene: MotionScene = {
      ...revised,
      uid: current.uid, // a retouch is still the same scene
      duration: sameVoice && current.audioUrl ? current.duration : revised.duration,
      imageUrl: current.imageUrl,
      videoUrl: current.videoUrl,
      audioUrl: sameVoice ? current.audioUrl : undefined,
      audioOffset: sameVoice ? current.audioOffset : undefined,
      mediaOffset: current.videoUrl ? current.mediaOffset : undefined,
    };
    return { success: true as const, data: clean(scene) };
  } catch {
    await refund(access.eventId);
    return { success: false as const, error: "RÉPONSE_INVALIDE" };
  }
}

// ---------------------------------------------------------------------------
// Capabilities (public by design: it only says what the UI may offer this visitor)
// ---------------------------------------------------------------------------

export interface StudioCapabilities {
  auth: {
    configured: boolean;
    user: { name?: string | null; email: string; image?: string | null } | null;
    /** Signed in and invited: may use the paid features. */
    allowed: boolean;
  };
  motion: boolean;
  voices: VoiceProviderInfo[];
  videoAvailable: boolean;
  videoModels: { id: string; label: string; needsImage: boolean }[];
  videoDefaultQuality: VideoQuality;
  maxVideoSeconds: number;
  quota: { remaining: number; total: number } | null;
  billing: BillingInfo;
}

export async function getStudioCapabilities(): Promise<StudioCapabilities> {
  const user = await getSessionUser();
  const allowed = !!user && allowedEmail(user.email);
  return {
    auth: {
      configured: authConfigured(),
      user: user ? { name: user.name, email: user.email, image: user.image } : null,
      allowed,
    },
    motion: !!process.env.ANTHROPIC_API_KEY?.trim(),
    // Third-party lookups (voice list, quota) only for people allowed to use them.
    voices: await listVoiceProviders({ live: allowed }),
    videoAvailable: !!process.env.REPLICATE_API_TOKEN?.trim(),
    videoModels: VIDEO_MODELS.map(({ id, label, needsImage }) => ({ id, label, needsImage })),
    videoDefaultQuality: defaultVideoQuality(),
    maxVideoSeconds: maxVideoSeconds(),
    quota: allowed ? await elevenLabsQuota() : null,
    billing: {
      enabled: billingEnabled(),
      balance: allowed && user && billingEnabled() ? ((await getBalance(user.id)) ?? 0) : 0,
      markup: billingEnabled() ? billingMarkup() : 1,
    },
  };
}

async function elevenLabsQuota() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return null;
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey } });
    const data = await response.json();
    return { remaining: data.character_limit - data.character_count, total: data.character_limit };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Media: image, voice, video
// ---------------------------------------------------------------------------

export async function generateImage(prompt: string, ratio: AspectRatio = "16:9") {
  const text = typeof prompt === "string" ? prompt.trim().slice(0, 150) : "";
  if (text.length < 3) return { success: false as const, error: "PROMPT_VIDE" };

  const access = await authorize("image", 0); // free provider, but counted: hosting isn't free
  if (!access.ok) return { success: false as const, error: access.error };
  try {
    const [width, height] = ratio === "9:16" ? [720, 1280] : [1280, 720];
    const source = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?nologo=true&width=${width}&height=${height}&seed=${Math.floor(Math.random() * 100000)}`;
    // Re-hosted on Cloudinary: a stable URL we control, with CORS headers so the canvas stays exportable.
    const uploaded = await cloudinary.uploader.upload(source, { folder: "neuro-studio-images" });
    return { success: true as const, url: uploaded.secure_url as string };
  } catch {
    await refund(access.eventId);
    return { success: false as const, error: "ECHEC_IMAGE" };
  }
}

export async function synthesizeVoice(text: string, provider: VoiceProviderId, voiceId: string) {
  const input = typeof text === "string" ? text.trim().slice(0, MAX_VOICE_CHARS) : "";
  if (!input) return { success: false as const, error: "TEXTE_VIDE" };
  const rate = VOICE_RATES[provider];
  if (rate === undefined) return { success: false as const, error: "FOURNISSEUR_INCONNU" };

  const access = await authorize("voice", voiceCost(input.length, rate));
  if (!access.ok) return { success: false as const, error: access.error };
  try {
    const speech = await synthesize(provider, input, String(voiceId));
    if (!speech.ok) {
      await refund(access.eventId);
      return { success: false as const, error: speech.error };
    }
    const base64 = Buffer.from(speech.audio).toString("base64");
    const uploaded = await cloudinary.uploader.upload(`data:audio/mpeg;base64,${base64}`, {
      resource_type: "video", // Cloudinary stores audio under the "video" resource type
      folder: "neuro-studio-audios",
    });
    return {
      success: true as const,
      url: uploaded.secure_url as string,
      duration: typeof uploaded.duration === "number" ? (uploaded.duration as number) : undefined,
    };
  } catch (error) {
    await refund(access.eventId);
    return { success: false as const, error: errorMessage(error, "ECHEC_AUDIO") };
  }
}

// Video generation takes from tens of seconds to minutes, which is longer than a request should
// stay open: start a Replicate prediction, then let the client poll checkVideoJob.

export interface VideoJobInput {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  ratio: AspectRatio;
  duration: number;
  quality?: VideoQuality;
}

export async function startVideoJob(input: VideoJobInput) {
  if (!process.env.REPLICATE_API_TOKEN?.trim()) return { success: false as const, error: "CLÉ_REPLICATE_MANQUANTE" };
  const model = getVideoModel(input.modelId);
  if (!model) return { success: false as const, error: "MODELE_INCONNU" };

  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 500) : "";
  if (!prompt) return { success: false as const, error: "PROMPT_VIDE" };
  // Replicate fetches this URL, so only accept assets of our own Cloudinary cloud (others are served from the same host),
  // and forward the canonical form: the raw string can mean a different host to the fetcher than it does to us.
  const imageUrl = ownCloudinaryUrl(input.imageUrl, cloudinary.config().cloud_name);
  if (model.needsImage && !imageUrl) return { success: false as const, error: "IMAGE_REQUISE" };

  const request = {
    prompt,
    imageUrl,
    ratio: RATIOS.includes(input.ratio) ? input.ratio : ("16:9" as AspectRatio),
    duration: Math.min(12, Math.max(1, Number(input.duration) || 5)),
    quality: input.quality && VIDEO_QUALITIES.includes(input.quality) ? input.quality : defaultVideoQuality(),
  };

  const access = await authorize("video", videoCost(model, request));
  if (!access.ok) return { success: false as const, error: access.error };
  try {
    const prediction = await replicate.predictions.create({ model: model.slug, input: videoInput(model, request) });
    await tagEvent(access.eventId, prediction.id); // so only this user can poll (and collect) this job
    return { success: true as const, id: prediction.id };
  } catch (error) {
    await refund(access.eventId);
    return { success: false as const, error: errorMessage(error, "ECHEC_VIDEO") };
  }
}

export type VideoJobStatus =
  | { success: true; status: "processing" }
  | { success: true; status: "succeeded"; url: string }
  | { success: false; error: string };

export async function checkVideoJob(id: string): Promise<VideoJobStatus> {
  const who = await requireUser();
  if (!who.ok) return { success: false, error: who.error };
  if (typeof id !== "string" || !/^[a-z0-9]{8,40}$/i.test(id) || !(await ownsVideoJob(who.user.id, id))) {
    return { success: false, error: "JOB_INVALIDE" };
  }
  try {
    const prediction = await replicate.predictions.get(id);

    if (prediction.status === "failed" || prediction.status === "canceled") {
      await refundByRef(who.user.id, id);
      return { success: false, error: typeof prediction.error === "string" && prediction.error ? prediction.error : "VIDEO_ECHEC" };
    }
    if (prediction.status !== "succeeded") return { success: true, status: "processing" };

    const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (typeof output !== "string") return { success: false, error: "SORTIE_VIDEO_INVALIDE" };

    // Replicate output URLs expire after an hour; keep a durable copy.
    const uploaded = await cloudinary.uploader.upload(output, { resource_type: "video", folder: "neuro-studio-videos" });
    return { success: true, status: "succeeded", url: uploaded.secure_url as string };
  } catch (error) {
    return { success: false, error: errorMessage(error, "ECHEC_VIDEO") };
  }
}

// ---------------------------------------------------------------------------
// Uploads: the user's own music, images and videos go from the browser straight to Cloudinary.
// The file never passes through Next. The server decides every signed parameter, then checks the result.
// ---------------------------------------------------------------------------

export type UploadSignature =
  | {
      success: true;
      url: string;
      /** Public, unsigned: the browser sends it as the `api_key` field. */
      apiKey: string;
      /** The signed multipart fields, to append verbatim (an extra or altered one fails the signature), then `api_key`, then `file`. */
      fields: Record<string, string>;
    }
  | { success: false; error: string };

export async function requestUploadSignature(input: { kind: UploadKind; size: number }): Promise<UploadSignature> {
  const who = await requireUser();
  if (!who.ok) return { success: false, error: who.error };
  const request = checkUploadRequest(input); // the client sends nothing else: it never chooses what gets signed
  if (!request.ok) return { success: false, error: request.error };

  const { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret } = cloudinary.config();
  if (!cloudName || !apiKey || !apiSecret) return { success: false, error: "CLOUDINARY_NON_CONFIGURÉ" };

  // The id is recorded with the reservation: confirmUpload only checks ids that were really issued, a limited number of times.
  const publicId = buildPublicId(request.kind, who.user.id, randomUUID()); // unique: one signature creates at most one asset
  const access = await authorize("upload", 0, publicId); // counted per user, but it never eats the dollar cap
  if (!access.ok) return { success: false, error: access.error };
  try {
    const spec = UPLOAD_KINDS[request.kind];
    const slug = userSlug(access.user.id);
    // Never add file, cloud_name, resource_type or api_key here: they are not signed, and the SDK would hash them.
    // Keep `&` out of every value (see buildPublicId).
    const toSign: Record<string, string> = {
      allowed_formats: spec.formats.join(","),
      context: `uid=${slug}|kind=${request.kind}`,
      overwrite: "0", // a replayed signature cannot replace a file that was already verified. "0" is what the Cloudinary SDK itself sends
      public_id: publicId,
      tags: `neuro-studio,${request.kind},user-${slug}`,
      timestamp: String(Math.round(Date.now() / 1000)), // seconds; a signature is valid for one hour
      type: "upload",
    };
    if (process.env.CLOUDINARY_DYNAMIC_FOLDERS === "true") toSign.asset_folder = `neuro-studio/${request.kind}/${slug}`;

    return {
      success: true,
      url: cloudinary.utils.api_url("upload", { resource_type: spec.resourceType }),
      apiKey,
      fields: { ...toSign, signature: cloudinary.utils.api_sign_request(toSign, apiSecret) },
    };
  } catch (error) {
    console.error("requestUploadSignature failed:", errorMessage(error, "unknown"));
    await refund(access.eventId);
    return { success: false, error: "SERVICE_INDISPONIBLE" };
  }
}

export type UploadConfirmation =
  | { success: true; url: string; bytes: number; format: string; duration?: number; width?: number; height?: number }
  | { success: false; error: string };

const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

/** HTTP status of a Cloudinary SDK rejection. Log this, never the rejection itself: it carries the API credentials of the request. */
function cloudinaryStatus(error: unknown): number | undefined {
  const body = typeof error === "object" && error !== null && "error" in error ? error.error : error;
  const code = typeof body === "object" && body !== null && "http_code" in body ? body.http_code : undefined;
  return typeof code === "number" ? code : undefined;
}

export async function confirmUpload(input: { kind: UploadKind; publicId: string }): Promise<UploadConfirmation> {
  const who = await requireUser();
  if (!who.ok) return { success: false, error: who.error };
  const kind = input?.kind;
  if (!isUploadKind(kind)) return { success: false, error: "TYPE_INVALIDE" };
  // Someone else's asset looks exactly like a missing one, and so does an id we never issued: neither costs a Cloudinary call.
  if (!ownsPublicId(input.publicId, kind, who.user.id)) return { success: false, error: "UPLOAD_INTROUVABLE" };
  const claim = await claimUploadCheck(who.user.id, input.publicId);
  if (claim !== "granted") return { success: false, error: claim === "refused" ? "UPLOAD_INTROUVABLE" : "SERVICE_INDISPONIBLE" };

  const spec = UPLOAD_KINDS[kind];
  let asset: Record<string, unknown>;
  try {
    // The browser's own report of the upload is untrusted: read the asset back from Cloudinary. resource_type is the one
    // thing the signature cannot pin, so looking it up under the expected type also rejects an upload sent to another endpoint.
    const found: unknown = await cloudinary.api.resource(input.publicId, { resource_type: spec.resourceType, media_metadata: true });
    asset = typeof found === "object" && found !== null ? (found as Record<string, unknown>) : {};
  } catch (error) {
    const status = cloudinaryStatus(error);
    if (status === 404) return { success: false, error: "UPLOAD_INTROUVABLE" };
    console.error("confirmUpload failed:", status ?? errorMessage(error, "unknown"));
    return { success: false, error: "SERVICE_INDISPONIBLE" };
  }

  const bytes = positive(asset.bytes);
  const format = typeof asset.format === "string" ? asset.format.toLowerCase() : "";
  const url = typeof asset.secure_url === "string" ? asset.secure_url : "";
  const accepted =
    bytes !== undefined && bytes <= spec.maxBytes && spec.formats.includes(format) && asset.resource_type === spec.resourceType && url.startsWith("https://");
  if (!accepted) {
    // Cloudinary only enforces its own plan caps (and allowed_formats): everything stricter is enforced here, after the fact.
    await cloudinary.uploader
      .destroy(input.publicId, { resource_type: spec.resourceType, invalidate: true })
      .catch((error: unknown) => console.error("confirmUpload cleanup failed:", cloudinaryStatus(error) ?? errorMessage(error, "unknown")));
    return { success: false, error: "FICHIER_REFUSÉ" };
  }
  return { success: true, url, bytes, format, duration: positive(asset.duration), width: positive(asset.width), height: positive(asset.height) };
}

// ---------------------------------------------------------------------------
// Persistence (Neon). Each project belongs to one user and is private to them.
// ---------------------------------------------------------------------------

export async function saveProject(topic: string, project: MotionProject) {
  const who = await requireUser();
  if (!who.ok) return { success: false as const, error: who.error };
  try {
    const plan = normalizeProject(project, project?.ratio ?? "16:9", true);
    if (!plan) return { success: false as const, error: "PROJET_INVALIDE" };
    const json = JSON.stringify(plan);
    if (json.length > MAX_PROJECT_BYTES) return { success: false as const, error: "PROJET_TROP_GROS" };

    const { sql } = await import("@/lib/db");
    const count = await sql`SELECT COUNT(*)::int AS n FROM projects WHERE user_id = ${who.user.id}::uuid`;
    if (Number(count[0].n) >= MAX_PROJECTS_PER_USER) return { success: false as const, error: "TROP_DE_PROJETS" };

    const results = await sql`
      INSERT INTO projects (title, category, plan, topic, user_id)
      VALUES (${plan.title}, ${plan.category}, ${json}, ${String(topic).slice(0, 1500)}, ${who.user.id}::uuid)
      RETURNING id
    `;
    if (!results || results.length === 0) return { success: false as const, error: "ECHEC_INSERTION_NEON" };
    return { success: true as const, id: Number(results[0].id) };
  } catch (error) {
    console.error("saveProject failed:", error);
    return { success: false as const, error: "SERVICE_INDISPONIBLE" };
  }
}

export async function getProjects() {
  const who = await requireUser();
  if (!who.ok) return { success: false as const, error: who.error };
  try {
    const { sql } = await import("@/lib/db");
    const rows = await sql`
      SELECT id, title, category, topic, plan, created_at FROM projects
      WHERE user_id = ${who.user.id}::uuid ORDER BY created_at DESC LIMIT 100
    `;
    return { success: true as const, projects: clean(rows) };
  } catch (error) {
    console.error("getProjects failed:", error);
    return { success: false as const, error: "SERVICE_INDISPONIBLE" };
  }
}

export async function getProject(id: number) {
  const who = await requireUser();
  if (!who.ok) return { success: false as const, error: who.error };
  if (!Number.isInteger(id)) return { success: false as const, error: "ID_INVALIDE" };
  try {
    const { sql } = await import("@/lib/db");
    // Scoped to the owner: someone else's id looks exactly like a missing one.
    const rows = await sql`SELECT * FROM projects WHERE id = ${id} AND user_id = ${who.user.id}::uuid LIMIT 1`;
    if (!rows || rows.length === 0) return { success: false as const, error: "PROJET_INTROUVABLE" };
    const row = rows[0];
    // Older rows are "biopic" plans without motion layers; normalizeProject gives them a default layout.
    const plan = typeof row.plan === "string" ? JSON.parse(row.plan) : row.plan;
    const project = normalizeProject(plan, "16:9", true);
    if (!project) return { success: false as const, error: "PROJET_INVALIDE" };
    return { success: true as const, data: clean(project), topic: String(row.topic ?? "") };
  } catch (error) {
    console.error("getProject failed:", error);
    return { success: false as const, error: "SERVICE_INDISPONIBLE" };
  }
}
