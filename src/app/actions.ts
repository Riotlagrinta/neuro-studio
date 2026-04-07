"use server";

import { groq } from "@/lib/groq-client";
import { sql } from "@/lib/db";
import cloudinary from "@/lib/cloudinary";

export interface Scene {
  id: number;
  voiceOver: string;
  visualPrompt: string;
  videoKeywords: string;
  duration: number;
  imageUrl?: string;
  videoUrl?: string;
}

export interface ContentPlan {
  title: string;
  category: string;
  scenes: Scene[];
}

export async function generateContent(topic: string) {
  try {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) return { success: false, error: "CLÉ_GROQ_MANQUANTE" };

    const systemPrompt = `
      Tu es NeuroDirector PRO. Réponds UNIQUEMENT en JSON.
      Structure : { "title": "...", "category": "...", "scenes": [{ "id": 1, "voiceOver": "...", "visualPrompt": "concise english prompt", "videoKeywords": "...", "duration": 5 }] }
      Critères : Prompts visuels courts et en anglais.
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Sujet : ${topic}` },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return { success: false, error: "IA_VIDE" };

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const data = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_GEN";
    return { success: false, error: message };
  }
}

export async function generateImage(prompt: string, ratio: "16:9" | "9:16" = "16:9") {
  try {
    console.log(`Génération Image Pollinations (${ratio}) pour:`, prompt);
    
    // Calcul des dimensions selon le ratio
    const width = ratio === "16:9" ? 1280 : 720;
    const height = ratio === "16:9" ? 720 : 1280;
    
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 150))}?nologo=true&width=${width}&height=${height}&seed=${Math.floor(Math.random() * 1000)}`;
    
    const uploadResponse = await cloudinary.uploader.upload(fallbackUrl, {
      folder: "neuro-studio-free",
    });

    return { success: true, url: uploadResponse.secure_url };
  } catch (error: unknown) {
    return { success: false, error: "ECHEC_IMAGE_GRATUITE" };
  }
}

export async function getElevenLabsAudio(text: string) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return { success: false, error: "CLÉ_ELEVEN_MANQUANTE" };

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6OB85MvRmPLz5QN`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.5 },
      }),
    });

    if (!response.ok) return { success: false, error: `ELEVEN_HTTP_${response.status}` };

    const buffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(buffer).toString("base64");
    
    const uploadResponse = await cloudinary.uploader.upload(`data:audio/mpeg;base64,${base64Audio}`, {
      resource_type: "video",
      folder: "neuro-studio-audios",
    });

    return { success: true, url: uploadResponse.secure_url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_AUDIO";
    return { success: false, error: message };
  }
}

export async function generateVideo(imageUrl: string, prompt: string) {
  return { success: true, url: imageUrl, isSimulated: true };
}

export async function saveProject(topic: string, plan: ContentPlan) {
  try {
    const results = await sql`
      INSERT INTO projects (title, category, plan, topic)
      VALUES (${plan.title}, ${plan.category}, ${JSON.stringify(plan)}, ${topic})
      RETURNING *
    `;

    if (!results || results.length === 0) return { success: false, error: "ECHEC_INSERTION_NEON" };
    return { success: true, data: JSON.parse(JSON.stringify(results[0])) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_SAVE";
    return { success: false, error: message };
  }
}

export async function getProjects() {
  try {
    const results = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    return JSON.parse(JSON.stringify(results || []));
  } catch (error: unknown) {
    console.error("Erreur de récupération des projets :", error);
    return [];
  }
}

export async function getQuota() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return null;
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey } });
    const data = await response.json();
    return { remaining: data.character_limit - data.character_count, total: data.character_limit };
  } catch (error: unknown) {
    return null;
  }
}
