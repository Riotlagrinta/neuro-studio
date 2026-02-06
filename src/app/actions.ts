"use server";

import { groq } from "@/lib/groq-client";
import { supabase } from "@/lib/supabase";
import cloudinary from "@/lib/cloudinary";

export interface Scene {
  id: number;
  voiceOver: string;
  visualPrompt: string;
  videoKeywords: string;
  duration: number;
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
  } catch (error: any) {
    return { success: false, error: error.message || "ECHEC_GEN" };
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
  } catch (error: any) {
    return { success: false, error: error.message || "ECHEC_AUDIO" };
  }
}

export async function saveProject(topic: string, plan: ContentPlan) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert([{ title: plan.title, category: plan.category, plan, topic }])
      .select();

    if (error) return { success: false, error: error.message };
    return { success: true, data: JSON.parse(JSON.stringify(data[0])) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getProjects() {
  try {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (error) return [];
    return JSON.parse(JSON.stringify(data || []));
  } catch (e) {
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
  } catch (e) {
    return null;
  }
}