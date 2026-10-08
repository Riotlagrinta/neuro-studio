"use server";

import Anthropic from "@anthropic-ai/sdk";
import cloudinary from "@/lib/cloudinary";
import { getAnthropic, MOTION_MODEL } from "@/lib/anthropic-client";
import { replicate } from "@/lib/replicate-client";
import { listVoiceProviders, synthesize, type VoiceProviderId, type VoiceProviderInfo } from "@/lib/voice-providers";
import { getVideoModel, VIDEO_MODELS } from "@/lib/video-models";
import { projectRequest, sceneRequest, STYLES, systemPrompt, type StyleId } from "@/lib/motion/prompt";
import { extractJson, normalizeProject, normalizeScene } from "@/lib/motion/sanitize";
import type { AspectRatio, MotionProject, MotionScene } from "@/lib/motion/types";

const RATIOS: AspectRatio[] = ["16:9", "9:16"];
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

// ---------------------------------------------------------------------------
// Motion design (Claude Opus)
// ---------------------------------------------------------------------------

async function askOpus(system: string, user: string): Promise<{ text: string } | { error: string }> {
  const client = getAnthropic();
  if (!client) return { error: "CLÉ_ANTHROPIC_MANQUANTE" };
  try {
    // Streaming: a full motion spec is a long output, and Opus may think before writing it.
    const message = await client.beta.messages
      .stream({
        model: MOTION_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
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
  const targetSeconds = Math.min(120, Math.max(10, Math.round(Number(input.targetSeconds) || 30)));

  const reply = await askOpus(systemPrompt(ratio, !!input.useMedia), projectRequest({ topic, style, targetSeconds, ratio }));
  if ("error" in reply) return { success: false as const, error: reply.error };

  try {
    const project = normalizeProject(extractJson(reply.text), ratio, false);
    if (!project) return { success: false as const, error: "RÉPONSE_INVALIDE" };
    return { success: true as const, data: clean({ ...project, ratio }) };
  } catch {
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

  const current = normalizeScene(input.scene, index, ratio, true);
  // Generated asset URLs mean nothing to the model; undefined fields are dropped by JSON.stringify.
  const forModel = { ...current, imageUrl: undefined, videoUrl: undefined, audioUrl: undefined };

  const reply = await askOpus(
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
  if ("error" in reply) return { success: false as const, error: reply.error };

  try {
    const revised = normalizeScene(extractJson(reply.text), index, ratio, false);
    // Keep the assets that are still valid for the revised scene. Narration audio only stays if
    // the text is unchanged — and then so does the duration, which was fitted to that audio.
    const sameVoice = revised.voiceOver === current.voiceOver;
    const scene: MotionScene = {
      ...revised,
      duration: sameVoice && current.audioUrl ? current.duration : revised.duration,
      imageUrl: current.imageUrl,
      videoUrl: current.videoUrl,
      audioUrl: sameVoice ? current.audioUrl : undefined,
    };
    return { success: true as const, data: clean(scene) };
  } catch {
    return { success: false as const, error: "RÉPONSE_INVALIDE" };
  }
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface StudioCapabilities {
  motion: boolean;
  voices: VoiceProviderInfo[];
  videoAvailable: boolean;
  videoModels: { id: string; label: string; needsImage: boolean }[];
  quota: { remaining: number; total: number } | null;
}

export async function getStudioCapabilities(): Promise<StudioCapabilities> {
  return {
    motion: !!process.env.ANTHROPIC_API_KEY?.trim(),
    voices: await listVoiceProviders(),
    videoAvailable: !!process.env.REPLICATE_API_TOKEN?.trim(),
    videoModels: VIDEO_MODELS.map(({ id, label, needsImage }) => ({ id, label, needsImage })),
    quota: await getQuota(),
  };
}

export async function getQuota() {
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
  try {
    const text = typeof prompt === "string" ? prompt.trim().slice(0, 150) : "";
    if (text.length < 3) return { success: false as const, error: "PROMPT_VIDE" };
    const [width, height] = ratio === "9:16" ? [720, 1280] : [1280, 720];
    const source = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?nologo=true&width=${width}&height=${height}&seed=${Math.floor(Math.random() * 100000)}`;
    // Re-hosted on Cloudinary: a stable URL we control, with CORS headers so the canvas stays exportable.
    const uploaded = await cloudinary.uploader.upload(source, { folder: "neuro-studio-images" });
    return { success: true as const, url: uploaded.secure_url as string };
  } catch {
    return { success: false as const, error: "ECHEC_IMAGE" };
  }
}

export async function synthesizeVoice(text: string, provider: VoiceProviderId, voiceId: string) {
  try {
    const input = typeof text === "string" ? text.trim().slice(0, 5000) : "";
    if (!input) return { success: false as const, error: "TEXTE_VIDE" };

    const speech = await synthesize(provider, input, String(voiceId));
    if (!speech.ok) return { success: false as const, error: speech.error };

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
    return { success: false as const, error: errorMessage(error, "ECHEC_AUDIO") };
  }
}

// Video generation takes from tens of seconds to minutes, which is longer than a request should
// stay open: start a Replicate prediction, then let the client poll checkVideoJob.

function isCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

export interface VideoJobInput {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  ratio: AspectRatio;
  duration: number;
}

export async function startVideoJob(input: VideoJobInput) {
  try {
    if (!process.env.REPLICATE_API_TOKEN?.trim()) return { success: false as const, error: "CLÉ_REPLICATE_MANQUANTE" };
    const model = getVideoModel(input.modelId);
    if (!model) return { success: false as const, error: "MODELE_INCONNU" };

    const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 500) : "";
    if (!prompt) return { success: false as const, error: "PROMPT_VIDE" };
    // Replicate fetches this URL, so only accept assets we uploaded ourselves.
    const imageUrl = input.imageUrl && isCloudinaryUrl(input.imageUrl) ? input.imageUrl : undefined;
    if (model.needsImage && !imageUrl) return { success: false as const, error: "IMAGE_REQUISE" };

    const ratio = RATIOS.includes(input.ratio) ? input.ratio : "16:9";
    const prediction = await replicate.predictions.create({
      model: model.slug,
      input: model.input({ prompt, imageUrl, ratio, duration: Number(input.duration) || 5 }),
    });
    return { success: true as const, id: prediction.id };
  } catch (error) {
    return { success: false as const, error: errorMessage(error, "ECHEC_VIDEO") };
  }
}

export type VideoJobStatus =
  | { success: true; status: "processing" }
  | { success: true; status: "succeeded"; url: string }
  | { success: false; error: string };

export async function checkVideoJob(id: string): Promise<VideoJobStatus> {
  try {
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return { success: false, error: "JOB_INVALIDE" };
    const prediction = await replicate.predictions.get(id);

    if (prediction.status === "failed" || prediction.status === "canceled") {
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
// Persistence (Neon). The project is stored as-is in the existing `plan` column.
// ---------------------------------------------------------------------------

export async function saveProject(topic: string, project: MotionProject) {
  try {
    const plan = normalizeProject(project, project?.ratio ?? "16:9", true);
    if (!plan) return { success: false as const, error: "PROJET_INVALIDE" };
    const { sql } = await import("@/lib/db");
    const results = await sql`
      INSERT INTO projects (title, category, plan, topic)
      VALUES (${plan.title}, ${plan.category}, ${JSON.stringify(plan)}, ${String(topic).slice(0, 1500)})
      RETURNING id
    `;
    if (!results || results.length === 0) return { success: false as const, error: "ECHEC_INSERTION_NEON" };
    return { success: true as const, id: Number(results[0].id) };
  } catch (error) {
    return { success: false as const, error: errorMessage(error, "ECHEC_SAVE") };
  }
}

export async function getProjects() {
  try {
    const { sql } = await import("@/lib/db");
    const results = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    return clean(results || []);
  } catch (error) {
    console.error("Erreur de récupération des projets :", error);
    return [];
  }
}

export async function getProject(id: number) {
  try {
    if (!Number.isInteger(id)) return { success: false as const, error: "ID_INVALIDE" };
    const { sql } = await import("@/lib/db");
    const rows = await sql`SELECT * FROM projects WHERE id = ${id} LIMIT 1`;
    if (!rows || rows.length === 0) return { success: false as const, error: "PROJET_INTROUVABLE" };
    const row = rows[0];
    // Older rows are "biopic" plans without motion layers; normalizeProject gives them a default layout.
    const plan = typeof row.plan === "string" ? JSON.parse(row.plan) : row.plan;
    const project = normalizeProject(plan, "16:9", true);
    if (!project) return { success: false as const, error: "PROJET_INVALIDE" };
    return { success: true as const, data: clean(project), topic: String(row.topic ?? "") };
  } catch (error) {
    return { success: false as const, error: errorMessage(error, "ECHEC_CHARGEMENT") };
  }
}
